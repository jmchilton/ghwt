import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { rmCommand } from '../../commands/rm.js';

/**
 * `rm` accepts the same branch argument as `create`: a bare PR number, or a bare
 * branch name. Regression coverage for a bare number resolving to branch/<n>
 * instead of pr/<n> -- which silently removed nothing while still archiving the note.
 */
describe('rm command: branch argument resolution', () => {
  let testRoot: string;
  let worktreesDir: string;
  let noteDir: string;
  let archiveDir: string;

  const noteFor = (name: string) => join(noteDir, `${name}.md`);

  beforeEach(async () => {
    testRoot = mkdtemp();
    worktreesDir = join(testRoot, 'worktrees');
    noteDir = join(testRoot, 'vault', 'projects', 'galaxy', 'worktrees');
    archiveDir = join(testRoot, 'old');

    // Worktrees for a PR and a plain branch
    mkdirSync(join(worktreesDir, 'galaxy', 'pr', '1234'), { recursive: true });
    mkdirSync(join(worktreesDir, 'galaxy', 'branch', 'cool-feature'), { recursive: true });

    // Notes alongside them
    mkdirSync(noteDir, { recursive: true });
    writeFileSync(noteFor('1234'), '# PR 1234');
    writeFileSync(noteFor('cool-feature'), '# cool-feature');

    // A real repo so `git worktree prune` has somewhere to run
    const repoPath = join(testRoot, 'repositories', 'galaxy');
    mkdirSync(repoPath, { recursive: true });
    await execa('git', ['init'], { cwd: repoPath });

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
        syncInterval: null,
      }),
    );
    process.env.GHWT_CONFIG = configPath;
  });

  afterEach(() => {
    delete process.env.GHWT_CONFIG;
    vi.restoreAllMocks();
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('removes pr/<n> when given a bare PR number', async () => {
    await rmCommand('galaxy', '1234');

    expect(existsSync(join(worktreesDir, 'galaxy', 'pr', '1234'))).toBe(false);
    expect(existsSync(noteFor('1234'))).toBe(false);
    expect(existsSync(join(archiveDir, 'galaxy-pr-1234.md'))).toBe(true);
  });

  it('removes branch/<name> when given a bare branch name', async () => {
    await rmCommand('galaxy', 'cool-feature');

    expect(existsSync(join(worktreesDir, 'galaxy', 'branch', 'cool-feature'))).toBe(false);
    expect(existsSync(noteFor('cool-feature'))).toBe(false);
  });

  it('still accepts an explicit pr/ prefix', async () => {
    await rmCommand('galaxy', 'pr/1234');

    expect(existsSync(join(worktreesDir, 'galaxy', 'pr', '1234'))).toBe(false);
  });

  it('does not touch the unrelated branch worktree when removing a PR', async () => {
    await rmCommand('galaxy', '1234');

    expect(existsSync(join(worktreesDir, 'galaxy', 'branch', 'cool-feature'))).toBe(true);
    expect(existsSync(noteFor('cool-feature'))).toBe(true);
  });

  it('exits nonzero and leaves the note in place when the worktree is missing', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(rmCommand('galaxy', '9999')).rejects.toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not archive the note when the worktree is missing', async () => {
    writeFileSync(noteFor('9999'), '# PR 9999');
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(rmCommand('galaxy', '9999')).rejects.toThrow();

    expect(existsSync(noteFor('9999'))).toBe(true);
    expect(existsSync(join(archiveDir, 'galaxy-9999.md'))).toBe(false);
  });
});

function mkdtemp(): string {
  const dir = join(tmpdir(), `ghwt-rm-test-${process.pid}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let counter = 0;
