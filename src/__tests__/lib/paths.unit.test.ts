import { describe, it, expect } from 'vitest';
import { getWorktreePath, getNotePath, getNoteFileName } from '../../lib/paths.js';
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

describe('getNoteFileName', () => {
  it('should handle branch/ prefix', () => {
    const fileName = getNoteFileName('branch/main');
    expect(fileName).toBe('main.md');
  });

  it('should handle feature/ prefix', () => {
    const fileName = getNoteFileName('feature/cool-stuff');
    expect(fileName).toBe('cool-stuff.md');
  });

  it('should handle bug/ prefix', () => {
    const fileName = getNoteFileName('bug/fix-it');
    expect(fileName).toBe('fix-it.md');
  });

  it('should handle pr/ prefix', () => {
    const fileName = getNoteFileName('pr/1234');
    expect(fileName).toBe('1234.md');
  });

  it('should normalize slashes in branch names', () => {
    const fileName = getNoteFileName('branch/fix/bug-123');
    expect(fileName).toBe('fix-bug-123.md');
  });

  it('should normalize slashes in feature names', () => {
    const fileName = getNoteFileName('feature/cool/new/stuff');
    expect(fileName).toBe('cool-new-stuff.md');
  });

  it('should handle plain names without prefix', () => {
    const fileName = getNoteFileName('main');
    expect(fileName).toBe('main.md');
  });

  it('should handle plain names with slashes', () => {
    const fileName = getNoteFileName('cool/feature');
    expect(fileName).toBe('cool-feature.md');
  });

  it('should create consistent note paths when parsed from getNotePath', () => {
    const fileName = getNoteFileName('branch/unwind');
    const path = getNotePath('/vault', 'galaxy', 'branch/unwind');
    expect(path).toBe(`/vault/projects/galaxy/worktrees/${fileName}`);
    expect(fileName).toBe('unwind.md');
  });
});
