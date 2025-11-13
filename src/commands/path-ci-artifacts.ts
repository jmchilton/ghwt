import { existsSync } from 'fs';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch, getCurrentWorktreeContext } from '../lib/worktree-list.js';
import { loadProjectPaths, parseBranchFromOldFormat } from '../lib/paths.js';
import { getCIArtifactsPath } from '../lib/ci-artifacts.js';

export async function pathCiArtifactsCommand(
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

  const { projectsRoot } = loadProjectPaths();
  const { branchType, name } = parseBranchFromOldFormat(selectedBranch);
  const artifactsPath = getCIArtifactsPath(projectsRoot, selectedProject, branchType, name);

  // Output path if it exists, otherwise output nothing
  // Exit code is always 0 (machine-readable output)
  if (existsSync(artifactsPath)) {
    console.log(artifactsPath);
  }
}
