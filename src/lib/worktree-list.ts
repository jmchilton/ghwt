import { join, resolve } from 'path';
import { readdirSync, existsSync, realpathSync } from 'fs';
import { loadConfig, expandPath } from './config.js';
import { execa } from 'execa';

export interface WorktreeInfo {
  project: string;
  branch: string;
  path: string;
  displayName: string; // "project: branch" for display
}

export interface WorktreeContext {
  project: string;
  branch: string;
}

/**
 * Check if a directory is a git worktree by looking for a .git file (not directory).
 * Worktrees have a .git file containing "gitdir: /path/to/main/repo/.git/worktrees/..."
 */
function isGitWorktree(dirPath: string): boolean {
  const gitPath = join(dirPath, '.git');
  if (!existsSync(gitPath)) return false;

  try {
    const stat = readdirSync(dirPath, { withFileTypes: true }).find((e) => e.name === '.git');
    // It's a worktree if .git is a file (not a directory)
    return stat !== undefined && stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Recursively find git worktrees under a branchType directory.
 * Supports nested branch names like "claude/plan-index-detection".
 */
function findWorktreesRecursive(
  branchTypePath: string,
  branchType: string,
  project: string,
  prefix: string = '',
): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];

  try {
    const entries = readdirSync(branchTypePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const entryPath = join(branchTypePath, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (isGitWorktree(entryPath)) {
        // Found a worktree
        worktrees.push({
          project,
          branch: `${branchType}/${name}`,
          path: entryPath,
          displayName: `${project}: ${branchType}/${name}`,
        });
      } else {
        // Not a worktree, recurse into subdirectory
        const nested = findWorktreesRecursive(entryPath, branchType, project, name);
        worktrees.push(...nested);
      }
    }
  } catch {
    // Skip directories that can't be read
  }

  return worktrees;
}

/**
 * Get list of all worktrees, optionally filtered by project
 * Scans hierarchical structure: worktrees/{project}/{branchType}/{name}
 * Supports nested branch names like "claude/plan-index-detection"
 */
export function listWorktrees(filterProject?: string): WorktreeInfo[] {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);

  if (!existsSync(worktreesRoot)) {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];

  try {
    const projectEntries = readdirSync(worktreesRoot, { withFileTypes: true });

    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) continue;

      const project = projectEntry.name;

      // Apply project filter if provided
      if (filterProject && project !== filterProject) {
        continue;
      }

      const projectPath = join(worktreesRoot, project);

      try {
        const branchTypeEntries = readdirSync(projectPath, { withFileTypes: true });

        for (const branchTypeEntry of branchTypeEntries) {
          if (!branchTypeEntry.isDirectory()) continue;

          const branchType = branchTypeEntry.name;

          // Only process valid branch types
          if (branchType !== 'branch' && branchType !== 'pr') {
            continue;
          }

          const branchTypePath = join(projectPath, branchType);

          // Recursively find worktrees (supports nested branch names)
          const found = findWorktreesRecursive(branchTypePath, branchType, project);
          worktrees.push(...found);
        }
      } catch {
        // Skip project directories that can't be read
        continue;
      }
    }

    // Sort by project, then by branch
    worktrees.sort((a, b) => {
      if (a.project !== b.project) {
        return a.project.localeCompare(b.project);
      }
      return a.branch.localeCompare(b.branch);
    });
  } catch (error) {
    console.error(`Failed to list worktrees: ${error}`);
  }

  return worktrees;
}

/**
 * Format worktree for display in picker
 */
export function formatWorktreeForDisplay(info: WorktreeInfo): string {
  return `${info.displayName}`;
}

/**
 * Resolve a branch name by checking the filesystem.
 * Works with new hierarchical structure: worktrees/{project}/{branchType}/{name}
 *
 * Examples:
 * - resolveBranch('galaxy', 'structured_tool_state') -> 'branch/structured_tool_state'
 * - resolveBranch('galaxy', 'cool-feature') -> 'branch/cool-feature'
 * - resolveBranch('galaxy', '1234') -> 'pr/1234'
 * - resolveBranch('galaxy', 'branch/cool-feature') -> 'branch/cool-feature' (passthrough)
 *
 * @returns The resolved branch name with prefix, or the input if no match found
 */
