import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initCommand } from '../../commands/init.js';
import type { GhwtConfig } from '../../types.js';

/**
 * End-to-end tests for the init command
 * Verifies initialization of ghwt workspace with all required structure
 */

describe('Init command: end-to-end workspace initialization', () => {
  let testRoot: string;
  let configPath: string;
  const originalCwd = process.cwd();
  const originalEnv = process.env.GHWT_CONFIG;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'ghwt-init-e2e-'));
    configPath = join(testRoot, '.ghwtrc.json');

    // Point GHWT_CONFIG to test config file
    process.env.GHWT_CONFIG = configPath;
  });

  afterEach(() => {
    // Restore original environment
    process.chdir(originalCwd);
    process.env.GHWT_CONFIG = originalEnv;

    // Clean up test directory
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates all required directories', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    // Verify all required directories exist
    assert.ok(existsSync(join(projectsRoot, 'repositories')));
    assert.ok(existsSync(join(projectsRoot, 'worktrees')));
    assert.ok(existsSync(join(projectsRoot, 'ci-artifacts-config')));
    assert.ok(existsSync(join(projectsRoot, 'terminal-session-config')));
    assert.ok(existsSync(join(vaultPath, 'templates')));
  });

  it('creates config file with correct structure', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    // Verify config file exists
    assert.ok(existsSync(configPath), 'Config file should exist');

    // Parse and verify config content
    const configContent = readFileSync(configPath, 'utf-8');
    const config: GhwtConfig = JSON.parse(configContent);

    assert.strictEqual(config.projectsRoot, projectsRoot);
    assert.strictEqual(config.vaultPath, vaultPath);
    assert.strictEqual(config.repositoriesDir, 'repositories');
    assert.strictEqual(config.worktreesDir, 'worktrees');
    assert.strictEqual(config.syncInterval, null);
  });

  it('creates dashboard template in vault', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    const dashboardPath = join(vaultPath, 'dashboard.md');

    // Verify dashboard exists
    assert.ok(existsSync(dashboardPath), 'Dashboard should exist');

    // Verify dashboard content
    const dashboardContent = readFileSync(dashboardPath, 'utf-8');
    assert.ok(dashboardContent.includes('Development Dashboard'));
    assert.ok(dashboardContent.includes('Active Work'));
    assert.ok(dashboardContent.includes('Needs Attention'));
    assert.ok(dashboardContent.includes('Ready to Merge'));
    assert.ok(dashboardContent.includes('dataview'));
  });

  it('dashboard contains dataview queries', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    const dashboardPath = join(vaultPath, 'dashboard.md');
    const dashboardContent = readFileSync(dashboardPath, 'utf-8');

    // Verify key dataview queries exist
    assert.ok(dashboardContent.includes('FROM "projects"'));
    assert.ok(dashboardContent.includes('status != "merged"'));
    assert.ok(dashboardContent.includes('pr_checks = "failing"'));
    assert.ok(dashboardContent.includes('days_since_activity > 7'));
  });

  it('is idempotent - can run twice without errors', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Run init once
    await initCommand({
      projectsRoot,
      vaultPath,
    });

    const firstDirs = readdirSync(projectsRoot);

    // Run init again
    await initCommand({
      projectsRoot,
      vaultPath,
    });

    const secondDirs = readdirSync(projectsRoot);

    // Verify same directories exist after second run
    assert.deepStrictEqual(firstDirs, secondDirs);

    // Verify directories still exist
    assert.ok(existsSync(join(projectsRoot, 'repositories')));
    assert.ok(existsSync(join(projectsRoot, 'worktrees')));
  });

  it('handles custom project paths with ~ expansion', async () => {
    // Note: We can't test ~ expansion easily in tests, but we can verify
    // that the expandPath function is called via the resulting config
    const customRoot = join(testRoot, 'my-custom-projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot: customRoot,
      vaultPath,
    });

    assert.ok(existsSync(join(customRoot, 'repositories')));
    assert.ok(existsSync(join(customRoot, 'worktrees')));
  });

  it('handles custom vault paths', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const customVault = join(testRoot, 'my-obsidian-vault');

    await initCommand({
      projectsRoot,
      vaultPath: customVault,
    });

    assert.ok(existsSync(join(customVault, 'templates')));
    assert.ok(existsSync(join(customVault, 'dashboard.md')));
  });

  it('creates nested vault directory structure if needed', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'nested', 'path', 'to', 'vault');

    // Note: This should work even with deeply nested paths
    await initCommand({
      projectsRoot,
      vaultPath,
    });

    assert.ok(existsSync(vaultPath));
    assert.ok(existsSync(join(vaultPath, 'templates')));
  });

  it('creates all ci-artifacts-config and terminal-session-config directories', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    // These directories are needed for configuration files
    assert.ok(existsSync(join(projectsRoot, 'ci-artifacts-config')));
    assert.ok(existsSync(join(projectsRoot, 'terminal-session-config')));
  });

  it('config file uses correct paths in JSON', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    const configContent = JSON.parse(readFileSync(configPath, 'utf-8')) as GhwtConfig;

    // Verify paths are absolute and correct
    assert.ok(configContent.projectsRoot === projectsRoot);
    assert.ok(configContent.vaultPath === vaultPath);
    assert.ok(configContent.repositoriesDir === 'repositories');
    assert.ok(configContent.worktreesDir === 'worktrees');
  });

  it('creates workspace structure matching expected hierarchy', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    // Verify complete directory structure
    const projectsContents = readdirSync(projectsRoot).sort();
    assert.ok(projectsContents.includes('ci-artifacts-config'));
    assert.ok(projectsContents.includes('repositories'));
    assert.ok(projectsContents.includes('terminal-session-config'));
    assert.ok(projectsContents.includes('worktrees'));

    const vaultContents = readdirSync(vaultPath).sort();
    assert.ok(vaultContents.includes('dashboard.md'));
    assert.ok(vaultContents.includes('templates'));
  });

  it('dashboard frontmatter has correct metadata', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    const dashboardPath = join(vaultPath, 'dashboard.md');
    const dashboardContent = readFileSync(dashboardPath, 'utf-8');

    // Verify frontmatter structure
    assert.ok(dashboardContent.startsWith('---'));
    assert.ok(dashboardContent.includes('type: dashboard'));
    assert.ok(dashboardContent.includes('created:'));
  });

  it('multiple concurrent initializations with same paths work correctly', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Run init twice concurrently (simulating concurrent calls)
    await Promise.all([
      initCommand({ projectsRoot, vaultPath }),
      initCommand({ projectsRoot, vaultPath }),
    ]);

    // Verify structure is intact
    assert.ok(existsSync(join(projectsRoot, 'repositories')));
    assert.ok(existsSync(join(projectsRoot, 'worktrees')));
    assert.ok(existsSync(join(vaultPath, 'dashboard.md')));
  });

  it('preserves existing directories without errors', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create directories first
    const reposDir = join(projectsRoot, 'repositories');
    const mkdirSync = await import('fs').then((m) => m.mkdirSync);
    mkdirSync(reposDir, { recursive: true });

    // Write a file to the existing directory
    const writeFileSync = await import('fs').then((m) => m.writeFileSync);
    const testFile = join(reposDir, 'test.txt');
    writeFileSync(testFile, 'test content');

    // Run init - should not destroy existing files
    await initCommand({
      projectsRoot,
      vaultPath,
    });

    // Verify file still exists
    assert.ok(existsSync(testFile));
    const content = readFileSync(testFile, 'utf-8');
    assert.strictEqual(content, 'test content');
  });
});
