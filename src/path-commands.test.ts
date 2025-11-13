import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { pathCiArtifactsCommand } from './commands/path-ci-artifacts.js';
import { pathNoteCommand } from './commands/path-note.js';
import { getWorktreePath } from './lib/paths.js';
import type { GhwtConfig } from './types.js';

/**
 * Tests for path-ci-artifacts and path-note commands
 * Uses real filesystem and GHWT_CONFIG env var for isolation
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

describe('path commands: pathCiArtifactsCommand and pathNoteCommand', () => {
  let tempDir: string;
  let projectsRoot: string;
  let configPath: string;
  let originalCwd: string;
  let originalGhwtConfig: string | undefined;
  let consoleLogOutput: string[] = [];

  beforeEach(() => {
    // Setup temp directory
    tempDir = mkdtempSync(join(tmpdir(), 'ghwt-path-cmd-'));
    projectsRoot = tempDir;
    configPath = join(tempDir, '.ghwtrc.json');

    // Create necessary directories
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(projectsRoot, 'ci-artifacts'), { recursive: true });
    mkdirSync(join(projectsRoot, 'vault'), { recursive: true });

    // Write config file
    writeFileSync(configPath, JSON.stringify(createTestConfig(projectsRoot)));

    // Set env vars
    originalCwd = process.cwd();
    originalGhwtConfig = process.env.GHWT_CONFIG;
    process.env.GHWT_CONFIG = configPath;

    // Capture console output
    consoleLogOutput = [];
    const originalLog = console.log;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console.log as any) = (...args: string[]): void => {
      consoleLogOutput.push(args.join(' '));
    };
    // Store original for restoration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console.log as any).original = originalLog;
  });

  afterEach(() => {
    // Restore console.log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log = (console.log as any).original || console.log;

    // Restore cwd
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

    // Cleanup temp dir
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore
    }
  });

  async function setupTestRepo(projectName: string): Promise<string> {
    const repoPath = join(projectsRoot, 'repositories', projectName);
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

    const repoPath = join(projectsRoot, 'repositories', projectName);
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

  function setupCIArtifacts(projectName: string, branchType: 'branch' | 'pr', name: string): string {
    const artifactsPath = join(projectsRoot, 'ci-artifacts', projectName, branchType, name);
    mkdirSync(artifactsPath, { recursive: true });
    writeFileSync(join(artifactsPath, 'summary.json'), JSON.stringify({ status: 'complete' }));
    return artifactsPath;
  }

  describe('pathCiArtifactsCommand', () => {
    it('outputs path when artifacts exist with explicit args', async () => {
      await setupTestRepo('galaxy');
      await setupWorktree('galaxy', 'branch', 'cool-feature');
      const artifactsPath = setupCIArtifacts('galaxy', 'branch', 'cool-feature');

      consoleLogOutput = [];
      await pathCiArtifactsCommand('galaxy', 'branch/cool-feature', { verbose: false });

      assert.strictEqual(consoleLogOutput.length, 1);
      assert.strictEqual(consoleLogOutput[0], artifactsPath);
    });

    it('outputs nothing when artifacts do not exist', async () => {
      await setupTestRepo('galaxy');
      await setupWorktree('galaxy', 'branch', 'cool-feature');

      consoleLogOutput = [];
      await pathCiArtifactsCommand('galaxy', 'branch/cool-feature', { verbose: false });

      assert.strictEqual(consoleLogOutput.length, 0);
    });

    it('outputs correct path for PR worktree', async () => {
      await setupTestRepo('galaxy');
      await setupWorktree('galaxy', 'pr', '1234');
      const artifactsPath = setupCIArtifacts('galaxy', 'pr', '1234');

      consoleLogOutput = [];
      await pathCiArtifactsCommand('galaxy', 'pr/1234', { verbose: false });

      assert.strictEqual(consoleLogOutput.length, 1);
      assert.strictEqual(consoleLogOutput[0], artifactsPath);
    });

    it('outputs correct path when using --this flag from within worktree', async () => {
      await setupTestRepo('galaxy');
      const worktreePath = await setupWorktree('galaxy', 'branch', 'cool-feature');
      const artifactsPath = setupCIArtifacts('galaxy', 'branch', 'cool-feature');

      consoleLogOutput = [];
      const cwd = process.cwd();
      try {
        process.chdir(worktreePath);
        await pathCiArtifactsCommand(undefined, undefined, { this: true, verbose: false });

        assert.strictEqual(consoleLogOutput.length, 1);
        assert.strictEqual(consoleLogOutput[0], artifactsPath);
      } finally {
        process.chdir(cwd);
      }
    });

    it('errors when using --this flag from outside worktree', async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));

      consoleLogOutput = [];
      const cwd = process.cwd();
      const originalExit = process.exit;
      let exitCalled = false;

      try {
        process.chdir(outsideDir);

        // Mock process.exit to prevent actual exit
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.exit as any) = (): void => {
          exitCalled = true;
        };

        try {
          await pathCiArtifactsCommand(undefined, undefined, { this: true, verbose: false });
        } catch {
          // Expected
        }

        // Verify that process.exit was called (indicates error was handled)
        assert.strictEqual(exitCalled, true);
      } finally {
        process.exit = originalExit;
        process.chdir(cwd);
        rmSync(outsideDir, { recursive: true });
      }
    });
  });

  describe('pathNoteCommand', () => {
    it('outputs path with explicit args', async () => {
      await setupTestRepo('galaxy');
      await setupWorktree('galaxy', 'branch', 'cool-feature');

      consoleLogOutput = [];
      await pathNoteCommand('galaxy', 'branch/cool-feature', { verbose: false });

      assert.strictEqual(consoleLogOutput.length, 1);
      assert(consoleLogOutput[0].includes('vault/projects/galaxy/worktrees/cool-feature.md'));
    });

    it('outputs correct path for PR worktree', async () => {
      await setupTestRepo('galaxy');
      await setupWorktree('galaxy', 'pr', '1234');

      consoleLogOutput = [];
      await pathNoteCommand('galaxy', 'pr/1234', { verbose: false });

      assert.strictEqual(consoleLogOutput.length, 1);
      assert(consoleLogOutput[0].includes('vault/projects/galaxy/worktrees/1234.md'));
    });

    it('outputs correct path when using --this flag from within worktree', async () => {
      await setupTestRepo('galaxy');
      const worktreePath = await setupWorktree('galaxy', 'branch', 'cool-feature');

      consoleLogOutput = [];
      const cwd = process.cwd();
      try {
        process.chdir(worktreePath);
        await pathNoteCommand(undefined, undefined, { this: true, verbose: false });

        assert.strictEqual(consoleLogOutput.length, 1);
        assert(consoleLogOutput[0].includes('vault/projects/galaxy/worktrees/cool-feature.md'));
      } finally {
        process.chdir(cwd);
      }
    });

    it('outputs correct path for branch with slash in name', async () => {
      await setupTestRepo('galaxy');
      await setupWorktree('galaxy', 'branch', 'feature/awesome-stuff');

      consoleLogOutput = [];
      await pathNoteCommand('galaxy', 'branch/feature/awesome-stuff', { verbose: false });

      assert.strictEqual(consoleLogOutput.length, 1);
      assert(consoleLogOutput[0].includes('vault/projects/galaxy/worktrees/feature-awesome-stuff.md'));
    });

    it('errors when using --this flag from outside worktree', async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));

      consoleLogOutput = [];
      const cwd = process.cwd();
      const originalExit = process.exit;
      let exitCalled = false;

      try {
        process.chdir(outsideDir);

        // Mock process.exit to prevent actual exit
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (process.exit as any) = (): void => {
          exitCalled = true;
        };

        try {
          await pathNoteCommand(undefined, undefined, { this: true, verbose: false });
        } catch {
          // Expected
        }

        // Verify that process.exit was called (indicates error was handled)
        assert.strictEqual(exitCalled, true);
      } finally {
        process.exit = originalExit;
        process.chdir(cwd);
        rmSync(outsideDir, { recursive: true });
      }
    });
  });
});
