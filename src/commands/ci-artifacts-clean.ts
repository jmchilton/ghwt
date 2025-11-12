import { join } from 'path';
import { existsSync, rmSync, readdirSync } from 'fs';
import { loadConfig, expandPath, getCiArtifactsDir } from '../lib/config.js';
import { listWorktrees } from '../lib/worktree-list.js';
import { readNote } from '../lib/obsidian.js';
import { getCIArtifactsPath } from '../lib/ci-artifacts.js';

export async function ciCleanCommand(project?: string, branch?: string): Promise<void> {
  const config = loadConfig();
  const vaultRoot = expandPath(config.vaultPath);
  const ciArtifactsDir = getCiArtifactsDir(config);

  const worktrees = listWorktrees(project);

  if (worktrees.length === 0) {
    console.log('❌ No worktrees found');
    return;
  }

  // Filter by branch if provided
  let targetWorktrees = worktrees;
  if (branch) {
    targetWorktrees = worktrees.filter((w) => w.branch === branch);
    if (targetWorktrees.length === 0) {
      console.log(`❌ No worktrees found for ${project}/${branch}`);
      return;
    }
  }

  console.log(`🧹 Cleaning CI artifacts for ${targetWorktrees.length} worktree(s)...\n`);

  let cleanedCount = 0;
  let skippedCount = 0;

  for (const wt of targetWorktrees) {
    // Get note to check for PR/CI data
    const notePath = join(vaultRoot, 'projects', wt.project, 'worktrees', wt.branch.replace(/\//g, '-') + '.md');

    if (!existsSync(notePath)) {
      if (project && branch) {
        // Only log if explicitly targeting
        console.log(`⚠️  Note not found: ${wt.displayName}`);
      }
      skippedCount++;
      continue;
    }

    const { frontmatter } = readNote(notePath);
    const ciArtifactsPath = frontmatter.ci_artifacts_path as string | undefined;

    if (!ciArtifactsPath) {
      if (project && branch) {
        console.log(`⏭️  No CI artifacts: ${wt.displayName}`);
      }
      skippedCount++;
      continue;
    }

    // Delete the artifact directory
    if (existsSync(ciArtifactsPath)) {
      try {
        rmSync(ciArtifactsPath, { recursive: true, force: true });
        console.log(`✅ Cleaned: ${wt.displayName}`);
        cleanedCount++;
      } catch (error) {
        console.error(`❌ Failed to clean ${wt.displayName}: ${error}`);
      }
    } else {
      console.log(`⏭️  Artifact path not found: ${wt.displayName}`);
      skippedCount++;
    }
  }

  console.log(`\n📊 Clean complete: ${cleanedCount} cleaned, ${skippedCount} skipped`);
}
