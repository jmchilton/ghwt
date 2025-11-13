import { join, resolve } from 'path';
import { readdirSync, existsSync } from 'fs';
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
 * Get list of all worktrees, optionally filtered by project
 */
export function listWorktrees(filterProject?: string): WorktreeInfo[] {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);
  const repositoriesRoot = join(projectsRoot, config.repositoriesDir || 'repositories');

  if (!existsSync(worktreesRoot)) {
    return [];
  }

  // Get list of actual project names from repositories
  let projectNames: string[] = [];
  if (existsSync(repositoriesRoot)) {
    try {
      projectNames = readdirSync(repositoriesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.length - a.length); // Sort by length descending for longest match
    } catch (error) {
      console.error(`Failed to list repositories: ${error}`);
    }
  }

  const worktrees: WorktreeInfo[] = [];

  try {
    const entries = readdirSync(worktreesRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Parse worktree name by matching against known project names
      let project = '';
      let branch = '';

      // Find matching project name (use longest match to handle "galaxy" vs "galaxy-architecture")
      for (const projectName of projectNames) {
        if (entry.name.startsWith(projectName + '-')) {
          project = projectName;
          const remainder = entry.name.slice(projectName.length + 1); // +1 for the hyphen
          branch = remainder.replace(/-/g, '/'); // Convert hyphens back to slashes
          break;
        }
      }

      // Fallback if project not found in repositories
      if (!project) {
        const parts = entry.name.split('-');
        if (parts.length < 2) continue;
        project = parts[0];
        branch = parts.slice(1).join('/');
      }

      // Apply project filter if provided
      if (filterProject && project !== filterProject) {
        continue;
      }

      const path = join(worktreesRoot, entry.name);
      worktrees.push({
        project,
        branch,
        path,
        displayName: `${project}: ${branch}`,
      });
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
 * Makes the branch type prefix (feature/, bug/, branch/, pr/) optional at runtime.
 *
 * Examples:
 * - resolveBranch('galaxy', 'structured_tool_state') -> 'branch/structured_tool_state'
 * - resolveBranch('galaxy', 'feature-main') -> 'feature/main'
 * - resolveBranch('galaxy', 'feature/main') -> 'feature/main' (passthrough)
 *
 * @returns The resolved branch name with prefix, or the input if no match found
 */
export function resolveBranch(project: string, branchInput: string): string {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);

  if (!existsSync(worktreesRoot)) {
    return branchInput; // Fallback to input if worktrees root doesn't exist
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
    const entries = readdirSync(worktreesRoot, { withFileTypes: true });

    // Convert input to directory name pattern (replace / with -)
    const normalizedInput = branchInput.replace(/\//g, '-');

    // Try matching in order: feature, bug, branch, pr
    const typePrefixes = ['feature', 'bug', 'branch', 'pr'];

    for (const type of typePrefixes) {
      const expectedDirName = `${project}-${type}-${normalizedInput}`;
      if (entries.some((e) => e.isDirectory() && e.name === expectedDirName)) {
        return `${type}/${branchInput.replace(/-/g, '/')}`;
      }
    }

    // Fallback: look for any directory matching project-<anything>-input
    // This handles cases where the input itself contains hyphens
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const expectedPrefix = `${project}-`;
      if (!entry.name.startsWith(expectedPrefix)) continue;

      const remainder = entry.name.slice(expectedPrefix.length);

      // Try to match by extracting type and comparing the rest
      const parts = remainder.split('-');
      if (parts.length >= 2) {
        const type = parts[0];
        if (['feature', 'bug', 'branch', 'pr'].includes(type)) {
          const nameFromDir = parts.slice(1).join('-');
          if (nameFromDir === normalizedInput) {
            return `${type}/${nameFromDir.replace(/-/g, '/')}`;
          }
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
  const worktreeRoot = resolve(join(projectsRoot, worktreesDir));

  try {
    // Get git worktree root and resolve it
    const { stdout } = await execa('git', ['rev-parse', '--show-toplevel']);
    let currentPath = resolve(stdout.trim());

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
        break; // Reached root
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
