import { execa } from 'execa';
import { existsSync } from 'fs';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch, getCurrentWorktreeContext } from '../lib/worktree-list.js';
import { loadProjectPaths, getWorktreePath, parseBranchFromOldFormat } from '../lib/paths.js';
import { createCommand } from './create.js';

export async function claudeCommand(
  project?: string,
  branch?: string,
  prompt?: string,
  options?: {
    continue?: boolean;
    resume?: boolean | string;
    teleport?: string;
    verbose?: boolean;
    this?: boolean;
  },
): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  // For --teleport and --resume without project/branch, run in current directory
  const isSessionResume = options?.teleport || options?.resume !== undefined;
  const noWorktreeSpecified = !project && !branch && !options?.this;

  if (isSessionResume && noWorktreeSpecified) {
    // Run claude with session flags in current directory
    const args: string[] = [];
    if (options?.teleport) {
      args.push('--teleport', options.teleport);
    } else if (options?.resume !== undefined) {
      if (typeof options.resume === 'string') {
        args.push('--resume', options.resume);
      } else {
        args.push('--resume');
      }
    }
    if (prompt) {
      args.push(prompt);
    }

    console.log(`🔍 Opening Claude in current directory`);

    try {
      await execa('claude', args, {
        stdio: 'inherit',
      });
    } catch (error) {
      console.error(`❌ Failed to open Claude: ${error}`);
      process.exit(1);
    }
    return;
  }

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

  const { config, projectsRoot } = loadProjectPaths();
  const { branchType, name } = parseBranchFromOldFormat(selectedBranch);
  const worktreePath = getWorktreePath(projectsRoot, config, selectedProject, branchType, name);

  // Create worktree if it doesn't exist
  if (!existsSync(worktreePath)) {
    console.log(`🌱 Worktree not found, creating: ${selectedProject}/${name}`);
    await createCommand(selectedProject, name, { verbose: options?.verbose });
  }

  try {
    const args: string[] = [];
    if (options?.teleport) {
      args.push('--teleport', options.teleport);
    } else if (options?.resume !== undefined) {
      if (typeof options.resume === 'string') {
        args.push('--resume', options.resume);
      } else {
        args.push('--resume');
      }
    } else if (options?.continue) {
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
