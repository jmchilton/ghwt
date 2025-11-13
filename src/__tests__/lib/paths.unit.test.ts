import { describe, it, expect } from 'vitest';
import { getWorktreePath, getNotePath } from '../../lib/paths.js';
import { GhwtConfig } from '../../types.js';

describe('paths', () => {
  const createTestConfig = (worktreesDir = 'worktrees'): GhwtConfig => ({
    projectsRoot: '/home/projects',
    repositoriesDir: 'repositories',
    worktreesDir,
    vaultPath: '/vault',
    syncInterval: null,
    terminalMultiplexer: 'tmux',
    terminalUI: 'wezterm',
  });

  it('should construct worktree path for branch with new hierarchy', () => {
    const config = createTestConfig();
    const path = getWorktreePath('/home/projects', config, 'galaxy', 'branch', 'cool-feature');
    expect(path).toBe('/home/projects/worktrees/galaxy/branch/cool-feature');
  });

  it('should construct worktree path for PR with new hierarchy', () => {
    const config = createTestConfig();
    const path = getWorktreePath('/home/projects', config, 'galaxy', 'pr', '1234');
    expect(path).toBe('/home/projects/worktrees/galaxy/pr/1234');
  });

  it('should construct note path correctly', () => {
    const path = getNotePath('/vault', 'galaxy', 'cool-feature');
    expect(path).toBe('/vault/projects/galaxy/worktrees/cool-feature.md');
  });

  it('should handle branch names with slashes', () => {
    const config = createTestConfig();
    const path = getWorktreePath('/home/projects', config, 'galaxy', 'branch', 'fix/bug-123');
    expect(path).toBe('/home/projects/worktrees/galaxy/branch/fix/bug-123');
  });
});
