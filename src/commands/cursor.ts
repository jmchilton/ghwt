import { join } from 'path';
import { existsSync } from 'fs';
import { execa } from 'execa';
import { loadConfig, expandPath } from '../lib/config.js';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch } from '../lib/worktree-list.js';

export async function cursorCommand(project?: string, branch?: string): Promise<void> {
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
    await execa('cursor', [worktreePath]);
    console.log(`💻 Opened in Cursor: ${worktreePath}`);
  } catch (error) {
    console.error(`❌ Failed to open Cursor: ${error}`);
    process.exit(1);
  }
}

