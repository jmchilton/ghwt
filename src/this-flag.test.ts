import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { getCurrentWorktreeContext } from './lib/worktree-list.js';
import { getWorktreePath } from './lib/paths.js';
import type { GhwtConfig } from './types.js';

/**
 * Tests for --this flag functionality
 * Validates that commands can detect current worktree context
 * Uses GHWT_CONFIG env var for isolated test config
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

describe('--this flag: getCurrentWorktreeContext', () => {
  let tempDir: string;
  let projectsRoot: string;
  let reposRoot: string;
  let worktreesRoot: string;
  let configPath: string;
  const originalCwd = process.cwd();
  const originalGhwtConfig = process.env.GHWT_CONFIG;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ghwt-this-flag-'));
    projectsRoot = tempDir;
    reposRoot = join(projectsRoot, 'repositories');
    worktreesRoot = join(projectsRoot, 'worktrees');
    configPath = join(tempDir, '.ghwtrc.json');

    mkdirSync(reposRoot, { recursive: true });
    mkdirSync(worktreesRoot, { recursive: true });

    // Write config file to temp directory
    writeFileSync(configPath, JSON.stringify(createTestConfig(projectsRoot)));

    // Set GHWT_CONFIG to use test config
    process.env.GHWT_CONFIG = configPath;
  });

  afterEach(() => {
    try {
      process.chdir(originalCwd);
    } catch {
      // Ignore
    }

    // Restore env var
    if (originalGhwtConfig === undefined) {
      delete process.env.GHWT_CONFIG;
    } else {
      process.env.GHWT_CONFIG = originalGhwtConfig;
    }

    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  async function setupTestRepo(projectName: string): Promise<string> {
    const repoPath = join(reposRoot, projectName);
    mkdirSync(repoPath, { recursive: true });
    await execa('git', ['init', '--bare', repoPath]);

    const tmpClone = mkdtempSync(join(tmpdir(), 'clone-'));
    const tmpCloneCwd = process.cwd();

    try {
      await execa('git', ['clone', repoPath, tmpClone]);
      process.chdir(tmpClone);

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

    const repoPath = join(reposRoot, projectName);
    const branchName = branchType === 'pr' ? `pr-${name}` : name;

    try {
      await execa('git', ['init'], { cwd: worktreePath });
      await execa('git', ['remote', 'add', 'origin', repoPath], { cwd: worktreePath });
      await execa('git', ['fetch', 'origin'], { cwd: worktreePath });
      await execa('git', ['checkout', '-b', branchName, 'origin/main'], { cwd: worktreePath });
    } catch {
      await execa('git', ['init'], { cwd: worktreePath });
    }

    return worktreePath;
  }

  it('detects branch worktree from root directory', async () => {
    await setupTestRepo('galaxy');
    const worktreePath = await setupWorktree('galaxy', 'branch', 'cool-feature');

    const cwd = process.cwd();
    try {
      process.chdir(worktreePath);
      const context = await getCurrentWorktreeContext();

      assert.strictEqual(context.project, 'galaxy');
      assert.strictEqual(context.branch, 'branch/cool-feature');
    } finally {
      process.chdir(cwd);
    }
  });

  it('detects PR worktree from root directory', async () => {
    await setupTestRepo('galaxy');
    const worktreePath = await setupWorktree('galaxy', 'pr', '1234');

    const cwd = process.cwd();
    try {
      process.chdir(worktreePath);
      const context = await getCurrentWorktreeContext();

      assert.strictEqual(context.project, 'galaxy');
      assert.strictEqual(context.branch, 'pr/1234');
    } finally {
      process.chdir(cwd);
    }
  });

  it('detects worktree from deeply nested subdirectory', async () => {
    await setupTestRepo('galaxy');
    const worktreePath = await setupWorktree('galaxy', 'branch', 'cool-feature');

    // Create nested structure
    const deepPath = join(worktreePath, 'src', 'lib', 'utils', 'helpers');
    mkdirSync(deepPath, { recursive: true });

    const cwd = process.cwd();
    try {
      process.chdir(deepPath);
      const context = await getCurrentWorktreeContext();

      assert.strictEqual(context.project, 'galaxy');
      assert.strictEqual(context.branch, 'branch/cool-feature');
    } finally {
      process.chdir(cwd);
    }
  });

  it('detects worktree with slash in branch name', async () => {
    await setupTestRepo('galaxy');
    const worktreePath = await setupWorktree('galaxy', 'branch', 'feature/awesome-stuff');

    const cwd = process.cwd();
    try {
      process.chdir(worktreePath);
      const context = await getCurrentWorktreeContext();

      assert.strictEqual(context.project, 'galaxy');
      assert.strictEqual(context.branch, 'branch/feature/awesome-stuff');
    } finally {
      process.chdir(cwd);
    }
  });

  it('throws error when not in worktree', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));

    const cwd = process.cwd();
    try {
      process.chdir(outsideDir);
      await assert.rejects(
        async () => {
          await getCurrentWorktreeContext();
        },
        /Not in a ghwt worktree directory/,
      );
    } finally {
      process.chdir(cwd);
      rmSync(outsideDir, { recursive: true });
    }
  });

  it('distinguishes between different projects', async () => {
    await setupTestRepo('galaxy');
    await setupTestRepo('other-project');

    const galaxyWorktree = await setupWorktree('galaxy', 'branch', 'feat1');
    const otherWorktree = await setupWorktree('other-project', 'branch', 'feat2');

    const cwd = process.cwd();
    try {
      // Check galaxy project
      process.chdir(galaxyWorktree);
      let context = await getCurrentWorktreeContext();
      assert.strictEqual(context.project, 'galaxy');
      assert.strictEqual(context.branch, 'branch/feat1');

      // Check other project
      process.chdir(otherWorktree);
      context = await getCurrentWorktreeContext();
      assert.strictEqual(context.project, 'other-project');
      assert.strictEqual(context.branch, 'branch/feat2');
    } finally {
      process.chdir(cwd);
    }
  });

  it('walks up directory tree correctly with multiple levels', async () => {
    await setupTestRepo('galaxy');
    const worktreePath = await setupWorktree('galaxy', 'branch', 'cool-feature');

    // Create multiple nested directories
    const level1 = join(worktreePath, 'src');
    const level2 = join(level1, 'components');
    const level3 = join(level2, 'buttons');
    mkdirSync(level3, { recursive: true });

    const cwd = process.cwd();
    try {
      // Test detection from each level
      for (const testPath of [level3, level2, level1, worktreePath]) {
        process.chdir(testPath);
        const context = await getCurrentWorktreeContext();
        assert.strictEqual(context.project, 'galaxy');
        assert.strictEqual(context.branch, 'branch/cool-feature');
      }
    } finally {
      process.chdir(cwd);
    }
  });

  it('handles multiple worktrees of same project independently', async () => {
    await setupTestRepo('galaxy');
    const feat1 = await setupWorktree('galaxy', 'branch', 'feature1');
    const feat2 = await setupWorktree('galaxy', 'branch', 'feature2');
    const pr100 = await setupWorktree('galaxy', 'pr', '100');

    const cwd = process.cwd();
    try {
      // Check feature1
      process.chdir(feat1);
      let context = await getCurrentWorktreeContext();
      assert.strictEqual(context.branch, 'branch/feature1');

      // Check feature2
      process.chdir(feat2);
      context = await getCurrentWorktreeContext();
      assert.strictEqual(context.branch, 'branch/feature2');

      // Check PR
      process.chdir(pr100);
      context = await getCurrentWorktreeContext();
      assert.strictEqual(context.branch, 'pr/100');
    } finally {
      process.chdir(cwd);
    }
  });
});