export function resolveBranch(project: string, branchInput: string): string {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);
  const projectPath = join(worktreesRoot, project);

  if (!existsSync(projectPath)) {
    return branchInput; // Fallback to input if project path doesn't exist
  }

  // If the input already has a prefix, return as-is
  if (
    branchInput.startsWith('feature/') ||
    branchInput.startsWith('bug/') ||
    branchInput.startsWith('branch/') ||
    branchInput.startsWith('pr/')
  ) {
    return branchInput;
  }

  try {
    // Determine if input looks like a PR number (all digits)
    const isPRInput = /^\d+$/.test(branchInput);

    // Try to find matching directory
    if (isPRInput) {
      // Look in pr/ directory
      const prPath = join(projectPath, 'pr');
      if (existsSync(prPath)) {
        const entries = readdirSync(prPath, { withFileTypes: true });
        if (entries.some((e) => e.isDirectory() && e.name === branchInput)) {
          return `pr/${branchInput}`;
        }
      }
    } else {
      // Look in branch/ directory
      const branchPath = join(projectPath, 'branch');
      if (existsSync(branchPath)) {
        const entries = readdirSync(branchPath, { withFileTypes: true });

        // Try exact match first
        if (entries.some((e) => e.isDirectory() && e.name === branchInput)) {
          return `branch/${branchInput}`;
        }

        // Try matching with normalization (convert / to -)
        const normalizedInput = branchInput.replace(/\//g, '-');
        if (entries.some((e) => e.isDirectory() && e.name === normalizedInput)) {
          return `branch/${branchInput}`;
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Silently fail and return input
  }

  return branchInput; // Fallback to input if no match found
}

/**
 * Detect current worktree from directory hierarchy.
 * Uses git rev-parse --show-toplevel to find worktree root, then walks up
 * looking for: worktrees/{project}/(branch|pr)/{name}
 *
 * @returns WorktreeContext with project and branch
 * @throws Error if not in a worktree directory
 */
export async function getCurrentWorktreeContext(): Promise<WorktreeContext> {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const worktreesDir = config.worktreesDir || 'worktrees';
  const worktreeRoot = realpathSync(join(projectsRoot, worktreesDir));

  try {
    // Get git worktree root and resolve it, following symlinks
    const { stdout } = await execa('git', ['rev-parse', '--show-toplevel']);
    let currentPath = realpathSync(stdout.trim());

    // Walk up directory tree looking for worktrees/{project}/{type}/{name}
    while (currentPath.startsWith(worktreeRoot)) {
      const relativePath = currentPath.slice(worktreeRoot.length + 1); // Remove leading separator
      const parts = relativePath.split('/').filter(Boolean);

      // Need at least project, type, and name
      if (parts.length >= 3) {
        const project = parts[0];
        const branchType = parts[1];

        // Validate branch type
        if (branchType === 'branch' || branchType === 'pr') {
          const name = parts.slice(2).join('/');
          const branch = `${branchType}/${name}`;

          return { project, branch };
        }
      }

      // Move up one directory
      const parentPath = resolve(join(currentPath, '..'));
      if (parentPath === currentPath) {
        break; // Reached filesystem root
      }
      currentPath = parentPath;
    }

    // Not in worktree hierarchy
    throw new Error(
      'Not in a ghwt worktree directory. ' +
        `Run from within ${worktreeRoot}/{project}/(branch|pr)/{name}/`,
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error('git command not found');
    }

    // Re-throw our error message, or wrap other errors
    if (error instanceof Error && error.message.includes('ghwt worktree')) {
      throw error;
    }

    throw new Error(
      'Not in a ghwt worktree directory. ' +
        `Run from within ${worktreeRoot}/{project}/(branch|pr)/{name}/`,
    );
  }
}
