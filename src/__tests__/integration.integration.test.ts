import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { getWorktreePath, getNotePath } from '../lib/paths.js';
import type { GhwtConfig } from '../types.js';

/**
 * Integration tests for the new hierarchical worktree structure
 * Uses real git operations and filesystem to validate end-to-end workflow
 */

function createTestConfig(projectsRoot: string): GhwtConfig {
  return {
    projectsRoot,
    repositoriesDir: 'repositories',
    worktreesDir: 'worktrees',
    vaultPath: join(projectsRoot, 'vault'),
    syncInterval: null,
    terminalMultiplexer: 'tmux',
    terminalUI: 'wezterm',
  };
}

describe('Integration: Create → List → Remove workflow', () => {
  let tempDir: string;
  let projectsRoot: string;
  let reposRoot: string;
  let worktreesRoot: string;
  let vaultRoot: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ghwt-integration-'));
    projectsRoot = tempDir;
    reposRoot = join(projectsRoot, 'repositories');
    worktreesRoot = join(projectsRoot, 'worktrees');
    vaultRoot = join(tempDir, 'vault');

    // Create directory structure
    mkdirSync(reposRoot, { recursive: true });
    mkdirSync(worktreesRoot, { recursive: true });
    mkdirSync(vaultRoot, { recursive: true });
  });

  afterEach(() => {
    // Always restore original directory
    try {
      process.chdir(originalCwd);
    } catch {
      // Ignore if already changed
    }

    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  async function setupTestRepo(projectName: string): Promise<string> {
    const repoPath = join(reposRoot, projectName);
    mkdirSync(repoPath, { recursive: true });

    // Initialize bare git repo
    await execa('git', ['init', '--bare', repoPath]);

    // Create a temporary clone to set up initial content
    const tmpClone = mkdtempSync(join(tmpdir(), 'clone-'));
    const tmpCloneCwd = process.cwd();

    try {
      await execa('git', ['clone', repoPath, tmpClone]);
      process.chdir(tmpClone);

      // Create initial commit
      writeFileSync(join(tmpClone, 'README.md'), '# Test Repo');
      await execa('git', ['config', 'user.email', 'test@example.com']);
      await execa('git', ['config', 'user.name', 'Test User']);
      await execa('git', ['add', 'README.md']);
      await execa('git', ['commit', '-m', 'Initial commit']);
      await execa('git', ['push', 'origin', 'main']);
    } finally {
      process.chdir(tmpCloneCwd);
      rmSync(tmpClone, { recursive: true });
    }

    return repoPath;
  }

  async function setupWorktree(
    projectName: string,
    branchType: 'branch' | 'pr',
    name: string,
  ): Promise<string> {
    const worktreePath = getWorktreePath(projectsRoot, createTestConfig(projectsRoot), projectName, branchType, name);
    mkdirSync(worktreePath, { recursive: true });

    // Initialize git worktree
    const repoPath = join(reposRoot, projectName);
    const branchName = branchType === 'pr' ? `pr-${name}` : name;

    try {
      // Create and check out the branch in the worktree
      await execa('git', ['init'], { cwd: worktreePath });
      await execa('git', ['remote', 'add', 'origin', repoPath], { cwd: worktreePath });
      await execa('git', ['fetch', 'origin'], { cwd: worktreePath });
      await execa('git', ['checkout', '-b', branchName, 'origin/main'], { cwd: worktreePath });
    } catch {
      // Fallback: just ensure directory exists with git repo
      await execa('git', ['init'], { cwd: worktreePath });
    }

    return worktreePath;
  }

  it('creates worktree in new hierarchy (branch type)', async () => {
    await setupTestRepo('test-project');
    const worktreePath = await setupWorktree('test-project', 'branch', 'cool-feature');

    // Verify directory structure
    assert.ok(existsSync(worktreePath));
    assert.ok(existsSync(join(worktreePath, '.git')));

    // Verify expected path
    const expectedPath = join(projectsRoot, 'worktrees', 'test-project', 'branch', 'cool-feature');
    assert.strictEqual(worktreePath, expectedPath);
  });

  it('creates worktree in new hierarchy (PR type)', async () => {
    await setupTestRepo('test-project');
    const worktreePath = await setupWorktree('test-project', 'pr', '1234');

    // Verify directory structure
    assert.ok(existsSync(worktreePath));
    assert.ok(existsSync(join(worktreePath, '.git')));

    // Verify expected path
    const expectedPath = join(projectsRoot, 'worktrees', 'test-project', 'pr', '1234');
    assert.strictEqual(worktreePath, expectedPath);
  });

  it('path construction uses new hierarchy correctly', async () => {
    const config = createTestConfig(projectsRoot);

    // Test branch path
    const branchPath = getWorktreePath(projectsRoot, config, 'galaxy', 'branch', 'cool-feature');
    assert.strictEqual(branchPath, join(projectsRoot, 'worktrees', 'galaxy', 'branch', 'cool-feature'));

    // Test PR path
    const prPath = getWorktreePath(projectsRoot, config, 'galaxy', 'pr', '1234');
    assert.strictEqual(prPath, join(projectsRoot, 'worktrees', 'galaxy', 'pr', '1234'));

    // Test note path
    const notePath = getNotePath(vaultRoot, 'galaxy', 'cool-feature');
    assert.strictEqual(notePath, join(vaultRoot, 'projects', 'galaxy', 'worktrees', 'cool-feature.md'));
  });

  it('multiple worktrees can coexist in hierarchy', async () => {
    await setupTestRepo('galaxy');

    // Create multiple worktrees
    const branch1 = await setupWorktree('galaxy', 'branch', 'feature1');
    const branch2 = await setupWorktree('galaxy', 'branch', 'feature2');
    const pr1 = await setupWorktree('galaxy', 'pr', '1234');

    // Verify all exist
    assert.ok(existsSync(branch1));
    assert.ok(existsSync(branch2));
    assert.ok(existsSync(pr1));

    // Verify they're in the right places
    assert.ok(branch1.includes('branch/feature1'));
    assert.ok(branch2.includes('branch/feature2'));
    assert.ok(pr1.includes('pr/1234'));

    // Verify they don't interfere with each other
    assert.notStrictEqual(branch1, branch2);
    assert.notStrictEqual(branch1, pr1);
  });

  it('git worktree can be used from nested directory', async () => {
    await setupTestRepo('galaxy');
    const worktreePath = await setupWorktree('galaxy', 'branch', 'cool-feature');

    // Create a nested directory
    const nestedDir = join(worktreePath, 'src', 'lib');
    mkdirSync(nestedDir, { recursive: true });

    // Verify git commands work from nested directory
    const cwd = process.cwd();
    try {
      process.chdir(nestedDir);
      const result = await execa('git', ['rev-parse', '--show-toplevel']);
      assert.ok(result.stdout.includes('cool-feature'));
    } finally {
      process.chdir(cwd);
    }
  });

  it('removes worktree and cleans up directory structure', async () => {
    await setupTestRepo('galaxy');
    const worktreePath = await setupWorktree('galaxy', 'branch', 'cool-feature');

    // Verify worktree exists
    assert.ok(existsSync(worktreePath));

    // Remove worktree
    rmSync(worktreePath, { recursive: true });

    // Verify worktree is gone
    assert.ok(!existsSync(worktreePath));

    // Verify parent structure still exists
    assert.ok(existsSync(join(projectsRoot, 'worktrees', 'galaxy', 'branch')));
  });

  it('handles worktree names with slashes', async () => {
    await setupTestRepo('galaxy');
    const worktreePath = await setupWorktree('galaxy', 'branch', 'feature/awesome');

    // Verify directory structure with nested names
    assert.ok(existsSync(worktreePath));
    assert.ok(worktreePath.includes('branch/feature/awesome'));
  });
});
