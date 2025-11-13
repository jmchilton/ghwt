import { join } from 'path';
import { loadConfig, expandPath } from './config.js';
import { GhwtConfig } from '../types.js';

/**
 * Normalize path by replacing slashes with hyphens (for file/session naming)
 * @example "branch/main" -> "branch-main"
 * @example "pr/1234" -> "pr-1234"
 */
export function normalizeBundle(branch: string): string {
  return branch.replace(/\//g, '-');
}

/**
 * Get the full path to a worktree directory using hierarchical structure:
 * worktrees/{project}/{branchType}/{name}
 *
 * @param projectsRoot The projects root directory
 * @param config Configuration
 * @param project Project name
 * @param branchType 'branch' or 'pr'
 * @param name Branch name (without type prefix) or PR number
 * @returns Full path to worktree directory
 */
export function getWorktreePath(
  projectsRoot: string,
  config: GhwtConfig,
  project: string,
  branchType: 'branch' | 'pr',
  name: string,
): string {
  const worktreesRoot = join(projectsRoot, config.worktreesDir);
  return join(worktreesRoot, project, branchType, name);
}

/**
 * Parse branch string in old format (e.g., "feature/main", "bug/fix", "branch/name", "pr/1234")
 * into branchType and name for the new hierarchy
 *
 * @param branch Branch string in old format with prefix
 * @returns { branchType: 'branch' | 'pr', name: string }
 */
export function parseBranchFromOldFormat(branch: string): {
  branchType: 'branch' | 'pr';
  name: string;
} {
  if (branch.startsWith('feature/') || branch.startsWith('bug/') || branch.startsWith('branch/')) {
    const name = branch.split('/').slice(1).join('/');
    return { branchType: 'branch', name };
  }
  if (branch.startsWith('pr/')) {
    const name = branch.slice(3);
    return { branchType: 'pr', name };
  }
  // Default to branch type if no prefix
  return { branchType: 'branch', name: branch };
}

/**
 * Get the note filename for a branch, handling type prefix parsing
 * Extracts the branch name from type-prefixed references and normalizes it
 * @example getNoteFileName('branch/main') -> 'main.md'
 * @example getNoteFileName('pr/1234') -> '1234.md'
 * @example getNoteFileName('main') -> 'main.md'
 * @example getNoteFileName('feature/cool-stuff') -> 'cool-stuff.md'
 */
export function getNoteFileName(branch: string): string {
  const { name } = parseBranchFromOldFormat(branch);
  return `${normalizeBundle(name)}.md`;
}

/**
 * Get the full path to a worktree note file
 * @example getNotePath(vaultRoot, 'galaxy', 'branch/main') -> '.../projects/galaxy/worktrees/main.md'
 * @example getNotePath(vaultRoot, 'galaxy', 'pr/1234') -> '.../projects/galaxy/worktrees/1234.md'
 */
export function getNotePath(vaultRoot: string, project: string, branch: string): string {
  return join(vaultRoot, 'projects', project, 'worktrees', getNoteFileName(branch));
}

/**
 * Get the session name for a worktree (used by terminal multiplexers)
 * Combines project and normalized branch with hyphens
 * @example getSessionName('galaxy', 'branch/cool-feature') -> 'galaxy-branch-cool-feature'
 * @example getSessionName('galaxy', 'pr/1234') -> 'galaxy-pr-1234'
 */
export function getSessionName(project: string, branch: string): string {
  return `${project}-${normalizeBundle(branch)}`;
}

/**
 * Container for all resolved project paths
 */
export interface ProjectPaths {
  config: GhwtConfig;
  projectsRoot: string;
  reposRoot: string;
  worktreesRoot: string;
  vaultRoot: string;
}

/**
 * Load and expand all project paths from config
 */
export function loadProjectPaths(): ProjectPaths {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);

  return {
    config,
    projectsRoot,
    reposRoot: join(projectsRoot, config.repositoriesDir),
    worktreesRoot: join(projectsRoot, config.worktreesDir),
    vaultRoot: expandPath(config.vaultPath),
  };
}
