import { existsSync } from 'fs';

/**
 * Assert that a path exists, exit with error message if not
 */
export function assertPathExists(path: string, label: string): void {
  if (!existsSync(path)) {
    console.error(`❌ ${label} not found: ${path}`);
    process.exit(1);
  }
}

/**
 * Assert that a worktree directory exists
 */
export function assertWorktreeExists(path: string): void {
  assertPathExists(path, 'Worktree');
}

/**
 * Assert that a note file exists
 */
export function assertNoteExists(path: string): void {
  assertPathExists(path, 'Note');
}

/**
 * Assert that a repository directory exists
 */
export function assertRepoExists(path: string): void {
  assertPathExists(path, 'Repository');
}
