import { join } from 'path';
import { existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { loadConfig, expandPath } from '../lib/config.js';
import { getGitInfo } from '../lib/git.js';
import { getPRInfo, getBranchCIStatus, getPRRepoUrl, getCIRepoUrl } from '../lib/github.js';
import {
  readNote,
  updateNoteMetadata,
  calculateDaysSinceActivity,
  createWorktreeNote,
} from '../lib/obsidian.js';
import {
  shouldFetchArtifacts,
  needsFullFetch,
  fetchCIArtifacts,
  getCIMetadata,
  getCIArtifactsPath,
} from '../lib/ci-artifacts.js';
import { listWorktrees, getCurrentWorktreeContext } from '../lib/worktree-list.js';
import { findSessionConfig, loadSessionConfig } from '../lib/terminal-session.js';
import { TmuxSessionManager } from '../lib/terminal-session-tmux.js';
import { ZellijSessionManager } from '../lib/terminal-session-zellij.js';
import { getNotePath, getSessionName, parseBranchFromOldFormat } from '../lib/paths.js';
import { WorktreeMetadata } from '../types.js';
import { pickWorktree } from '../lib/worktree-picker.js';

interface SyncOptions {
  verbose?: boolean;
  this?: boolean;
  all?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Config = any;

/**
 * Sync a single worktree's metadata
 */
async function syncSingleWorktree(
  project: string,
  branch: string,
  config: Config,
  vaultRoot: string,
  projectsRoot: string,
  options?: SyncOptions,
): Promise<void> {
  const { name, branchType } = parseBranchFromOldFormat(branch);
  const notePath = getNotePath(vaultRoot, project, branch);

  console.log(`🔄 Syncing ${project}/${branch}...`);

  // Get worktree path
  const worktreesRoot = join(projectsRoot, config.worktreesDir);
  const worktreePath = join(worktreesRoot, project, branchType, name);

  if (!existsSync(worktreePath)) {
    console.error(`❌ Worktree not found: ${worktreePath}`);
    process.exit(1);
  }

  // If note doesn't exist, create it
  if (!existsSync(notePath)) {
    try {
      const gitInfo = await getGitInfo(worktreePath, branch);
      const daysSinceActivity = calculateDaysSinceActivity(worktreePath);

      const metadata: Partial<WorktreeMetadata> = {
        project,
        branch,
        status: 'in-progress',
        created: new Date().toISOString().split('T')[0],
        repo_url: gitInfo.remoteUrl,
        worktree_path: worktreePath,
        base_branch: gitInfo.baseBranch,
        commits_ahead: gitInfo.commitsAhead,
        commits_behind: gitInfo.commitsBehind,
        has_uncommitted_changes: gitInfo.hasUncommittedChanges,
        last_commit_date: gitInfo.lastCommitDate,
        tracking_branch: gitInfo.trackingBranch || undefined,
        days_since_activity: daysSinceActivity,
      };

      createWorktreeNote(notePath, metadata);
      console.log(`📝 Created note: ${project}/${branch}`);
    } catch (error) {
      console.error(`❌ Failed to create note: ${error}`);
      process.exit(1);
    }
  }

  // Read current note and sync
  const { frontmatter } = readNote(notePath);
  const gitInfo = await getGitInfo(worktreePath, branch);
  const daysSinceActivity = calculateDaysSinceActivity(worktreePath);

  const updates: Partial<WorktreeMetadata> = {
    commits_ahead: gitInfo.commitsAhead,
    commits_behind: gitInfo.commitsBehind,
    has_uncommitted_changes: gitInfo.hasUncommittedChanges,
    last_commit_date: gitInfo.lastCommitDate,
    tracking_branch: gitInfo.trackingBranch || undefined,
    days_since_activity: daysSinceActivity,
  };

  // Get repo info for GitHub API calls
  // PR repo: upstream (where PRs are opened), CI repo: origin (where CI runs on your fork)
  const prRepo = await getPRRepoUrl(worktreePath);
  const ciRepo = await getCIRepoUrl(worktreePath);
  const repoName = ciRepo?.split('/')[1] || project;

  // If PR, fetch PR info first (from upstream where PRs are opened)
  let prNumber: string | undefined;
  if (frontmatter.pr) {
    try {
      const prMatch = (frontmatter.pr as string).match(/\/(\d+)$/);
      if (prMatch) {
        prNumber = prMatch[1];

        const prInfo = await getPRInfo(prNumber, prRepo);
        updates.pr_state = prInfo.state;
        updates.pr_checks = prInfo.checks;
        updates.pr_reviews = prInfo.reviews;
        updates.pr_labels = prInfo.labels;
        updates.pr_updated_at = prInfo.updatedAt;
      }
    } catch (error) {
      if (options?.verbose) {
        console.log(`  ⚠️  Failed to fetch PR info: ${error}`);
      }
    }
  }

  // Fetch CI status from GitHub Actions
  // For PRs: try upstream first (some projects run CI on target repo), fall back to origin
  // For branches: use origin (your fork)
  let ciChecks: 'passing' | 'failing' | 'pending' | 'none' = 'none';
  const ciRepoToUse = prNumber && prRepo !== ciRepo ? prRepo : ciRepo;

  if (ciRepoToUse) {
    try {
      ciChecks = await getBranchCIStatus(ciRepoToUse, name);
      // If PR and upstream returned 'none', try origin as fallback
      if (
        prNumber &&
        ciChecks === 'none' &&
        ciRepoToUse === prRepo &&
        ciRepo &&
        ciRepo !== prRepo
      ) {
        const originCiChecks = await getBranchCIStatus(ciRepo, name);
        if (originCiChecks !== 'none') {
          ciChecks = originCiChecks;
        }
      }
      updates.ci_checks = ciChecks;
      if (options?.verbose) {
        console.log(`  🔍 CI status: ${ciChecks}`);
      }
    } catch (error) {
      if (options?.verbose) {
        console.log(`  ⚠️  Failed to fetch CI status: ${error}`);
      }
    }
  }

  // Smart CI artifact fetching (works for both PRs and branches)
  // For PRs: try upstream first, fall back to origin
  // For branches: use origin
  if (shouldFetchArtifacts(frontmatter, updates.pr_checks, ciChecks)) {
    const artifactRepo = prNumber && prRepo !== ciRepo ? prRepo : ciRepo;
    if (artifactRepo) {
      try {
        const artifactsPath = getCIArtifactsPath(projectsRoot, project, branchType, name);
        mkdirSync(artifactsPath, { recursive: true });

        const resume = !needsFullFetch(frontmatter, gitInfo.currentSha);
        if (options?.verbose) {
          console.log(`  📦 Fetching CI artifacts (${resume ? 'resume' : 'full'})...`);
        }

        // Use PR number if available, otherwise use branch name
        const ref = prNumber || name;

        try {
          await fetchCIArtifacts(ref, artifactRepo, artifactsPath, resume, repoName, options);
        } catch (upstreamError) {
          // If PR and upstream failed, try origin as fallback
          if (prNumber && artifactRepo === prRepo && ciRepo && ciRepo !== prRepo) {
            if (options?.verbose) {
              console.log(`  ⚠️  Upstream failed, trying origin...`);
            }
            await fetchCIArtifacts(ref, ciRepo, artifactsPath, resume, repoName, options);
          } else {
            throw upstreamError;
          }
        }

        const ciMeta = await getCIMetadata(artifactsPath, gitInfo.currentSha);
        Object.assign(updates, ciMeta);

        if (options?.verbose) {
          console.log(
            `  ✅ CI artifacts: ${ciMeta.ci_status} (${ciMeta.ci_failed_tests} test failures, ${ciMeta.ci_linter_errors} lint errors)`,
          );
        }
      } catch (error) {
        if (options?.verbose) {
          console.log(`  ⚠️  Failed to fetch CI artifacts: ${error}`);
        }
      }
    }
  }

  updateNoteMetadata(notePath, updates);

  // Check/recreate session
  const sessionName = getSessionName(project, branch);
  const manager =
    config.terminalMultiplexer === 'zellij' ? new ZellijSessionManager() : new TmuxSessionManager();

  const sessionExists = await manager.sessionExists(sessionName);
  if (!sessionExists) {
    const configPath = findSessionConfig(project, config);
    if (configPath) {
      try {
        const sessionConfig = loadSessionConfig(configPath);
        await manager.createSession(
          sessionName,
          sessionConfig,
          worktreePath,
          project,
          branch,
          notePath,
        );
        console.log(`🖥️  Recreated session: ${sessionName}`);
      } catch (error) {
        if (options?.verbose) {
          console.log(`  ⚠️  Failed to recreate session: ${error}`);
        }
      }
    }
  }

  console.log(
    `✅ Synced: ${project}/${branch} (ahead: ${gitInfo.commitsAhead}, behind: ${gitInfo.commitsBehind})`,
  );
}

export async function syncCommand(
  project?: string,
  branch?: string,
  options?: SyncOptions,
): Promise<void> {
  const config = loadConfig();
  const vaultRoot = expandPath(config.vaultPath);
  const projectsRoot = expandPath(config.projectsRoot);

  const projectsPath = join(vaultRoot, 'projects');

  let selectedProject = project;
  let selectedBranch = branch;

  // Handle --this flag
  if (options?.this) {
    try {
      const context = await getCurrentWorktreeContext();
      selectedProject = context.project;
      selectedBranch = context.branch;
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else if (!options?.all && !selectedProject && !selectedBranch) {
    // No args provided and not --all: show picker
    const picked = await pickWorktree();
    selectedProject = picked.project;
    selectedBranch = picked.branch;
  }

  // If specific worktree selected (via args, --this, or picker), sync just that one
  if (selectedProject && selectedBranch) {
    await syncSingleWorktree(
      selectedProject,
      selectedBranch,
      config,
      vaultRoot,
      projectsRoot,
      options,
    );
    return;
  }

  // Otherwise sync all (or all for a project)
  console.log('🔄 Syncing worktree metadata...\n');

  let syncedCount = 0;
  let errorCount = 0;

  // Scan projects
  const projectDirs = selectedProject
    ? [selectedProject]
    : readdirSync(projectsPath).filter((p) => statSync(join(projectsPath, p)).isDirectory());

  for (const proj of projectDirs) {
    const worktreesDir = join(projectsPath, proj, 'worktrees');

    if (!existsSync(worktreesDir)) {
      if (options?.verbose) {
        console.log(`📂 No worktrees for project: ${proj}`);
      }
      continue;
    }

    const noteFiles = readdirSync(worktreesDir).filter((f) => f.endsWith('.md'));

    for (const noteFile of noteFiles) {
      const notePath = join(worktreesDir, noteFile);
      const { frontmatter } = readNote(notePath);

      try {
        // Extract metadata
        const branch = frontmatter.branch as string;
        const worktreePath = frontmatter.worktree_path as string;

        // Check if worktree still exists
        if (!existsSync(worktreePath)) {
          if (options?.verbose) {
            console.log(`⚠️  Worktree missing: ${worktreePath}`);
          }
          continue;
        }

        // Get git info
        const gitInfo = await getGitInfo(worktreePath, branch);
        const daysSinceActivity = calculateDaysSinceActivity(worktreePath);

        // Prepare updates
        const updates: Partial<WorktreeMetadata> = {
          commits_ahead: gitInfo.commitsAhead,
          commits_behind: gitInfo.commitsBehind,
          has_uncommitted_changes: gitInfo.hasUncommittedChanges,
          last_commit_date: gitInfo.lastCommitDate,
          tracking_branch: gitInfo.trackingBranch || undefined,
          days_since_activity: daysSinceActivity,
        };

        // Get repo info for GitHub API calls
        // PR repo: upstream (where PRs are opened), CI repo: origin (where CI runs on your fork)
        const prRepo = await getPRRepoUrl(worktreePath);
        const ciRepo = await getCIRepoUrl(worktreePath);
        const repoName = ciRepo?.split('/')[1] || proj;
        const { branchType, name } = parseBranchFromOldFormat(branch);

        // If PR, fetch PR info first (from upstream where PRs are opened)
        let prNumber: string | undefined;
        if (frontmatter.pr) {
          try {
            const prMatch = (frontmatter.pr as string).match(/\/(\d+)$/);
            if (prMatch) {
              prNumber = prMatch[1];

              const prInfo = await getPRInfo(prNumber, prRepo);
              updates.pr_state = prInfo.state;
              updates.pr_checks = prInfo.checks;
              updates.pr_reviews = prInfo.reviews;
              updates.pr_labels = prInfo.labels;
              updates.pr_updated_at = prInfo.updatedAt;
            }
          } catch (error) {
            if (options?.verbose) {
              console.log(`⚠️  Failed to fetch PR info: ${error}`);
            }
          }
        }

        // Fetch CI status from GitHub Actions
        // For PRs: try upstream first, fall back to origin
        // For branches: use origin
        let ciChecks: 'passing' | 'failing' | 'pending' | 'none' = 'none';
        const ciRepoToUse = prNumber && prRepo !== ciRepo ? prRepo : ciRepo;

        if (ciRepoToUse) {
          try {
            ciChecks = await getBranchCIStatus(ciRepoToUse, name);
            // If PR and upstream returned 'none', try origin as fallback
            if (
              prNumber &&
              ciChecks === 'none' &&
              ciRepoToUse === prRepo &&
              ciRepo &&
              ciRepo !== prRepo
            ) {
              const originCiChecks = await getBranchCIStatus(ciRepo, name);
              if (originCiChecks !== 'none') {
                ciChecks = originCiChecks;
              }
            }
            updates.ci_checks = ciChecks;
          } catch {
            // Ignore CI status fetch errors in bulk sync
          }
        }

        // Smart CI artifact fetching (works for both PRs and branches)
        // For PRs: try upstream first, fall back to origin
        // For branches: use origin
        if (shouldFetchArtifacts(frontmatter, updates.pr_checks, ciChecks)) {
          const artifactRepo = prNumber && prRepo !== ciRepo ? prRepo : ciRepo;
          if (artifactRepo) {
            try {
              const artifactsPath = getCIArtifactsPath(projectsRoot, proj, branchType, name);
              mkdirSync(artifactsPath, { recursive: true });

              const resume = !needsFullFetch(frontmatter, gitInfo.currentSha);
              if (options?.verbose) {
                console.log(`  📦 Fetching CI artifacts (${resume ? 'resume' : 'full'})...`);
              }

              // Use PR number if available, otherwise use branch name
              const ref = prNumber || name;

              try {
                await fetchCIArtifacts(ref, artifactRepo, artifactsPath, resume, repoName, options);
              } catch (upstreamError) {
                // If PR and upstream failed, try origin as fallback
                if (prNumber && artifactRepo === prRepo && ciRepo && ciRepo !== prRepo) {
                  if (options?.verbose) {
                    console.log(`  ⚠️  Upstream failed, trying origin...`);
                  }
                  await fetchCIArtifacts(ref, ciRepo, artifactsPath, resume, repoName, options);
                } else {
                  throw upstreamError;
                }
              }

              const ciMeta = await getCIMetadata(artifactsPath, gitInfo.currentSha);
              Object.assign(updates, ciMeta);

              if (options?.verbose) {
                console.log(
                  `  ✅ CI artifacts: ${ciMeta.ci_status} (${ciMeta.ci_failed_tests} test failures, ${ciMeta.ci_linter_errors} lint errors)`,
                );
              }
            } catch (error) {
              if (options?.verbose) {
                console.log(`  ⚠️  Failed to fetch CI artifacts: ${error}`);
              }
            }
          }
        }

        // Update note
        updateNoteMetadata(notePath, updates);

        if (options?.verbose) {
          console.log(
            `✅ Synced: ${proj}/${branch} (ahead: ${gitInfo.commitsAhead}, behind: ${gitInfo.commitsBehind})`,
          );
        }

        syncedCount++;
      } catch (error) {
        console.error(`❌ Error syncing ${proj}/${noteFile}: ${error}`);
        errorCount++;
      }
    }
  }

  // Check for missing notes and sessions (deleted but worktree still exists)
  let recreatedCount = 0;
  let sessionRecreatedCount = 0;
  const allWorktrees = listWorktrees(selectedProject);

  for (const wt of allWorktrees) {
    const notePath = getNotePath(vaultRoot, wt.project, wt.branch);
    const sessionName = getSessionName(wt.project, wt.branch);

    // If worktree exists but note doesn't, recreate it
    if (!existsSync(notePath)) {
      try {
        const gitInfo = await getGitInfo(wt.path, wt.branch);
        const daysSinceActivity = calculateDaysSinceActivity(wt.path);

        const metadata: Partial<WorktreeMetadata> = {
          project: wt.project,
          branch: wt.branch,
          status: 'in-progress',
          created: new Date().toISOString().split('T')[0],
          repo_url: gitInfo.remoteUrl,
          worktree_path: wt.path,
          base_branch: gitInfo.baseBranch,
          commits_ahead: gitInfo.commitsAhead,
          commits_behind: gitInfo.commitsBehind,
          has_uncommitted_changes: gitInfo.hasUncommittedChanges,
          last_commit_date: gitInfo.lastCommitDate,
          tracking_branch: gitInfo.trackingBranch || undefined,
          days_since_activity: daysSinceActivity,
        };

        createWorktreeNote(notePath, metadata);

        if (options?.verbose) {
          console.log(`📝 Recreated note: ${wt.project}/${wt.branch}`);
        }

        recreatedCount++;
      } catch (error) {
        if (options?.verbose) {
          console.log(`⚠️  Failed to recreate note for ${wt.project}/${wt.branch}: ${error}`);
        }
        errorCount++;
      }
    }

    // If worktree exists but session doesn't, recreate it
    const manager =
      config.terminalMultiplexer === 'zellij'
        ? new ZellijSessionManager()
        : new TmuxSessionManager();

    const sessionExists = await manager.sessionExists(sessionName);
    if (!sessionExists) {
      const configPath = findSessionConfig(wt.project, config);
      if (configPath) {
        try {
          const sessionConfig = loadSessionConfig(configPath);
          await manager.createSession(
            sessionName,
            sessionConfig,
            wt.path,
            wt.project,
            wt.branch,
            notePath,
          );

          if (options?.verbose) {
            console.log(`🖥️  Recreated session: ${wt.project}/${wt.branch}`);
          }

          sessionRecreatedCount++;
        } catch (error) {
          if (options?.verbose) {
            console.log(`⚠️  Failed to recreate session for ${wt.project}/${wt.branch}: ${error}`);
          }
          errorCount++;
        }
      }
    }
  }

  console.log(
    `\n📊 Sync complete: ${syncedCount} updated, ${recreatedCount} notes recreated, ${sessionRecreatedCount} sessions recreated, ${errorCount} errors`,
  );
}
