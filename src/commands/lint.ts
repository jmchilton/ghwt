import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { load as loadYaml } from 'js-yaml';
import { loadConfig, expandPath } from '../lib/config.js';
import { validateGhwtConfig, validateSessionConfig, validateNoteFrontmatter } from '../lib/schemas.js';
import { parseFrontmatter } from '../lib/obsidian.js';

interface LintResult {
  errors: string[];
  warnings: string[];
  passedChecks: string[];
}

export async function lintCommand(options?: { verbose?: boolean; sessionOnly?: boolean; configOnly?: boolean }): Promise<void> {
  const result: LintResult = {
    errors: [],
    warnings: [],
    passedChecks: [],
  };

  console.log('🔍 Linting ghwt configuration...\n');

  // =========================================================================
  // 1. Global Config Validation
  // =========================================================================
  if (!options?.sessionOnly) {
    const globalConfigPath = join(homedir(), '.ghwtrc.json');
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
  }

  // =========================================================================
  // 2. Session Configs Validation
  // =========================================================================
  if (!options?.configOnly) {
    try {
      const config = loadConfig();
      const projectsRoot = expandPath(config.projectsRoot);
      const configDir = join(projectsRoot, 'terminal-session-config');

      if (!existsSync(configDir)) {
        result.warnings.push(`Session config directory not found: ${configDir}`);
      } else {
        const sessionFiles = readdirSync(configDir).filter((f) =>
          f.endsWith('.ghwt-session.yaml') || f.endsWith('.ghwt-session.yml') || f.endsWith('.ghwt-session.json'),
        );

        if (sessionFiles.length === 0) {
          result.warnings.push(`No session config files found in ${configDir}`);
        } else {
          let validCount = 0;
          for (const file of sessionFiles) {
            const filePath = join(configDir, file);
            try {
              const content = readFileSync(filePath, 'utf-8');
              const parsed = file.endsWith('.json') ? JSON.parse(content) : loadYaml(content);
              validateSessionConfig(parsed);
              validCount++;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              result.errors.push(`Session config ${file} is invalid:\n${message}`);
            }
          }
          result.passedChecks.push(
            `✅ Session configs: ${validCount}/${sessionFiles.length} valid`,
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to validate session configs: ${message}`);
    }
  }

  // =========================================================================
  // 3. Project Structure Validation
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
  // 4. Worktree Notes Validation
  // =========================================================================
  try {
    const config = loadConfig();
    const vaultRoot = expandPath(config.vaultPath);
    const projectsDir = join(vaultRoot, 'projects');

    if (!existsSync(projectsDir)) {
      result.warnings.push(`Projects directory not found in vault: ${projectsDir}`);
    } else {
      const projectDirs = readdirSync(projectsDir)
        .filter((name) => statSync(join(projectsDir, name)).isDirectory());

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
  // Print Results
  // =========================================================================
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
    console.log(`❌ Linting failed: ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}, ${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`);
    process.exit(1);
  } else {
    console.log(`⚠️  Linting completed with ${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`);
  }
}
