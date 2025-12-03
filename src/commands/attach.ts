import { attachCommand, type AttachCommandOptions } from '../lib/terminal-session.js';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch, getCurrentWorktreeContext } from '../lib/worktree-list.js';
import { loadProjectPaths, getWorktreePath, parseBranchFromOldFormat } from '../lib/paths.js';
import { assertWorktreeExists } from '../lib/errors.js';

export async function attachCmd(
  project?: string,
  branch?: string,
  options?: AttachCommandOptions & { this?: boolean },
): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  // If --this flag is set, use current worktree context
  if (options?.this) {
    try {
      const context = await getCurrentWorktreeContext();
      selectedProject = context.project;
      selectedBranch = context.branch;
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else if (!selectedProject || !selectedBranch) {
    // If either is missing, show picker
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
    // Pass 'name' (without branch/ or pr/ prefix) for consistent session naming
    await attachCommand(selectedProject, name, worktreePath, config, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to attach: ${message}`);
    process.exit(1);
  }
}
