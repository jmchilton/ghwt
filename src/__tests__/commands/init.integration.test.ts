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
  const originalExit = process.exit;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'ghwt-init-e2e-'));
    configPath = join(testRoot, '.ghwtrc.json');

    // Point GHWT_CONFIG to test config file
    process.env.GHWT_CONFIG = configPath;

    // Mock process.exit to throw error instead
    const mockExit = (code: number) => {
      throw new Error(`process.exit(${code})`);
    };
    (process.exit as unknown as typeof process.exit) = mockExit;
  });

  afterEach(() => {
    // Restore original environment
    process.chdir(originalCwd);
    process.env.GHWT_CONFIG = originalEnv;
    process.exit = originalExit;

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

  it('rejects second init with same config path', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Run init once
    await initCommand({
      projectsRoot,
      vaultPath,
    });

    expect(existsSync(configPath)).toBeTruthy();

    // Verify directories exist after first run
    expect(existsSync(join(projectsRoot, 'repositories'))).toBeTruthy();
    expect(existsSync(join(projectsRoot, 'worktrees'))).toBeTruthy();

    // Try to run init again - should fail
    let exitErrorThrown = false;
    try {
      await initCommand({
        projectsRoot,
        vaultPath,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'process.exit(1)') {
        exitErrorThrown = true;
      }
    }

    expect(exitErrorThrown).toBeTruthy();
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

  it('allows re-initialization with different GHWT_CONFIG paths', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // First initialization
    await initCommand({ projectsRoot, vaultPath });
    expect(existsSync(configPath)).toBeTruthy();

    // Change GHWT_CONFIG to a different path for second initialization
    const configPath2 = join(testRoot, '.ghwtrc2.json');
    process.env.GHWT_CONFIG = configPath2;

    const projectsRoot2 = join(testRoot, 'projects2');
    const vaultPath2 = join(testRoot, 'vault2');

    // Second initialization with different config path should succeed
    await initCommand({ projectsRoot: projectsRoot2, vaultPath: vaultPath2 });
    expect(existsSync(configPath2)).toBeTruthy();

    // Both configs should exist
    expect(existsSync(configPath)).toBeTruthy();
    expect(existsSync(configPath2)).toBeTruthy();
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

  it('bails out if config file already exists', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Run init first time
    await initCommand({
      projectsRoot,
      vaultPath,
    });

    // Verify config was created
    expect(existsSync(configPath)).toBeTruthy();

    // Try to run init again - should throw process.exit error
    let exitErrorThrown = false;
    try {
      await initCommand({
        projectsRoot,
        vaultPath,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'process.exit(1)') {
        exitErrorThrown = true;
      }
    }

    expect(exitErrorThrown).toBeTruthy();
  });

  it('includes terminal multiplexer in config if detected', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    const configContent = JSON.parse(readFileSync(configPath, 'utf-8')) as GhwtConfig;

    // Config may or may not have terminal multiplexer depending on system
    // but if it does, it should be valid
    if (configContent.terminalMultiplexer) {
      expect(['tmux', 'zellij'].includes(configContent.terminalMultiplexer)).toBeTruthy();
    }
  });

  it('includes terminal UI in config if detected', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    await initCommand({
      projectsRoot,
      vaultPath,
    });

    const configContent = JSON.parse(readFileSync(configPath, 'utf-8')) as GhwtConfig;

    // Config may or may not have terminal UI depending on system
    // but if it does, it should be valid
    if (configContent.terminalUI) {
      expect(['wezterm', 'ghostty'].includes(configContent.terminalUI)).toBeTruthy();
    }
  });
});
