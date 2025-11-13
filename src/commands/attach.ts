import { attachCommand, type AttachCommandOptions } from '../lib/terminal-session.js';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch } from '../lib/worktree-list.js';
import { loadProjectPaths, getWorktreePath, parseBranchFromOldFormat } from '../lib/paths.js';
import { assertWorktreeExists } from '../lib/errors.js';

export async function attachCmd(
  project?: string,
  branch?: string,
  options?: AttachCommandOptions,
): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  // If either is missing, show picker
  if (!selectedProject || !selectedBranch) {
    const picked = await pickWorktree(project);
    selectedProject = picked.project;
    selectedBranch = picked.branch;
  } else if (selectedBranch && selectedProject) {
    // Resolve branch to get the full reference with type prefix
    selectedBranch = resolveBranch(selectedProject, selectedBranch);
  }

  const { config, projectsRoot } = loadProjectPaths();
  const { branchType, name } = parseBranchFromOldFormat(selectedBranch);
  const worktreePath = getWorktreePath(projectsRoot, config, selectedProject, branchType, name);

  // Check if worktree exists
  assertWorktreeExists(worktreePath);

  try {
    await attachCommand(selectedProject, selectedBranch, worktreePath, config, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to attach: ${message}`);
    process.exit(1);
  }
}
