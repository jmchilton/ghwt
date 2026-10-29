import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { loadConfig, expandPath, getConfigFilePath } from '../lib/config.js';
import { validateGhwtConfig } from '../lib/schemas.js';
import { parseFrontmatter } from '../lib/obsidian.js';
import { getNotePath } from '../lib/paths.js';
import { listWorktrees } from '../lib/worktree-list.js';

interface LintResult {
  errors: string[];
  warnings: string[];
  passedChecks: string[];
}

export async function lintCommand(options?: {
  verbose?: boolean;
  configOnly?: boolean;
}): Promise<void> {
  const result: LintResult = {
    errors: [],
    warnings: [],
    passedChecks: [],
  };

  console.log('🔍 Linting ghwt configuration...\n');

  // =========================================================================
  // 1. Global Config Validation
  // =========================================================================
  const globalConfigPath = getConfigFilePath();
  try {
    if (!existsSync(globalConfigPath)) {
      result.warnings.push(`Global config not found at ${globalConfigPath} (using defaults)`);
    } else {
      const data = readFileSync(globalConfigPath, 'utf-8');
      const parsed = JSON.parse(data);
      validateGhwtConfig(parsed);
      result.passedChecks.push(`✅ Global config: Valid`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Global config validation failed:\n${message}`);
  }

  if (!options?.configOnly) {
    await checkWorkspace(result);
  }

  printResults(result);
}

async function checkWorkspace(result: LintResult): Promise<void> {
  // =========================================================================
  // 2. Project Structure Validation
  // =========================================================================
  try {
    const config = loadConfig();
    const projectsRoot = expandPath(config.projectsRoot);
    const reposRoot = join(projectsRoot, config.repositoriesDir);
    const worktreesRoot = join(projectsRoot, config.worktreesDir);
    const vaultRoot = expandPath(config.vaultPath);

    const dirs = [
      { path: projectsRoot, name: 'projects root' },
      { path: reposRoot, name: 'repositories directory' },
      { path: worktreesRoot, name: 'worktrees directory' },
      { path: vaultRoot, name: 'vault' },
    ];

    let missingDirs = 0;
    for (const { path, name } of dirs) {
      if (!existsSync(path)) {
        result.errors.push(`Missing ${name}: ${path}`);
        missingDirs++;
      }
    }

    if (missingDirs === 0) {
      result.passedChecks.push('✅ Project structure: All directories exist');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to validate project structure: ${message}`);
  }

  // =========================================================================
  // 3. Worktree Notes Validation
  // =========================================================================
  try {
    const config = loadConfig();
    const vaultRoot = expandPath(config.vaultPath);
    const projectsDir = join(vaultRoot, 'projects');

    if (!existsSync(projectsDir)) {
      result.warnings.push(`Projects directory not found in vault: ${projectsDir}`);
    } else {
      const projectDirs = readdirSync(projectsDir).filter((name) =>
        statSync(join(projectsDir, name)).isDirectory(),
      );

      let totalNotes = 0;
      let validNotes = 0;

      for (const projDir of projectDirs) {
        const worktreesDir = join(projectsDir, projDir, 'worktrees');
        if (!existsSync(worktreesDir)) continue;

        const noteFiles = readdirSync(worktreesDir).filter((f) => f.endsWith('.md'));
        totalNotes += noteFiles.length;

        for (const file of noteFiles) {
          const notePath = join(worktreesDir, file);
          try {
            const content = readFileSync(notePath, 'utf-8');
            const { frontmatter } = parseFrontmatter(content);

            // Basic validation of required fields
            const requiredFields = ['project', 'branch', 'status', 'created', 'worktree_path'];
            const missingFields = requiredFields.filter((field) => !(field in frontmatter));

            if (missingFields.length > 0) {
              result.errors.push(
                `Note ${projDir}/${file} missing required fields: ${missingFields.join(', ')}`,
              );
            } else {
              validNotes++;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.errors.push(`Failed to read note ${projDir}/${file}: ${message}`);
          }
        }
      }

      if (totalNotes > 0) {
        result.passedChecks.push(`✅ Worktree notes: ${validNotes}/${totalNotes} valid`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to validate worktree notes: ${message}`);
  }

  // =========================================================================
  // 4. CI Artifact Configs Validation
  // =========================================================================
  try {
    const config = loadConfig();
    const projectsRoot = expandPath(config.projectsRoot);
    const ciConfigDir = join(projectsRoot, 'ci-artifacts-config');

    if (!existsSync(ciConfigDir)) {
      result.warnings.push(`CI config directory not found: ${ciConfigDir}`);
    } else {
      // Import gh-ci-artifacts validation
      let configSchema;
      try {
        const ghci = await import('gh-ci-artifacts');
        configSchema = ghci.configSchema;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (importError) {
        result.errors.push(
          `Failed to load gh-ci-artifacts for CI config validation. ` +
            `Install it with: npm install gh-ci-artifacts`,
        );
        configSchema = null;
      }

      if (configSchema) {
        // Find all project subdirectories
        const projectDirs = readdirSync(ciConfigDir).filter((name) =>
          statSync(join(ciConfigDir, name)).isDirectory(),
        );

        let totalConfigs = 0;
        let validConfigs = 0;

        for (const projDir of projectDirs) {
          const configCandidates = [
            join(ciConfigDir, projDir, '.gh-ci-artifacts.yaml'),
            join(ciConfigDir, projDir, '.gh-ci-artifacts.yml'),
            join(ciConfigDir, projDir, '.gh-ci-artifacts.json'),
          ];

          for (const configPath of configCandidates) {
            if (existsSync(configPath)) {
              totalConfigs++;
              try {
                const content = readFileSync(configPath, 'utf-8');
                const parsed = configPath.endsWith('.json')
                  ? JSON.parse(content)
                  : loadYaml(content);

                const validation = configSchema.safeParse(parsed);
                if (validation.success) {
                  validConfigs++;
                } else {
                  const details = validation.error.issues
                    .map((issue) => {
                      const pathStr = issue.path.map(String).join('.');
                      return `    ${pathStr}: ${issue.message}`;
                    })
                    .join('\n');
                  result.errors.push(
                    `CI config ${projDir}/.gh-ci-artifacts.* is invalid:\n${details}`,
                  );
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                result.errors.push(`Failed to parse CI config ${projDir}: ${message}`);
              }
              break; // Only validate first matching config file
            }
          }
        }

        if (totalConfigs > 0) {
          result.passedChecks.push(`✅ CI configs: ${validConfigs}/${totalConfigs} valid`);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to validate CI configs: ${message}`);
  }

  // =========================================================================
  // 5. Obsidian Vault Configuration Validation
  // =========================================================================
  try {
    const config = loadConfig();
    const vaultRoot = expandPath(config.vaultPath);

    // Check vault root exists
    if (!existsSync(vaultRoot)) {
      result.errors.push(`Vault root not found: ${vaultRoot}`);
    } else {
      const projectsDir = join(vaultRoot, 'projects');
      if (!existsSync(projectsDir)) {
        result.errors.push(`Vault projects directory not found: ${projectsDir}`);
      } else {
        result.passedChecks.push(`✅ Obsidian Vault: Structure valid at ${vaultRoot}`);
      }

      // Check vault name is configured
      if (!config.obsidianVaultName) {
        result.warnings.push(`Obsidian vault name not configured (will default to 'projects')`);
      } else {
        result.passedChecks.push(`✅ Obsidian Vault: Configured as '${config.obsidianVaultName}'`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to validate Obsidian vault configuration: ${message}`);
  }

  // =========================================================================
  // 6. Notes Without Worktrees Detection
  // =========================================================================
  try {
    const config = loadConfig();
    const vaultRoot = expandPath(config.vaultPath);
    const projectsDir = join(vaultRoot, 'projects');

    if (existsSync(projectsDir)) {
      const projectDirs = readdirSync(projectsDir).filter((name) =>
        statSync(join(projectsDir, name)).isDirectory(),
      );

      let orphanNotes = 0;

      for (const projDir of projectDirs) {
        const worktreesDir = join(projectsDir, projDir, 'worktrees');
        if (!existsSync(worktreesDir)) continue;

        const noteFiles = readdirSync(worktreesDir).filter((f) => f.endsWith('.md'));

        for (const file of noteFiles) {
          const notePath = join(worktreesDir, file);
          try {
            const content = readFileSync(notePath, 'utf-8');
            const { frontmatter } = parseFrontmatter(content);

            // Check if worktree still exists
            const worktreePath = frontmatter.worktree_path as string;
            if (worktreePath && !existsSync(worktreePath)) {
              result.errors.push(
                `Note without worktree: ${projDir}/${file} (worktree path: ${worktreePath})`,
              );
              orphanNotes++;
            }
          } catch {
            // Skip notes that can't be read (already reported in section 4)
          }
        }
      }

      if (orphanNotes === 0 && projectDirs.length > 0) {
        result.passedChecks.push(`✅ Worktree notes: All notes have corresponding worktrees`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to check for notes without worktrees: ${message}`);
  }

  // =========================================================================
  // 7. Worktrees Without Notes Detection
  // =========================================================================
  try {
    const config = loadConfig();
    const vaultRoot = expandPath(config.vaultPath);

    const worktrees = listWorktrees();
    let orphanWorktrees = 0;

    for (const wt of worktrees) {
      const notePath = getNotePath(vaultRoot, wt.project, wt.branch);

      if (!existsSync(notePath)) {
        result.errors.push(
          `Worktree without note: ${wt.project}/${wt.branch} (expected note: ${notePath})`,
        );
        orphanWorktrees++;
      }
    }

    if (orphanWorktrees === 0 && worktrees.length > 0) {
      result.passedChecks.push(`✅ Worktree structure: All worktrees have corresponding notes`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to check for worktrees without notes: ${message}`);
  }

  // =========================================================================
  // 8. Extra Files Detection (CI Config, CI Artifacts)
  // =========================================================================
  try {
    const config = loadConfig();
    const projectsRoot = expandPath(config.projectsRoot);
    const vaultRoot = expandPath(config.vaultPath);

    // Check ci-artifacts-config directory
    const ciConfigDir = join(projectsRoot, 'ci-artifacts-config');
    if (existsSync(ciConfigDir)) {
      const projectDirs = readdirSync(ciConfigDir).filter((name) => {
        const path = join(ciConfigDir, name);
        return statSync(path).isDirectory();
      });

      for (const projDir of projectDirs) {
        const projPath = join(ciConfigDir, projDir);
        const files = readdirSync(projPath);
        const validPattern = /^\.gh-ci-artifacts\.(yaml|yml|json)$/;
        const extraFiles = files.filter((f) => !validPattern.test(f));

        if (extraFiles.length > 0) {
          result.warnings.push(
            `Unexpected files in ci-artifacts-config/${projDir}: ${extraFiles.join(', ')}`,
          );
        }
      }
    }

    // Check for extra files in ci-artifacts directory
    const ciArtifactsDir = join(projectsRoot, 'ci-artifacts');
    if (existsSync(ciArtifactsDir)) {
      // Scan all ci-artifacts/{project}/{branchType}/{name}/* files
      const projectDirs = readdirSync(ciArtifactsDir).filter((name) => {
        const path = join(ciArtifactsDir, name);
        return statSync(path).isDirectory();
      });

      for (const projDir of projectDirs) {
        const projPath = join(ciArtifactsDir, projDir);
        const branchTypes = readdirSync(projPath).filter((name) => {
          const path = join(projPath, name);
          return statSync(path).isDirectory();
        });

        for (const branchType of branchTypes) {
          if (branchType !== 'branch' && branchType !== 'pr') {
            result.warnings.push(
              `Unexpected directory in ci-artifacts/${projDir}: ${branchType} (expected 'branch' or 'pr')`,
            );
            continue;
          }

          const branchPath = join(projPath, branchType);
          const names = readdirSync(branchPath).filter((name) => {
            const path = join(branchPath, name);
            return statSync(path).isDirectory();
          });

          // Names should match corresponding worktrees
          for (const name of names) {
            const fullBranch = `${branchType}/${name}`;
            const notePath = getNotePath(vaultRoot, projDir, fullBranch);
            if (!existsSync(notePath)) {
              result.warnings.push(
                `CI artifacts without note: ${projDir}/${fullBranch} (no corresponding note)`,
              );
            }
          }
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to validate file structure: ${message}`);
  }
}

function printResults(result: LintResult): void {
  console.log('📊 Results:\n');

  if (result.passedChecks.length > 0) {
    result.passedChecks.forEach((check) => console.log(check));
  }

  if (result.warnings.length > 0) {
    console.log();
    result.warnings.forEach((warning) => console.log(`⚠️  ${warning}`));
  }

  if (result.errors.length > 0) {
    console.log();
    result.errors.forEach((error) => console.log(`❌ ${error}`));
  }

  const totalIssues = result.errors.length + result.warnings.length;
  console.log();
  if (totalIssues === 0) {
    console.log('✨ All checks passed!');
    return;
  }

  if (result.errors.length > 0) {
    console.log(
      `❌ Linting failed: ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}, ${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`,
    );
    process.exit(1);
  } else {
    console.log(
      `⚠️  Linting completed with ${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`,
    );
  }
}
