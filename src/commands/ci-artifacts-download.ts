import { join } from 'path';
import { existsSync } from 'fs';
import { loadConfig, expandPath } from '../lib/config.js';
import { listWorktrees, resolveBranch } from '../lib/worktree-list.js';
import { readNote, updateNoteMetadata } from '../lib/obsidian.js';
import { getGitInfo, getUpstreamUrl } from '../lib/git.js';
import { getCIArtifactsPath, fetchAndUpdateCIMetadata } from '../lib/ci-artifacts.js';
import { parseBranchFromOldFormat } from '../lib/paths.js';

export async function ciDownloadCommand(
  project?: string,
  branch?: string,
  options?: { verbose?: boolean },
): Promise<void> {
  const config = loadConfig();
  const vaultRoot = expandPath(config.vaultPath);
  const projectsRoot = expandPath(config.projectsRoot);

  const worktrees = listWorktrees(project);

  if (worktrees.length === 0) {
    console.log('❌ No worktrees found');
    return;
  }

  // Filter by branch if provided
  let targetWorktrees = worktrees;
  if (branch) {
    // Resolve branch input to full prefixed form (e.g., "structured_tool_state" -> "branch/structured_tool_state")
    const resolvedBranch = resolveBranch(project || '', branch);
    targetWorktrees = worktrees.filter((w) => w.branch === resolvedBranch);
    if (targetWorktrees.length === 0) {
      console.log(`❌ No worktrees found for ${project}/${branch}`);
      return;
    }
  }

  console.log(`📥 Downloading CI artifacts for ${targetWorktrees.length} worktree(s)...\n`);

  let downloadedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const wt of targetWorktrees) {
    // Get note to check for PR/CI data
    const notePath = join(
      vaultRoot,
      'projects',
      wt.project,
      'worktrees',
      wt.branch.replace(/\//g, '-') + '.md',
    );

    if (!existsSync(notePath)) {
      if (options?.verbose) {
        console.log(`⚠️  Note not found: ${wt.displayName} (${notePath})`);
      }
      skippedCount++;
      continue;
    }

    const { frontmatter } = readNote(notePath);
    const prUrl = frontmatter.pr as string | undefined;

    if (!prUrl) {
      if (options?.verbose) {
        console.log(`⏭️  Not a PR: ${wt.displayName}`);
      }
      skippedCount++;
      continue;
    }

    try {
      // Get git info for the worktree
      const gitInfo = await getGitInfo(wt.path, wt.branch);

      // Extract PR number and repo info
      const prMatch = prUrl.match(/\/(\d+)$/);
      if (!prMatch) {
        console.error(`❌ Invalid PR URL: ${wt.displayName}`);
        errorCount++;
        continue;
      }

      const prNumber = prMatch[1];

      // Check for upstream remote first (for forked repos)
      const upstreamUrl = await getUpstreamUrl(wt.path);
      const repoUrl = upstreamUrl || gitInfo.remoteUrl;
      const repoMatch = repoUrl.match(/[:/]([^/]+)\/(.+?)(?:\.git)?$/);
      const ghRepo = repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : undefined;
      const repoName = repoMatch ? repoMatch[2].replace(/\.git$/, '') : wt.project;

      if (!ghRepo) {
        console.error(`❌ Could not parse repo URL: ${wt.displayName}`);
        errorCount++;
        continue;
      }

      if (options?.verbose && upstreamUrl) {
        console.log(`  💡 Using upstream repo (fork detected)`);
      }

      const { branchType, name } = parseBranchFromOldFormat(wt.branch);
      const artifactsPath = getCIArtifactsPath(projectsRoot, wt.project, branchType, name);

      if (options?.verbose) {
        console.log(`  🔄 ${wt.displayName}`);
        console.log(`     PR: #${prNumber} (${ghRepo})`);
        console.log(`     📍 Output: ${artifactsPath}`);
      }

      // Fetch and update metadata
      const ciMeta = await fetchAndUpdateCIMetadata(
        prNumber,
        ghRepo,
        artifactsPath,
        gitInfo.currentSha,
        repoName,
        options,
      );

      // Update note with new metadata
      updateNoteMetadata(notePath, ciMeta);

      if (options?.verbose) {
        console.log(`     ✅ Status: ${ciMeta.ci_status}`);
      }

      console.log(`✅ Downloaded: ${wt.displayName}`);
      downloadedCount++;
    } catch (error) {
      console.error(`❌ Failed to download ${wt.displayName}: ${error}`);
      errorCount++;
    }
  }

  console.log(
    `\n📊 Download complete: ${downloadedCount} downloaded, ${skippedCount} skipped, ${errorCount} errors`,
  );
}
