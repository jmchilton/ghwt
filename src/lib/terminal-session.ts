import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { load as loadYaml } from "js-yaml";
import { expandPath, getTerminalSessionConfigDir } from "./config.js";
import { GhwtConfig } from "../types.js";
import {
  SessionConfig,
  WindowConfig,
  TerminalSessionManager,
} from "./terminal-session-base.js";
import { TmuxSessionManager } from "./terminal-session-tmux.js";
import { ZellijSessionManager } from "./terminal-session-zellij.js";

// Re-export for compatibility
export type { SessionConfig, WindowConfig };
export { TerminalSessionManager };

/**
 * Find session config file for a project in terminal-session-config directory
 * Looks for .ghwt-session.yaml, .ghwt-session.yml, or .ghwt-session.json
 */
export function findSessionConfig(repoName: string, config: GhwtConfig): string | null {
  const configDir = join(
    getTerminalSessionConfigDir(config),
    repoName
  );

  const candidates = [
    join(configDir, ".ghwt-session.yaml"),
    join(configDir, ".ghwt-session.yml"),
    join(configDir, ".ghwt-session.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Load and parse session config from YAML or JSON file
 */
export function loadSessionConfig(configPath: string): SessionConfig {
  const content = readFileSync(configPath, "utf-8");

  if (configPath.endsWith(".json")) {
    return JSON.parse(content) as SessionConfig;
  } else {
    return loadYaml(content) as SessionConfig;
  }
}

/**
 * Get appropriate session manager based on config
 */
function getSessionManager(config: GhwtConfig): TerminalSessionManager {
  const multiplexer = config.terminalMultiplexer || "tmux";

  if (multiplexer === "zellij") {
    return new ZellijSessionManager();
  } else {
    return new TmuxSessionManager();
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
  ghwtConfig: GhwtConfig
): Promise<void> {
  const configPath = findSessionConfig(project, ghwtConfig);
  if (!configPath) {
    // No config file, skip session creation
    return;
  }

  const config = loadSessionConfig(configPath);
  const sessionName = `${project}-${branch.replace(/\//g, "-")}`;
  const manager = getSessionManager(ghwtConfig);

  try {
    // Create session
    await manager.createSession(sessionName, config, worktreePath);
    console.log(`⚙️  Terminal session created: ${sessionName}`);

    // Launch UI based on config
    const ui = ghwtConfig.terminalUI || "wezterm";
    if (ui === "wezterm") {
      // For tmux: launch wezterm which wraps tmux
      // For zellij: launch wezterm which wraps zellij
      if (ghwtConfig.terminalMultiplexer === "zellij") {
        // Zellij already running, open in wezterm
        const { execa } = await import("execa");
        await execa("wezterm", [
          "start",
          "--workspace",
          sessionName,
          "--cwd",
          worktreePath,
        ]);
      } else {
        // Tmux: use existing launchUI which launches wezterm
        await manager.launchUI(sessionName, worktreePath);
      }
    } else {
      // Direct UI (zellij native, raw tmux, etc.)
      await manager.launchUI(sessionName, worktreePath);
    }
  } catch (error) {
    throw new Error(`Failed to launch terminal session: ${error}`);
  }
}

/**
 * Attach to existing worktree terminal session
 */
export async function attachCommand(
  project: string,
  branch: string,
  worktreePath: string,
  ghwtConfig?: GhwtConfig
): Promise<void> {
  const sessionName = `${project}-${branch.replace(/\//g, "-")}`;
  const config = ghwtConfig || { terminalMultiplexer: "tmux" } as GhwtConfig;
  const manager = getSessionManager(config);

  try {
    // Check if session exists
    const exists = await manager.sessionExists(sessionName);
    if (!exists) {
      throw new Error(`Session not found: ${sessionName}`);
    }

    // Handle WezTerm UI mode for tmux (detach other clients first)
    const ui = config.terminalUI || "wezterm";
    if (ui === "wezterm" && config.terminalMultiplexer !== "zellij") {
      // For tmux with wezterm UI: detach other clients before attaching
      const tmuxManager = manager as TmuxSessionManager;
      const { execa } = await import("execa");
      try {
        await execa("tmux", ["detach-client", "-s", sessionName]);
      } catch {
        // No other clients attached
      }
    }

    // Attach to session
    await manager.attachToSession(sessionName, worktreePath);
  } catch (error) {
    throw new Error(`Failed to attach to terminal session: ${error}`);
  }
}

/**
 * Kill terminal session
 */
export async function killSession(sessionName: string, ghwtConfig?: GhwtConfig): Promise<void> {
  const config = ghwtConfig || { terminalMultiplexer: "tmux" } as GhwtConfig;
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
  worktreePath: string
): Promise<void> {
  const manager = new TmuxSessionManager();
  return manager.createSession(sessionName, config, worktreePath);
}

export async function launchWezterm(
  sessionName: string,
  worktreePath: string
): Promise<void> {
  const manager = new TmuxSessionManager();
  return manager.launchUI(sessionName, worktreePath);
}

export async function attachToSession(
  sessionName: string,
  worktreePath: string
): Promise<void> {
  const manager = new TmuxSessionManager();
  return manager.attachToSession(sessionName, worktreePath);
}
