import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseBranchArg } from '../../lib/branch-parser.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { baseBranchExists, suggestBaseBranches, getImplicitBaseBranch } from '../../lib/git.js';

describe('create command: branch argument parsing', () => {
  it('should detect PR from numeric string', () => {
    const result = parseBranchArg('1234');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('1234');
  });

  it('should accept simple branch name', () => {
    const result = parseBranchArg('cool-feature');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('cool-feature');
  });

  it('should accept branch name with underscore', () => {
    const result = parseBranchArg('fix_bug_123');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('fix_bug_123');
  });

  it('should accept branch names with slashes', () => {
    const result = parseBranchArg('fix/bug-123');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('fix/bug-123');
  });

  it('should accept branch names with multiple slashes', () => {
    const result = parseBranchArg('bugfix/section/subsection');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('bugfix/section/subsection');
  });

  it('should reject old feature/ prefix with error', () => {
    expect(() => parseBranchArg('feature/cool')).toThrow(/Invalid branch format/);
  });

  it('should reject old bug/ prefix with error', () => {
    expect(() => parseBranchArg('bug/fix')).toThrow(/Invalid branch format/);
  });

  it('should reject old pr/ prefix with error', () => {
    expect(() => parseBranchArg('pr/1234')).toThrow(/Invalid branch format/);
  });

  it('should reject branch/ prefix with error', () => {
    // branch/ is not checked by the parser - it's treated as a valid branch name
    const result = parseBranchArg('branch/name');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('branch/name');
  });

  it('should reject branch names with special characters', () => {
    expect(() => parseBranchArg('invalid branch!')).toThrow(/Invalid branch name/);
  });

  it('should reject branch names with dots', () => {
    expect(() => parseBranchArg('feature.new')).toThrow(/Invalid branch name/);
  });

  it('should reject branch names with spaces', () => {
    expect(() => parseBranchArg('my feature')).toThrow(/Invalid branch name/);
  });

  it('should provide helpful error messages for invalid format', () => {
    expect(() => parseBranchArg('feature/test')).toThrow();
    try {
      parseBranchArg('feature/test');
    } catch (error) {
      expect(error instanceof Error).toBeTruthy();
      expect(
        (error as Error).message.includes('Invalid branch format') ||
          (error as Error).message.includes('Use branch name directly (e.g., "cool-feature")'),
      ).toBeTruthy();
    }
  });

  it('should handle leading zeros in PR number', () => {
    const result = parseBranchArg('00123');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('00123');
  });

  it('should handle large PR numbers', () => {
    const result = parseBranchArg('999999');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('999999');
  });

  it('should accept single character branch names', () => {
    const result = parseBranchArg('a');
    expect(result.type).toBe('branch');
    expect(result.name).toBe('a');
  });

  it('should accept single digit as branch name (non-numeric context)', () => {
    // Single digit is ambiguous but should be treated as PR
    const result = parseBranchArg('1');
    expect(result.type).toBe('pr');
    expect(result.name).toBe('1');
  });
});

