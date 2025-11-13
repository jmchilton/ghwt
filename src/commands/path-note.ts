import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch, getCurrentWorktreeContext } from '../lib/worktree-list.js';
import { loadProjectPaths, getNotePath, parseBranchFromOldFormat } from '../lib/paths.js';
import { expandPath } from '../lib/config.js';

export async function pathNoteCommand(
  project?: string,
  branch?: string,
  options?: { verbose?: boolean; this?: boolean },
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
    if (!selectedProject || !selectedBranch) {
      console.error(`❌ Failed to pick worktree`);
      process.exit(1);
    }
  } else if (selectedBranch && selectedProject) {
    // Resolve branch to get the full reference with type prefix
    selectedBranch = resolveBranch(selectedProject, selectedBranch);
  }

  const { config } = loadProjectPaths();
  const { name } = parseBranchFromOldFormat(selectedBranch);

  // For notes, use just the name (note path doesn't need type prefix)
  const vaultRoot = expandPath(config.vaultPath);
  const notePath = getNotePath(vaultRoot, selectedProject, name);

  // Output path
  // Exit code is always 0 (machine-readable output)
  console.log(notePath);
}
