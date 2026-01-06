import { execa } from 'execa';
import { existsSync, readdirSync } from 'fs';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch, getCurrentWorktreeContext } from '../lib/worktree-list.js';
import { loadProjectPaths, getWorktreePath, parseBranchFromOldFormat } from '../lib/paths.js';
import { createCommand } from './create.js';

/**
 * Prompt user to select a project from available repositories.
 */
async function pickProject(reposRoot: string): Promise<string | null> {
  if (!existsSync(reposRoot)) return null;

  const projects = readdirSync(reposRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (projects.length === 0) return null;
  if (projects.length === 1) return projects[0];

  const { default: Enquirer } = await import('enquirer');
  const enquirer = new Enquirer();

  const response = (await enquirer.prompt({
    type: 'select',
    name: 'project',
    message: 'Select project for teleport session:',
    choices: projects,
  })) as { project: string };

  return response.project;
}

/**
 * Prompt user to enter a branch name.
 */
async function promptBranchName(): Promise<string> {
  const { default: Enquirer } = await import('enquirer');
  const enquirer = new Enquirer();

  const response = (await enquirer.prompt({
    type: 'input',
    name: 'branch',
    message: 'Enter branch name for new worktree:',
    initial: 'main',
  })) as { branch: string };

  return response.branch;
}

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

  const { config, projectsRoot, reposRoot } = loadProjectPaths();

  // For --teleport without project/branch, prompt for project and branch
  if (options?.teleport && !project && !branch && !options?.this) {
    // First, let user pick the project
    const pickedProject = await pickProject(reposRoot);
    if (!pickedProject) {
      console.error(`❌ No projects found in ${reposRoot}`);
      process.exit(1);
    }
    selectedProject = pickedProject;

    // Then, either pick existing worktree or create new one
    const picked = await pickWorktree(selectedProject);
    if (picked.project && picked.branch) {
      selectedProject = picked.project;
      selectedBranch = picked.branch;
    } else {
      // User cancelled picker or no worktrees exist, prompt for new branch
      const branchName = await promptBranchName();
      selectedBranch = `branch/${branchName}`;
    }
  } else if (options?.resume !== undefined && !project && !branch && !options?.this) {
    // For --resume without project/branch, run in current directory
    const args: string[] = [];
    if (typeof options.resume === 'string') {
      args.push('--resume', options.resume);
    } else {
      args.push('--resume');
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
  } else if (options?.this) {
    // If --this flag is set, use current worktree context
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
