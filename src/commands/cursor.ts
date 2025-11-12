import { execa } from 'execa';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch } from '../lib/worktree-list.js';
import { loadProjectPaths, getWorktreePath } from '../lib/paths.js';
import { assertWorktreeExists } from '../lib/errors.js';

export async function cursorCommand(
  project?: string,
  branch?: string,
  options?: { verbose?: boolean },
): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  // If either is missing, show picker
  if (!selectedProject || !selectedBranch) {
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

  const { config, projectsRoot } = loadProjectPaths();
  const worktreePath = getWorktreePath(projectsRoot, config, selectedProject, selectedBranch);

  // Check if worktree exists
  assertWorktreeExists(worktreePath);

  try {
    await execa('cursor', [worktreePath]);
    console.log(`💻 Opened in Cursor: ${worktreePath}`);
  } catch (error) {
    console.error(`❌ Failed to open Cursor: ${error}`);
    process.exit(1);
  }
}

