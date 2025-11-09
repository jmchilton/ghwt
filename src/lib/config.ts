import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { GhwtConfig } from "../types.js";

const CONFIG_FILE = join(homedir(), ".ghwtrc.json");

const DEFAULT_CONFIG: GhwtConfig = {
  projectsRoot: "~/projects",
  repositoriesDir: "repositories",
  worktreesDir: "worktrees",
  vaultPath: "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/projects",
  syncInterval: null,
  defaultBaseBranch: "dev",
  terminalMultiplexer: "tmux",
  terminalUI: "wezterm",
};

export function loadConfig(): GhwtConfig {
  if (existsSync(CONFIG_FILE)) {
    const data = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: GhwtConfig): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function getCiArtifactsDir(config: GhwtConfig): string {
  return join(expandPath(config.projectsRoot), "ci-artifacts-config");
}

export function getTerminalSessionConfigDir(config: GhwtConfig): string {
  return join(expandPath(config.projectsRoot), "terminal-session-config");
}
