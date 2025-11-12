import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { getTerminalSessionConfigDir } from './config.js';
import { GhwtConfig } from '../types.js';
import { SessionConfig, WindowConfig, TabConfig, TerminalSessionManager } from './terminal-session-base.js';
import { validateSessionConfig } from './schemas.js';
import { TmuxSessionManager } from './terminal-session-tmux.js';
import { ZellijSessionManager } from './terminal-session-zellij.js';

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
 * Get appropriate session manager based on config
 */
function getSessionManager(config: GhwtConfig): TerminalSessionManager {
  const multiplexer = config.terminalMultiplexer || 'tmux';

  if (multiplexer === 'zellij') {
    return new ZellijSessionManager(config);
  } else {
    return new TmuxSessionManager(config);
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
): Promise<void> {
  const configPath = findSessionConfig(project, ghwtConfig);
  if (!configPath) {
    // No config file, skip session creation
    return;
  }

  const config = loadSessionConfig(configPath);
  const sessionName = `${project}-${branch.replace(/\//g, '-')}`;
  const manager = getSessionManager(ghwtConfig);

  try {
    // Create session
    await manager.createSession(sessionName, config, worktreePath);
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
  const sessionName = `${project}-${branch.replace(/\//g, '-')}`;
  const config = ghwtConfig || ({ terminalMultiplexer: 'tmux' } as GhwtConfig);
  const manager = getSessionManager(config);

  try {
    // Check if session exists
    const exists = await manager.sessionExists(sessionName);
    if (!exists) {
      throw new Error(`Session not found: ${sessionName}`);
    }

    // Handle UI app mode for tmux (detach other clients first)
    const ui = config.terminalUI || 'wezterm';
    if ((ui === 'wezterm' || ui === 'ghostty') && config.terminalMultiplexer !== 'zellij') {
      // For tmux with UI app: detach other clients before attaching
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

export async function createTmuxSession(
  sessionName: string,
  config: SessionConfig,
  worktreePath: string,
): Promise<void> {
  const manager = new TmuxSessionManager();
  return manager.createSession(sessionName, config, worktreePath);
}

export async function launchWezterm(sessionName: string, worktreePath: string): Promise<void> {
  const manager = new TmuxSessionManager();
  return manager.launchUI(sessionName, worktreePath);
}

export async function attachToSession(sessionName: string, worktreePath: string): Promise<void> {
  const manager = new TmuxSessionManager();
  return manager.attachToSession(sessionName, worktreePath);
}
