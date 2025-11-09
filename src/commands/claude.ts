import { join } from 'path';
import { existsSync } from 'fs';
import { execa } from 'execa';
import { loadConfig, expandPath } from '../lib/config.js';
import { pickWorktree } from '../lib/worktree-picker.js';

export async function claudeCommand(
  project?: string,
  branch?: string,
  prompt?: string,
  options?: { continue?: boolean },
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
  }

  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);

  const worktreeName = `${selectedProject}-${selectedBranch.replace(/\//g, '-')}`;
  const worktreePath = join(worktreesRoot, worktreeName);

  // Check if worktree exists
  if (!existsSync(worktreePath)) {
    console.error(`❌ Worktree not found: ${worktreePath}`);
    process.exit(1);
  }

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
