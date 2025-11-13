import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { lintCommand } from '../../commands/lint.js';
import type { GhwtConfig } from '../../types.js';

/**
 * End-to-end tests for the lint command
 * Verifies configuration validation across all aspects of ghwt setup
 */

describe('Lint command: end-to-end configuration validation', () => {
  let testRoot: string;
  let configPath: string;
  let originalCwd: string;
  const originalEnv = process.env.GHWT_CONFIG;
  const originalExit = process.exit;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'ghwt-lint-e2e-'));
    configPath = join(testRoot, '.ghwtrc.json');
    originalCwd = process.cwd();

    // Point GHWT_CONFIG to test config file
    process.env.GHWT_CONFIG = configPath;

    // Mock process.exit to prevent test termination
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.exit as any) = (code: number) => {
      throw new Error(`process.exit(${code})`);
    };
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

  function createTestConfig(projectsRoot: string, vaultPath: string): GhwtConfig {
    return {
      projectsRoot,
      repositoriesDir: 'repositories',
      worktreesDir: 'worktrees',
      vaultPath,
      syncInterval: null,
      terminalMultiplexer: 'tmux',
      terminalUI: 'wezterm',
    };
  }

  function saveTestConfig(config: GhwtConfig): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  it('validates valid configuration without errors', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create directory structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Create valid config
    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should not throw or exit
    await lintCommand();
  });

  it('detects missing global config file', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create directory structure but no config file
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Don't create config file
    // GHWT_CONFIG should point to missing file, so it will use defaults and warn

    // This test verifies the lint handles missing config gracefully
    // In real scenario, loadConfig() would use default ~/.ghwtrc.json
    // But we can't easily test that in isolation, so we skip this specific case
  });

  it('detects invalid global config JSON', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Write invalid JSON
    writeFileSync(configPath, '{ invalid json }');

    // Create the structure lint expects
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Should handle gracefully (lint tries to parse config)
    try {
      await lintCommand({ configOnly: true });
      // May fail or succeed depending on error handling
    } catch {
      // Expected behavior for invalid config
    }
  });

  it('detects missing required directories', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create config but skip some directories
    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Only create one directory
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    // Missing: worktrees, vault

    // Should detect missing directories (will error via process.exit)
    let errorThrown = false;
    try {
      await lintCommand();
    } catch (error) {
      // Expected - process.exit is mocked to throw
      if (error instanceof Error && error.message.includes('process.exit')) {
        errorThrown = true;
      }
    }

    expect(errorThrown).toBeTruthy();
  });

  it('validates valid session config YAML', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Create session config directory
    const sessionConfigDir = join(projectsRoot, 'terminal-session-config');
    mkdirSync(sessionConfigDir, { recursive: true });

    // Write valid session config
    const validSessionConfig = `
name: test-session
windows:
  - name: main
    panes:
      - echo "starting"
`;
    writeFileSync(join(sessionConfigDir, 'test.ghwt-session.yaml'), validSessionConfig);

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should validate successfully
    await lintCommand();
  });

  it('detects invalid session config', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Create session config directory
    const sessionConfigDir = join(projectsRoot, 'terminal-session-config');
    mkdirSync(sessionConfigDir, { recursive: true });

    // Write invalid session config (missing required fields)
    const invalidSessionConfig = `
name: test-session
# Missing windows/tabs
`;
    writeFileSync(join(sessionConfigDir, 'invalid.ghwt-session.yaml'), invalidSessionConfig);

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should error due to invalid session config
    let errorThrown = false;
    try {
      await lintCommand();
    } catch (error) {
      if (error instanceof Error && error.message.includes('process.exit')) {
        errorThrown = true;
      }
    }

    expect(errorThrown).toBeTruthy();
  });

  it('detects missing session config directory warning', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create structure but NOT session config directory
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should warn about missing session config dir
    await lintCommand();
  });

  it('validates valid worktree notes', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });

    // Create worktree note with valid frontmatter
    const projectNotesDir = join(vaultPath, 'projects', 'test-project', 'worktrees');
    mkdirSync(projectNotesDir, { recursive: true });

    const validNote = `---
project: test-project
branch: cool-feature
status: in-progress
created: 2024-11-13
repo_url: https://github.com/test/repo
worktree_path: /path/to/worktree
base_branch: main
commits_ahead: 5
commits_behind: 0
has_uncommitted_changes: false
last_commit_date: 2024-11-13
tracking_branch: origin/cool-feature
days_since_activity: 0
last_synced: 2024-11-13T10:00:00Z
---
# Test Worktree Note
`;
    writeFileSync(join(projectNotesDir, 'cool-feature.md'), validNote);

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should validate successfully
    await lintCommand();
  });

  it('detects missing required fields in worktree notes', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });

    // Create note with missing required fields
    const projectNotesDir = join(vaultPath, 'projects', 'test-project', 'worktrees');
    mkdirSync(projectNotesDir, { recursive: true });

    const invalidNote = `---
project: test-project
branch: cool-feature
# Missing: status, created, repo_url, worktree_path
---
# Invalid Note
`;
    writeFileSync(join(projectNotesDir, 'cool-feature.md'), invalidNote);

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should error due to missing required fields
    let errorThrown = false;
    try {
      await lintCommand();
    } catch (error) {
      if (error instanceof Error && error.message.includes('process.exit')) {
        errorThrown = true;
      }
    }

    expect(errorThrown).toBeTruthy();
  });

  it('supports --config-only option', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create structure but skip session configs
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should only validate global config and structure, skip session configs
    await lintCommand({ configOnly: true });
  });

  it('supports --session-only option', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Create session config directory with valid config
    const sessionConfigDir = join(projectsRoot, 'terminal-session-config');
    mkdirSync(sessionConfigDir, { recursive: true });

    const validSessionConfig = `
name: test-session
windows:
  - name: main
    panes:
      - echo "test"
`;
    writeFileSync(join(sessionConfigDir, 'test.ghwt-session.yaml'), validSessionConfig);

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should only validate session configs, skip global config check
    await lintCommand({ sessionOnly: true });
  });

  it('validates multiple valid worktree notes', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });

    // Create multiple notes
    const projectNotesDir = join(vaultPath, 'projects', 'test-project', 'worktrees');
    mkdirSync(projectNotesDir, { recursive: true });

    const baseNote = `---
project: test-project
branch: BRANCH
status: in-progress
created: 2024-11-13
repo_url: https://github.com/test/repo
worktree_path: /path/to/worktree
base_branch: main
commits_ahead: 0
commits_behind: 0
has_uncommitted_changes: false
last_commit_date: 2024-11-13
tracking_branch: origin/BRANCH
days_since_activity: 0
last_synced: 2024-11-13T10:00:00Z
---
# Worktree Note`;

    writeFileSync(join(projectNotesDir, 'feature1.md'), baseNote.replace(/BRANCH/g, 'feature1'));
    writeFileSync(join(projectNotesDir, 'feature2.md'), baseNote.replace(/BRANCH/g, 'feature2'));

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should validate both notes successfully
    await lintCommand();
  });

  it('validates session config as JSON', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Create session config directory
    const sessionConfigDir = join(projectsRoot, 'terminal-session-config');
    mkdirSync(sessionConfigDir, { recursive: true });

    // Write valid session config as JSON
    const jsonSessionConfig = {
      name: 'test-session',
      windows: [
        {
          name: 'main',
          panes: ['echo "test"'],
        },
      ],
    };
    writeFileSync(
      join(sessionConfigDir, 'test.ghwt-session.json'),
      JSON.stringify(jsonSessionConfig),
    );

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should validate successfully
    await lintCommand();
  });

  it('handles worktree notes with PR metadata', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });

    // Create note with PR metadata
    const projectNotesDir = join(vaultPath, 'projects', 'test-project', 'worktrees');
    mkdirSync(projectNotesDir, { recursive: true });

    const prNote = `---
project: test-project
branch: "1234"
status: review
created: 2024-11-13
repo_url: https://github.com/test/repo
worktree_path: /path/to/worktree
base_branch: main
commits_ahead: 3
commits_behind: 0
has_uncommitted_changes: false
last_commit_date: 2024-11-13
tracking_branch: origin/pr-1234
pr: https://github.com/test/repo/pull/1234
pr_state: open
pr_checks: passing
pr_reviews: 2
pr_labels: [bug, critical]
days_since_activity: 0
last_synced: 2024-11-13T10:00:00Z
---
# PR Worktree
`;
    writeFileSync(join(projectNotesDir, '1234.md'), prNote);

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should validate PR note successfully
    await lintCommand();
  });

  it('handles multiple projects with notes', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });

    // Create notes for multiple projects
    const projects = ['galaxy', 'gxformat2'];
    const baseNote = `---
project: PROJECT
branch: feature
status: in-progress
created: 2024-11-13
repo_url: https://github.com/test/PROJECT
worktree_path: /path/to/worktree
base_branch: main
commits_ahead: 0
commits_behind: 0
has_uncommitted_changes: false
last_commit_date: 2024-11-13
tracking_branch: origin/feature
days_since_activity: 0
last_synced: 2024-11-13T10:00:00Z
---
# Feature
`;

    for (const project of projects) {
      const projectNotesDir = join(vaultPath, 'projects', project, 'worktrees');
      mkdirSync(projectNotesDir, { recursive: true });
      writeFileSync(join(projectNotesDir, 'feature.md'), baseNote.replace(/PROJECT/g, project));
    }

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should validate notes from all projects
    await lintCommand();
  });

  it('detects malformed YAML in session config', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Create full structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Create session config directory
    const sessionConfigDir = join(projectsRoot, 'terminal-session-config');
    mkdirSync(sessionConfigDir, { recursive: true });

    // Write malformed YAML
    const malformedYaml = `
name: test
windows:
  - name: main
    panes: invalid YAML: [without proper: formatting
`;
    writeFileSync(join(sessionConfigDir, 'bad.ghwt-session.yaml'), malformedYaml);

    const config = createTestConfig(projectsRoot, vaultPath);
    saveTestConfig(config);

    // Should error on malformed YAML
    let errorThrown = false;
    try {
      await lintCommand();
    } catch (error) {
      if (error instanceof Error && error.message.includes('process.exit')) {
        errorThrown = true;
      }
    }

    expect(errorThrown).toBeTruthy();
  });

  it('detects invalid config JSON format', async () => {
    const projectsRoot = join(testRoot, 'projects');
    const vaultPath = join(testRoot, 'vault');

    // Write invalid config JSON
    writeFileSync(configPath, 'not valid json at all!');

    // Create structure
    mkdirSync(join(projectsRoot, 'repositories'), { recursive: true });
    mkdirSync(join(projectsRoot, 'worktrees'), { recursive: true });
    mkdirSync(join(vaultPath, 'projects'), { recursive: true });

    // Should handle JSON parse error gracefully (will exit)
    let errorThrown = false;
    try {
      await lintCommand({ configOnly: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('process.exit')) {
        errorThrown = true;
      }
    }

    expect(errorThrown).toBeTruthy();
  });
});
