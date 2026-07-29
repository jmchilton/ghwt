import { join } from 'path';
import { existsSync, rmSync, mkdirSync, cpSync } from 'fs';
import { execa } from 'execa';
import { killSession } from '../lib/terminal-session.js';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch } from '../lib/worktree-list.js';
import { assertWorktreeExists } from '../lib/errors.js';
import {
  loadProjectPaths,
  getWorktreePath,
  getNotePath,
  normalizeBundle,
  parseBranchFromOldFormat,
  getSessionName,
  getZellijSessionPath,
} from '../lib/paths.js';

export async function rmCommand(
  project?: string,
  branch?: string,
  options?: { verbose?: boolean },
): Promise<void> {
  // Show picker if project or branch not specified
  if (!project || !branch) {
    const picked = await pickWorktree(project);
    project = picked.project;
    branch = picked.branch;
  } else {
    // Resolve branch to get the full reference with type prefix, so a bare PR
    // number lands on pr/<n> rather than the branch/ fallback
    branch = resolveBranch(project, branch);
  }

  const { config, projectsRoot, reposRoot, vaultRoot } = loadProjectPaths();

  const repoPath = join(reposRoot, project);
  const { branchType, name } = parseBranchFromOldFormat(branch);
  const worktreePath = getWorktreePath(projectsRoot, config, project, branchType, name);
  const notePath = getNotePath(vaultRoot, project, name);
  const archiveDir = join(projectsRoot, 'old');

  console.log(`🗑️  Removing worktree: ${branch}`);

  // Kill session if it exists - use getSessionName for consistency
  const sessionName = getSessionName(project, branch);
  try {
    await killSession(sessionName, config);
    console.log(`✅ Killed terminal session: ${sessionName}`);
  } catch {
    console.log(`⚠️  Terminal session not found: ${sessionName}`);
  }

  // Bail out before the note is archived - a missing worktree means the argument
  // did not name anything, not that there is nothing left to do
  assertWorktreeExists(worktreePath);

  // Remove worktree
  try {
    rmSync(worktreePath, { recursive: true, force: true });
    console.log(`✅ Deleted worktree: ${worktreePath}`);
  } catch (error) {
    console.error(`❌ Failed to delete worktree: ${error}`);
    throw error;
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

  // Delete zellij session layout if it exists
  const zellijLayoutPath = getZellijSessionPath(projectsRoot, config, project, branch);
  if (!existsSync(zellijLayoutPath)) {
    if (options?.verbose) {
      console.log(`⚠️  Zellij layout not found: ${zellijLayoutPath}`);
    }
  } else {
    try {
      rmSync(zellijLayoutPath);
      console.log(`✅ Deleted zellij layout: ${zellijLayoutPath}`);
    } catch (error) {
      console.error(`❌ Failed to delete zellij layout: ${error}`);
      throw error;
    }
  }

  console.log(`\n✅ Done! Worktree removed, note archived to ${archiveDir}`);
}
