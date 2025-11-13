import { execa } from 'execa';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch } from '../lib/worktree-list.js';
import { loadProjectPaths, getWorktreePath, parseBranchFromOldFormat } from '../lib/paths.js';
import { assertWorktreeExists } from '../lib/errors.js';

export async function codeCommand(
  project?: string,
  branch?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const { branchType, name } = parseBranchFromOldFormat(selectedBranch);
  const worktreePath = getWorktreePath(projectsRoot, config, selectedProject, branchType, name);

  // Check if worktree exists
  assertWorktreeExists(worktreePath);

  try {
    await execa('code', [worktreePath]);
    console.log(`💻 Opened in VS Code: ${worktreePath}`);
  } catch (error) {
    console.error(`❌ Failed to open VS Code: ${error}`);
    process.exit(1);
  }
}
