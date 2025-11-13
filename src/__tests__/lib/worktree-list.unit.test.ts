import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listWorktrees, resolveBranch } from '../../lib/worktree-list.js';
import { writeFileSync } from 'fs';

describe('worktree-list', () => {
  it('listWorktrees discovers worktrees in hierarchical structure', () => {
    // Create temporary directory structure
    const testRoot = join(tmpdir(), `ghwt-test-${Date.now()}`);
    const worktreesDir = join(testRoot, 'worktrees');

    try {
      // Create test worktree structure
      mkdirSync(join(worktreesDir, 'galaxy', 'branch', 'cool-feature'), {
        recursive: true,
      });
      mkdirSync(join(worktreesDir, 'galaxy', 'pr', '1234'), {
        recursive: true,
      });
      mkdirSync(join(worktreesDir, 'gxformat2', 'branch', 'test-branch'), {
        recursive: true,
      });

      // Set GHWT_CONFIG to point to test root
      const configPath = join(testRoot, '.ghwtrc.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          projectsRoot: testRoot,
          repositoriesDir: 'repositories',
          worktreesDir: 'worktrees',
          vaultPath: join(testRoot, 'vault'),
          obsidianVaultName: 'test-vault',
          terminalMultiplexer: 'tmux',
        }),
      );

      process.env.GHWT_CONFIG = configPath;

      // List worktrees
      const worktrees = listWorktrees();

      // Verify discovery
      assert.strictEqual(worktrees.length, 3);

      // Verify branch worktree
      const branchWt = worktrees.find(
        (w) => w.project === 'galaxy' && w.branch === 'branch/cool-feature',
      );
      assert.ok(branchWt);
      assert.strictEqual(
        branchWt.path,
        join(worktreesDir, 'galaxy', 'branch', 'cool-feature'),
      );

      // Verify PR worktree
      const prWt = worktrees.find(
        (w) => w.project === 'galaxy' && w.branch === 'pr/1234',
      );
      assert.ok(prWt);
      assert.strictEqual(prWt.path, join(worktreesDir, 'galaxy', 'pr', '1234'));

      // Verify second project
      const gxWt = worktrees.find(
        (w) => w.project === 'gxformat2' && w.branch === 'branch/test-branch',
      );
      assert.ok(gxWt);
      assert.strictEqual(
        gxWt.path,
        join(worktreesDir, 'gxformat2', 'branch', 'test-branch'),
      );
    } finally {
      delete process.env.GHWT_CONFIG;
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('resolveBranch finds branch in branch/ subdirectory', () => {
    const testRoot = join(tmpdir(), `ghwt-test-${Date.now()}`);
    const worktreesDir = join(testRoot, 'worktrees');

    try {
      mkdirSync(join(worktreesDir, 'galaxy', 'branch', 'cool-feature'), {
        recursive: true,
      });

      const configPath = join(testRoot, '.ghwtrc.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          projectsRoot: testRoot,
          repositoriesDir: 'repositories',
          worktreesDir: 'worktrees',
          vaultPath: join(testRoot, 'vault'),
          obsidianVaultName: 'test-vault',
          terminalMultiplexer: 'tmux',
        }),
      );

      process.env.GHWT_CONFIG = configPath;

      // Resolve branch name
      const resolved = resolveBranch('galaxy', 'cool-feature');
      assert.strictEqual(resolved, 'branch/cool-feature');
    } finally {
      delete process.env.GHWT_CONFIG;
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('resolveBranch finds PR in pr/ subdirectory', () => {
    const testRoot = join(tmpdir(), `ghwt-test-${Date.now()}`);
    const worktreesDir = join(testRoot, 'worktrees');

    try {
      mkdirSync(join(worktreesDir, 'galaxy', 'pr', '1234'), {
        recursive: true,
      });

      const configPath = join(testRoot, '.ghwtrc.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          projectsRoot: testRoot,
          repositoriesDir: 'repositories',
          worktreesDir: 'worktrees',
          vaultPath: join(testRoot, 'vault'),
          obsidianVaultName: 'test-vault',
          terminalMultiplexer: 'tmux',
        }),
      );

      process.env.GHWT_CONFIG = configPath;

      // Resolve PR number
      const resolved = resolveBranch('galaxy', '1234');
      assert.strictEqual(resolved, 'pr/1234');
    } finally {
      delete process.env.GHWT_CONFIG;
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('resolveBranch returns original if not found', () => {
    const testRoot = join(tmpdir(), `ghwt-test-${Date.now()}`);
    const worktreesDir = join(testRoot, 'worktrees');

    try {
      mkdirSync(join(worktreesDir, 'galaxy', 'branch', 'other-branch'), {
        recursive: true,
      });

      const configPath = join(testRoot, '.ghwtrc.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          projectsRoot: testRoot,
          repositoriesDir: 'repositories',
          worktreesDir: 'worktrees',
          vaultPath: join(testRoot, 'vault'),
          obsidianVaultName: 'test-vault',
          terminalMultiplexer: 'tmux',
        }),
      );

      process.env.GHWT_CONFIG = configPath;

      // Resolve non-existent branch
      const resolved = resolveBranch('galaxy', 'nonexistent');
      assert.strictEqual(resolved, 'nonexistent');
    } finally {
      delete process.env.GHWT_CONFIG;
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('listWorktrees returns empty list when no worktrees exist', () => {
    const testRoot = join(tmpdir(), `ghwt-test-${Date.now()}`);

    try {
      mkdirSync(join(testRoot, 'worktrees'), { recursive: true });

      const configPath = join(testRoot, '.ghwtrc.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          projectsRoot: testRoot,
          repositoriesDir: 'repositories',
          worktreesDir: 'worktrees',
          vaultPath: join(testRoot, 'vault'),
          obsidianVaultName: 'test-vault',
          terminalMultiplexer: 'tmux',
        }),
      );

      process.env.GHWT_CONFIG = configPath;

      const worktrees = listWorktrees();
      assert.strictEqual(worktrees.length, 0);
    } finally {
      delete process.env.GHWT_CONFIG;
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('listWorktrees filters by project name', () => {
    const testRoot = join(tmpdir(), `ghwt-test-${Date.now()}`);
    const worktreesDir = join(testRoot, 'worktrees');

    try {
      // Create worktrees for multiple projects
      mkdirSync(join(worktreesDir, 'galaxy', 'branch', 'feature'), {
        recursive: true,
      });
      mkdirSync(join(worktreesDir, 'gxformat2', 'branch', 'feature'), {
        recursive: true,
      });

      const configPath = join(testRoot, '.ghwtrc.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          projectsRoot: testRoot,
          repositoriesDir: 'repositories',
          worktreesDir: 'worktrees',
          vaultPath: join(testRoot, 'vault'),
          obsidianVaultName: 'test-vault',
          terminalMultiplexer: 'tmux',
        }),
      );

      process.env.GHWT_CONFIG = configPath;

      // List only galaxy worktrees
      const worktrees = listWorktrees('galaxy');
      assert.strictEqual(worktrees.length, 1);
      assert.strictEqual(worktrees[0].project, 'galaxy');
    } finally {
      delete process.env.GHWT_CONFIG;
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('worktree-list module loads', () => {
    // Ensure module compiles
    assert.ok(true);
  });
});
