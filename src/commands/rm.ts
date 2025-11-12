import { join } from 'path';
import { existsSync, rmSync, mkdirSync, cpSync } from 'fs';
import { execa } from 'execa';
import { killSession } from '../lib/terminal-session.js';
import { pickWorktree } from '../lib/worktree-picker.js';
import { loadProjectPaths, getWorktreePath, getNotePath, normalizeBundle } from '../lib/paths.js';

export async function rmCommand(project?: string, branch?: string): Promise<void> {
  // Show picker if project or branch not specified
  if (!project || !branch) {
    const picked = await pickWorktree(project);
    project = picked.project;
    branch = picked.branch;
  }

  const { config, projectsRoot, reposRoot, vaultRoot } = loadProjectPaths();

  // Clean up branch name to match what create uses
  // Remove branch type prefix (feature/, bug/, branch/, pr/) for session name
  let cleanBranch = branch;
  if (branch.startsWith('feature/') || branch.startsWith('bug/')) {
    // Keep feature/ and bug/ prefixes
    cleanBranch = branch;
  } else if (branch.startsWith('branch/')) {
    cleanBranch = branch.slice(7); // Remove "branch/" prefix
  } else if (branch.startsWith('pr/')) {
    // For PR sessions, the branch name was already resolved by create
    cleanBranch = branch.slice(3); // Remove "pr/" prefix (would be PR number)
  }

  const repoPath = join(reposRoot, project);
  const worktreePath = getWorktreePath(projectsRoot, config, project, branch);
  const notePath = getNotePath(vaultRoot, project, branch);
  const archiveDir = join(projectsRoot, 'old');

  console.log(`🗑️  Removing worktree: ${branch}`);

  // Kill session if it exists - use cleaned branch name to match session creation
  const sessionName = `${project}-${cleanBranch.replace(/\//g, '-')}`;
  try {
    await killSession(sessionName, config);
    console.log(`✅ Killed terminal session: ${sessionName}`);
  } catch {
    console.log(`⚠️  Terminal session not found: ${sessionName}`);
  }

  // Check if worktree exists
  if (!existsSync(worktreePath)) {
    console.log(`⚠️  Worktree not found: ${worktreePath}`);
  } else {
    // Remove worktree
    try {
      rmSync(worktreePath, { recursive: true, force: true });
      console.log(`✅ Deleted worktree: ${worktreePath}`);
    } catch (error) {
      console.error(`❌ Failed to delete worktree: ${error}`);
      throw error;
    }
  }

  // Prune repository
  try {
    await execa('git', ['worktree', 'prune'], { cwd: repoPath });
    console.log(`✅ Pruned repository`);
  } catch (error) {
    console.error(`⚠️  Failed to prune repository: ${error}`);
  }

  // Archive note
  if (!existsSync(notePath)) {
    console.log(`⚠️  Note not found: ${notePath}`);
  } else {
    try {
      // Create archive directory if it doesn't exist
      mkdirSync(archiveDir, { recursive: true });

      // Copy note to archive
      const archiveNotePath = join(archiveDir, `${project}-${normalizeBundle(branch)}.md`);
      cpSync(notePath, archiveNotePath);

      // Delete original note
      rmSync(notePath);

      console.log(`✅ Archived note: ${archiveNotePath}`);
    } catch (error) {
      console.error(`❌ Failed to archive note: ${error}`);
      throw error;
    }
  }

  console.log(`\n✅ Done! Worktree removed, note archived to ${archiveDir}`);
}
