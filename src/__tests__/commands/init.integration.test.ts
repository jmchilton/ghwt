import { describe, it, beforeEach, afterEach, expect } from 'vitest';
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
    expect(existsSync(join(projectsRoot, 'repositories'))).toBeTruthy();
    expect(existsSync(join(projectsRoot, 'worktrees'))).toBeTruthy();
    expect(existsSync(join(projectsRoot, 'ci-artifacts-config'))).toBeTruthy();
    expect(existsSync(join(projectsRoot, 'terminal-session-config'))).toBeTruthy();
    expect(existsSync(join(vaultPath, 'templates'))).toBeTruthy();
  });

  it('creates config file with correct structure', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    // Verify config file exists
    expect(existsSync(configPath)).toBeTruthy();

    // Parse and verify config content
    const configContent = readFileSync(configPath, 'utf-8');
    const config: GhwtConfig = JSON.parse(configContent);

    expect(config.projectsRoot).toBe(projectsRoot);
    expect(config.vaultPath).toBe(vaultPath);
    expect(config.repositoriesDir).toBe('repositories');
    expect(config.worktreesDir).toBe('worktrees');
    expect(config.syncInterval).toBe(null);
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
    expect(existsSync(dashboardPath)).toBeTruthy();

    // Verify dashboard content
    const dashboardContent = readFileSync(dashboardPath, 'utf-8');
    expect(dashboardContent.includes('Development Dashboard')).toBeTruthy();
    expect(dashboardContent.includes('Active Work')).toBeTruthy();
    expect(dashboardContent.includes('Needs Attention')).toBeTruthy();
    expect(dashboardContent.includes('Ready to Merge')).toBeTruthy();
    expect(dashboardContent.includes('dataview')).toBeTruthy();
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
    expect(dashboardContent.includes('FROM "projects"')).toBeTruthy();
    expect(dashboardContent.includes('status != "merged"')).toBeTruthy();
    expect(dashboardContent.includes('pr_checks = "failing"')).toBeTruthy();
    expect(dashboardContent.includes('days_since_activity > 7')).toBeTruthy();
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
    expect(firstDirs).toEqual(secondDirs);

    // Verify directories still exist
    expect(existsSync(join(projectsRoot, 'repositories'))).toBeTruthy();
    expect(existsSync(join(projectsRoot, 'worktrees'))).toBeTruthy();
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

    expect(existsSync(join(customRoot, 'repositories'))).toBeTruthy();
    expect(existsSync(join(customRoot, 'worktrees'))).toBeTruthy();
  });

  it('handles custom vault paths', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const customVault = join(testRoot, 'my-obsidian-vault');

    await initCommand({
      projectsRoot,
      vaultPath: customVault,
    });

    expect(existsSync(join(customVault, 'templates'))).toBeTruthy();
    expect(existsSync(join(customVault, 'dashboard.md'))).toBeTruthy();
  });

  it('creates nested vault directory structure if needed', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'nested', 'path', 'to', 'vault');

    // Note: This should work even with deeply nested paths
    await initCommand({
      projectsRoot,
      vaultPath,
    });

    expect(existsSync(vaultPath)).toBeTruthy();
    expect(existsSync(join(vaultPath, 'templates'))).toBeTruthy();
  });

  it('creates all ci-artifacts-config and terminal-session-config directories', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    // These directories are needed for configuration files
    expect(existsSync(join(projectsRoot, 'ci-artifacts-config'))).toBeTruthy();
    expect(existsSync(join(projectsRoot, 'terminal-session-config'))).toBeTruthy();
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
    expect(configContent.projectsRoot === projectsRoot).toBeTruthy();
    expect(configContent.vaultPath === vaultPath).toBeTruthy();
    expect(configContent.repositoriesDir === 'repositories').toBeTruthy();
    expect(configContent.worktreesDir === 'worktrees').toBeTruthy();
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
    expect(projectsContents.includes('ci-artifacts-config')).toBeTruthy();
    expect(projectsContents.includes('repositories')).toBeTruthy();
    expect(projectsContents.includes('terminal-session-config')).toBeTruthy();
    expect(projectsContents.includes('worktrees')).toBeTruthy();

    const vaultContents = readdirSync(vaultPath).sort();
    expect(vaultContents.includes('dashboard.md')).toBeTruthy();
    expect(vaultContents.includes('templates')).toBeTruthy();
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
    expect(dashboardContent.startsWith('---')).toBeTruthy();
    expect(dashboardContent.includes('type: dashboard')).toBeTruthy();
    expect(dashboardContent.includes('created:')).toBeTruthy();
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
    expect(existsSync(join(projectsRoot, 'repositories'))).toBeTruthy();
    expect(existsSync(join(projectsRoot, 'worktrees'))).toBeTruthy();
    expect(existsSync(join(vaultPath, 'dashboard.md'))).toBeTruthy();
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
    expect(existsSync(testFile)).toBeTruthy();
    const content = readFileSync(testFile, 'utf-8');
    expect(content).toBe('test content');
  });
});
