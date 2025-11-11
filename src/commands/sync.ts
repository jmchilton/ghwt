import { join } from 'path';
import { existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { loadConfig, expandPath, getCiArtifactsDir } from '../lib/config.js';
import { getGitInfo } from '../lib/git.js';
import { getPRInfo } from '../lib/github.js';
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
import { listWorktrees } from '../lib/worktree-list.js';
import { findSessionConfig, loadSessionConfig } from '../lib/terminal-session.js';
import { TmuxSessionManager } from '../lib/terminal-session-tmux.js';
import { ZellijSessionManager } from '../lib/terminal-session-zellij.js';
import { getNotePath, getSessionName } from '../lib/paths.js';
import { WorktreeMetadata } from '../types.js';

export async function syncCommand(
  project?: string,
  options?: { verbose?: boolean },
): Promise<void> {
  const config = loadConfig();
  const vaultRoot = expandPath(config.vaultPath);
  const ciArtifactsDir = getCiArtifactsDir(config);

  const projectsPath = join(vaultRoot, 'projects');

  console.log('🔄 Syncing worktree metadata...\n');

  let syncedCount = 0;
  let errorCount = 0;

  // Scan projects
  const projectDirs = project
    ? [project]
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

        // If PR, fetch PR info
        if (frontmatter.pr) {
          try {
            // Extract PR number from URL
            const prMatch = (frontmatter.pr as string).match(/\/(\d+)$/);
            if (prMatch) {
              const prNumber = prMatch[1];
              // Get repo context from worktree
              const repoUrl = gitInfo.remoteUrl;
              const repoMatch = repoUrl.match(/[:/]([^/]+)\/(.+?)(?:\.git)?$/);
              const ghRepo = repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : undefined;
              const repoName = repoMatch ? repoMatch[2].replace(/\.git$/, '') : proj;

              const prInfo = await getPRInfo(prNumber, ghRepo);
              updates.pr_state = prInfo.state;
              updates.pr_checks = prInfo.checks;
              updates.pr_reviews = prInfo.reviews;
              updates.pr_labels = prInfo.labels;
              updates.pr_updated_at = prInfo.updatedAt;

              // Smart CI artifact fetching (only for PRs)
              if (frontmatter.pr && shouldFetchArtifacts(frontmatter, prInfo.checks)) {
                try {
                  const artifactsPath = getCIArtifactsPath(ciArtifactsDir, repoName, prNumber);

                  // Create directory if it doesn't exist
                  mkdirSync(artifactsPath, { recursive: true });

                  // Determine if we need full fetch or can resume
                  const resume = !needsFullFetch(frontmatter, gitInfo.currentSha);

                  if (options?.verbose) {
                    console.log(`  📦 Fetching CI artifacts (${resume ? 'resume' : 'full'})...`);
                  }

                  await fetchCIArtifacts(
                    prNumber,
                    ghRepo || repoName,
                    artifactsPath,
                    resume,
                    repoName,
                    options,
                  );

                  // Parse CI summary and update metadata
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
          } catch (error) {
            if (options?.verbose) {
              console.log(`⚠️  Failed to fetch PR info: ${error}`);
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
  const allWorktrees = listWorktrees(project);

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
          await manager.createSession(sessionName, sessionConfig, wt.path);

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
