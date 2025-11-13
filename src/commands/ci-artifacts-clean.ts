import { existsSync, rmSync } from 'fs';
import { loadConfig, expandPath, getCiArtifactsDir } from '../lib/config.js';
import { listWorktrees, resolveBranch } from '../lib/worktree-list.js';
import { readNote, writeNote } from '../lib/obsidian.js';
import { getNotePath } from '../lib/paths.js';

export async function ciCleanCommand(
  project?: string,
  branch?: string,
  options?: { verbose?: boolean },
): Promise<void> {
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
    // Resolve branch input to full prefixed form (e.g., "structured_tool_state" -> "branch/structured_tool_state")
    const resolvedBranch = resolveBranch(project || '', branch);
    targetWorktrees = worktrees.filter((w) => w.branch === resolvedBranch);
    if (targetWorktrees.length === 0) {
      console.log(`❌ No worktrees found for ${project}/${branch}`);
      return;
    }
  }

  if (options?.verbose) {
    console.log(`🧹 Cleaning CI artifacts for ${targetWorktrees.length} worktree(s)...`);
    console.log(`📂 Artifacts directory: ${ciArtifactsDir}\n`);
  } else {
    console.log(`🧹 Cleaning CI artifacts for ${targetWorktrees.length} worktree(s)...\n`);
  }

  let cleanedCount = 0;
  let skippedCount = 0;

  for (const wt of targetWorktrees) {
    // Get note to check for PR/CI data
    const notePath = getNotePath(vaultRoot, wt.project, wt.branch);

    if (!existsSync(notePath)) {
      if (options?.verbose) {
        console.log(`⚠️  Note not found: ${wt.displayName} (${notePath})`);
      }
      skippedCount++;
      continue;
    }

    const { frontmatter } = readNote(notePath);
    const ciArtifactsPath = frontmatter.ci_artifacts_path as string | undefined;

    if (!ciArtifactsPath) {
      if (options?.verbose) {
        console.log(`⏭️  No CI artifacts: ${wt.displayName}`);
      }
      skippedCount++;
      continue;
    }

    // Delete the artifact directory
    if (existsSync(ciArtifactsPath)) {
      try {
        if (options?.verbose) {
          console.log(`  🗑️  Deleting: ${ciArtifactsPath}`);
        }
        rmSync(ciArtifactsPath, { recursive: true, force: true });

        // Clear CI metadata from note so sync will redownload on next run
        const note = readNote(notePath);
        const keysToDelete = [
          'ci_status',
          'ci_failed_tests',
          'ci_linter_errors',
          'ci_artifacts_path',
          'ci_viewer_url',
          'ci_last_synced',
          'ci_head_sha',
        ];
        keysToDelete.forEach((key) => {
          delete note.frontmatter[key];
        });
        writeNote(notePath, note.frontmatter, note.body);

        console.log(`✅ Cleaned: ${wt.displayName}`);
        cleanedCount++;
      } catch (error) {
        console.error(`❌ Failed to clean ${wt.displayName}: ${error}`);
      }
    } else {
      if (options?.verbose) {
        console.log(`⏭️  Artifact path not found: ${wt.displayName} (${ciArtifactsPath})`);
      } else {
        console.log(`⏭️  Artifact path not found: ${wt.displayName}`);
      }
      skippedCount++;
    }
  }

  console.log(`\n📊 Clean complete: ${cleanedCount} cleaned, ${skippedCount} skipped`);
}
