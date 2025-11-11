import { join } from 'path';
import { loadConfig, expandPath } from './config.js';
import { GhwtConfig } from '../types.js';

/**
 * Normalize branch name by replacing slashes with hyphens
 * @example "feature/main" -> "feature-main"
 */
export function normalizeBundle(branch: string): string {
  return branch.replace(/\//g, '-');
}

/**
 * Get the worktree directory name from project and branch
 * @example getWorktreeName('galaxy', 'feature/main') -> 'galaxy-feature-main'
 */
export function getWorktreeName(project: string, branch: string): string {
  return `${project}-${normalizeBundle(branch)}`;
}

/**
 * Get the full path to a worktree directory
 */
export function getWorktreePath(
  projectsRoot: string,
  config: GhwtConfig,
  project: string,
  branch: string,
): string {
  const worktreesRoot = join(projectsRoot, config.worktreesDir);
  return join(worktreesRoot, getWorktreeName(project, branch));
}

/**
 * Get the full path to a worktree note file
 */
export function getNotePath(vaultRoot: string, project: string, branch: string): string {
  return join(
    vaultRoot,
    'projects',
    project,
    'worktrees',
    `${normalizeBundle(branch)}.md`,
  );
}

/**
 * Get the session name for a worktree (used by terminal multiplexers)
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