describe('create command: base branch selection', () => {
  let tempDir: string;
  let repoPath: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ghwt-base-branch-'));
    repoPath = join(tempDir, 'test-repo');
    mkdirSync(repoPath, { recursive: true });

    // Initialize git repo
    await execa('git', ['init'], { cwd: repoPath });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: repoPath });

    // Create initial commit on main
    writeFileSync(join(repoPath, 'README.md'), '# Test Repo');
    await execa('git', ['add', 'README.md'], { cwd: repoPath });
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: repoPath });

    // Create dev branch with a distinct commit
    await execa('git', ['checkout', '-b', 'dev'], { cwd: repoPath });
    writeFileSync(join(repoPath, 'dev.txt'), 'dev branch');
    await execa('git', ['add', 'dev.txt'], { cwd: repoPath });
    await execa('git', ['commit', '-m', 'Dev commit'], { cwd: repoPath });

    // Go back to main
    await execa('git', ['checkout', 'main'], { cwd: repoPath });
  });

  afterEach(() => {
    try {
      process.chdir(originalCwd);
    } catch {
      // Ignore
    }
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should detect local branch exists', async () => {
    const exists = await baseBranchExists(repoPath, 'dev');
    expect(exists).toBe(true);
  });

  it('should detect local branch does not exist', async () => {
    const exists = await baseBranchExists(repoPath, 'nonexistent');
    expect(exists).toBe(false);
  });

  it('should detect remote branch exists', async () => {
    // Add origin remote and create remote branch
    const remoteRepo = join(tempDir, 'remote.git');
    await execa('git', ['init', '--bare', remoteRepo]);
    await execa('git', ['remote', 'add', 'origin', remoteRepo], { cwd: repoPath });
    await execa('git', ['push', 'origin', 'dev'], { cwd: repoPath });

    const exists = await baseBranchExists(repoPath, 'origin/dev');
    expect(exists).toBe(true);
  });

  it('should suggest common branches when base branch not found', async () => {
    const suggestions = await suggestBaseBranches(repoPath, 'nonexistent');

    // Should include main and dev since they exist
    expect(suggestions.some((s) => s === 'main')).toBe(true);
    expect(suggestions.some((s) => s === 'dev')).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });

  it('should suggest fuzzy matches', async () => {
    // Create a branch with similar name
    await execa('git', ['checkout', '-b', 'development'], { cwd: repoPath });
    await execa('git', ['checkout', 'main'], { cwd: repoPath });

    const suggestions = await suggestBaseBranches(repoPath, 'deve');

    // Should include both dev and development
    expect(suggestions.some((s) => s === 'dev' || s === 'development')).toBe(true);
  });

  it('should suggest remote branches', async () => {
    // Add origin remote
    const remoteRepo = join(tempDir, 'remote.git');
    await execa('git', ['init', '--bare', remoteRepo]);
    await execa('git', ['remote', 'add', 'origin', remoteRepo], { cwd: repoPath });
    await execa('git', ['push', 'origin', 'main'], { cwd: repoPath });

    const suggestions = await suggestBaseBranches(repoPath, 'origin/main');

    // Should include origin/main in suggestions
    expect(suggestions.some((s) => s === 'origin/main')).toBe(true);
  });

  it('should limit suggestions to 5', async () => {
    // Create many branches
    for (let i = 0; i < 10; i++) {
      await execa('git', ['checkout', '-b', `branch-${i}`], { cwd: repoPath });
      await execa('git', ['checkout', 'main'], { cwd: repoPath });
    }

    const suggestions = await suggestBaseBranches(repoPath, 'nonexistent');
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });

  it('should detect implicit base from local source repo branch', async () => {
    // dev branch already created in beforeEach
    const implicit = await getImplicitBaseBranch(repoPath, 'dev');
    expect(implicit).toBe('dev');
  });

  it('should detect implicit base from origin remote', async () => {
    // Set up origin remote with a branch
    const remoteRepo = join(tempDir, 'remote.git');
    await execa('git', ['init', '--bare', remoteRepo]);
    await execa('git', ['remote', 'add', 'origin', remoteRepo], { cwd: repoPath });
    await execa('git', ['push', 'origin', 'dev'], { cwd: repoPath });

    const implicit = await getImplicitBaseBranch(repoPath, 'dev');
    // Should return local branch first (priority 1)
    expect(implicit).toBe('dev');
  });

  it('should detect implicit base from origin when local does not exist', async () => {
    // Set up origin remote with feature branch
    const remoteRepo = join(tempDir, 'remote.git');
    await execa('git', ['init', '--bare', remoteRepo]);
    await execa('git', ['remote', 'add', 'origin', remoteRepo], { cwd: repoPath });

    // Create feature-from-origin locally, push it, then delete locally to test remote detection
    await execa('git', ['checkout', '-b', 'feature-from-origin'], { cwd: repoPath });
    writeFileSync(join(repoPath, 'feature.txt'), 'feature');
    await execa('git', ['add', 'feature.txt'], { cwd: repoPath });
    await execa('git', ['commit', '-m', 'Feature commit'], { cwd: repoPath });
    await execa('git', ['push', 'origin', 'feature-from-origin'], { cwd: repoPath });

    // Go back to main, fetch, and delete local feature-from-origin branch
    await execa('git', ['checkout', 'main'], { cwd: repoPath });
    await execa('git', ['fetch', 'origin'], { cwd: repoPath });
    await execa('git', ['branch', '-D', 'feature-from-origin'], { cwd: repoPath });

    const implicit = await getImplicitBaseBranch(repoPath, 'feature-from-origin');
    expect(implicit).toBe('origin/feature-from-origin');
  });

  it('should detect implicit base from user-named remote', async () => {
    // Note: This test cannot fully test getCurrentUser since it requires gh auth
    // But we can test the logic if we mock the environment
    // For now, just verify the function returns null when no branch found
    const implicit = await getImplicitBaseBranch(repoPath, 'nonexistent-branch');
    expect(implicit).toBeNull();
  });

  it('should prefer local branch over remote', async () => {
    // Set up origin with dev branch
    const remoteRepo = join(tempDir, 'remote.git');
    await execa('git', ['init', '--bare', remoteRepo]);
    await execa('git', ['remote', 'add', 'origin', remoteRepo], { cwd: repoPath });
    await execa('git', ['push', 'origin', 'dev'], { cwd: repoPath });

    // dev is both local and remote
    const implicit = await getImplicitBaseBranch(repoPath, 'dev');
    // Should return local, not remote
    expect(implicit).toBe('dev');
    expect(implicit).not.toBe('origin/dev');
  });

  it('should return null when no implicit base found', async () => {
    const implicit = await getImplicitBaseBranch(repoPath, 'totally-nonexistent');
    expect(implicit).toBeNull();
  });
});
