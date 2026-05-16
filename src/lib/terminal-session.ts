import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { getTerminalSessionConfigDir } from './config.js';
import { GhwtConfig } from '../types.js';
import {
  SessionConfig,
  WindowConfig,
  TabConfig,
  TerminalSessionManager,
  isUIAvailable,
  isCmuxAvailable,
} from './terminal-session-base.js';
import { validateSessionConfig } from './schemas.js';
import { getSessionName } from './paths.js';
import { TmuxSessionManager } from './terminal-session-tmux.js';
import { ZellijSessionManager } from './terminal-session-zellij.js';
import { CmuxSessionManager, assertCmuxReady } from './terminal-session-cmux.js';

// Re-export for compatibility
export type { SessionConfig, WindowConfig, TabConfig };
export { TerminalSessionManager };

/**
 * Find session config file for a project in terminal-session-config directory
 * Looks for {repoName}.ghwt-session.yaml first, then falls back to _default.ghwt-session.yaml
 */
export function findSessionConfig(repoName: string, config: GhwtConfig): string | null {
  const configDir = getTerminalSessionConfigDir(config);

  // Try repo-specific config first: terminal-session-config/{repoName}.ghwt-session.yaml
  const repoCandidates = [
    join(configDir, `${repoName}.ghwt-session.yaml`),
    join(configDir, `${repoName}.ghwt-session.yml`),
    join(configDir, `${repoName}.ghwt-session.json`),
  ];

  for (const candidate of repoCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to default config: terminal-session-config/_default.ghwt-session.yaml
  const defaultCandidates = [
    join(configDir, '_default.ghwt-session.yaml'),
    join(configDir, '_default.ghwt-session.yml'),
    join(configDir, '_default.ghwt-session.json'),
  ];

  for (const candidate of defaultCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Load and parse session config from YAML or JSON file with validation
 */
export function loadSessionConfig(configPath: string): SessionConfig {
  try {
    const content = readFileSync(configPath, 'utf-8');

    const parsed = configPath.endsWith('.json') ? JSON.parse(content) : loadYaml(content);

    return validateSessionConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to load session config from ${configPath}:\n${message}`);
    process.exit(1);
  }
}

/**
 * Get appropriate session manager based on config.
 * Single dispatch site - sync.ts reuses this instead of duplicating the ternary.
 */
export function getSessionManager(config: GhwtConfig, verbose = false): TerminalSessionManager {
  switch (config.terminalMultiplexer || 'tmux') {
    case 'zellij':
      return new ZellijSessionManager(config, verbose);
    case 'cmux':
      return new CmuxSessionManager(config, verbose);
    default:
      return new TmuxSessionManager(config, verbose);
  }
}

/**
 * Validate the terminal UI is available, or that cmux is reachable when the
 * cmux backend is selected (cmux is its own UI, so terminalUI is a no-op).
 * Throws with an actionable, install hint on failure.
 */
async function assertSessionBackendReady(config: GhwtConfig): Promise<void> {
  if (config.terminalMultiplexer === 'cmux') {
    const available = await isCmuxAvailable();
    if (!available) {
      console.warn(`⚠️  cmux not found in PATH (terminalMultiplexer: 'cmux'). cmux is macOS-only.`);
      console.warn(`   Install it from https://cmux.com and open the app, then retry.`);
      throw new Error(`cmux is not available`);
    }
    await assertCmuxReady();
    return;
  }

  const ui = (config.terminalUI || 'wezterm') as 'wezterm' | 'ghostty' | 'none';
  const uiAvailable = await isUIAvailable(ui);
  if (!uiAvailable && ui !== 'none') {
    console.warn(`⚠️  Terminal UI '${ui}' not found in PATH. Install it first:`);
    if (ui === 'ghostty') {
      console.warn(`   brew install ghostty  (or download from https://ghostty.org)`);
    } else if (ui === 'wezterm') {
      console.warn(`   brew install wezterm`);
    }
    throw new Error(`Terminal UI '${ui}' is not available`);
  }
}

/**
 * Launch terminal session for worktree
 * Creates session (tmux or zellij) and launches UI
 */
export async function launchSession(
  project: string,
  branch: string,
  worktreePath: string,
  ghwtConfig: GhwtConfig,
  verbose = false,
  notePath?: string,
): Promise<void> {
  const configPath = findSessionConfig(project, ghwtConfig);
  if (!configPath) {
    // No config file, skip session creation
    return;
  }

  const config = loadSessionConfig(configPath);
  const sessionName = `${project}-${branch.replace(/\//g, '-')}`;
  const manager = getSessionManager(ghwtConfig, verbose);

  try {
    // Validate backend (UI app, or cmux reachability + version floor)
    await assertSessionBackendReady(ghwtConfig);

    // Create session with optional note path for template substitution
    await manager.createSession(sessionName, config, worktreePath, project, branch, notePath);
    console.log(`⚙️  Terminal session created: ${sessionName}`);

    // Launch UI app - let manager handle it
    // (managers know how to wrap multiplexer commands with UI apps)
    await manager.launchUI(sessionName, worktreePath);
  } catch (error) {
    throw new Error(`Failed to launch terminal session: ${error}`);
  }
}

/**
 * Options for attaching to session
 */
export interface AttachCommandOptions {
  /**
   * If true, reuse existing terminal/wezterm instance.
   * If false (default), launch new wezterm process with --always-new-process.
   */
  existingTerminal?: boolean;
  /**
   * Show verbose output
   */
  verbose?: boolean;
}

/**
 * Attach to existing worktree terminal session
 */
export async function attachCommand(
  project: string,
  branch: string,
  worktreePath: string,
  ghwtConfig?: GhwtConfig,
  attachOptions?: AttachCommandOptions,
): Promise<void> {
  // Get session name using consistent naming
  const sessionName = getSessionName(project, branch);
  const config = ghwtConfig || ({ terminalMultiplexer: 'tmux' } as GhwtConfig);
  const verbose = attachOptions?.verbose || false;
  const manager = getSessionManager(config, verbose);

  try {
    // Check if session exists
    const exists = await manager.sessionExists(sessionName);
    if (!exists) {
      // Session doesn't exist, recreate it
      console.log(`⚙️  Session not found, creating new session: ${sessionName}`);
      const configPath = findSessionConfig(project, config);
      if (!configPath) {
        throw new Error(`No session config found for project: ${project}`);
      }

      const sessionConfig = loadSessionConfig(configPath);
      await manager.createSession(sessionName, sessionConfig, worktreePath, project, branch);
      console.log(`✅ Created session: ${sessionName}`);
    }

    // Validate backend (UI app, or cmux reachability + version floor)
    await assertSessionBackendReady(config);

    // Handle UI app mode for tmux (detach other clients first).
    // cmux/zellij manage their own attach; only tmux needs a client detach.
    const ui = (config.terminalUI || 'wezterm') as 'wezterm' | 'ghostty' | 'none';
    if (
      (ui === 'wezterm' || ui === 'ghostty') &&
      config.terminalMultiplexer !== 'zellij' &&
      config.terminalMultiplexer !== 'cmux'
    ) {
      const { execa } = await import('execa');
      try {
        await execa('tmux', ['detach-client', '-s', sessionName]);
      } catch {
        // No other clients attached
      }
    }

    // Attach to session
    await manager.attachToSession(sessionName, worktreePath, {
      alwaysNewProcess: !attachOptions?.existingTerminal,
    });
  } catch (error) {
    throw new Error(`Failed to attach to terminal session: ${error}`);
  }
}

/**
 * Kill terminal session
 */
export async function killSession(sessionName: string, ghwtConfig?: GhwtConfig): Promise<void> {
  const config = ghwtConfig || ({ terminalMultiplexer: 'tmux' } as GhwtConfig);
  const manager = getSessionManager(config);

  try {
    await manager.killSession(sessionName);
  } catch {
    // Session doesn't exist, that's fine
  }
}

// Backward compatibility exports for tmux-specific functions
export async function tmuxSessionExists(sessionName: string): Promise<boolean> {
  const manager = new TmuxSessionManager();
  return manager.sessionExists(sessionName);
}

export async function attachToSession(sessionName: string, worktreePath: string): Promise<void> {
  const manager = new TmuxSessionManager();
  return manager.attachToSession(sessionName, worktreePath);
}
