import { execa } from 'execa';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch } from '../lib/worktree-list.js';
import { loadProjectPaths, getWorktreePath } from '../lib/paths.js';
import { assertWorktreeExists } from '../lib/errors.js';

export async function claudeCommand(
  project?: string,
  branch?: string,
  prompt?: string,
  options?: { continue?: boolean; verbose?: boolean },
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
    const args: string[] = [];
    if (options?.continue) {
      args.push('--continue');
    }
    if (prompt) {
      args.push(prompt);
    }

    console.log(`🔍 Opening Claude in ${selectedProject}/${selectedBranch}`);

    await execa('claude', args, {
      cwd: worktreePath,
      stdio: 'inherit',
    });
  } catch (error) {
    console.error(`❌ Failed to open Claude: ${error}`);
    process.exit(1);
  }
}
