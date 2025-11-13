import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { GhwtConfig } from '../types.js';
import { validateGhwtConfig } from './schemas.js';

/**
 * Get the config file path
 * Respects GHWT_CONFIG env var, defaults to ~/.ghwtrc.json
 */
export function getConfigFilePath(): string {
  if (process.env.GHWT_CONFIG) {
    return process.env.GHWT_CONFIG;
  }
  return join(homedir(), '.ghwtrc.json');
}

const DEFAULT_CONFIG: GhwtConfig = {
  projectsRoot: '~/projects',
  repositoriesDir: 'repositories',
  worktreesDir: 'worktrees',
  vaultPath: '~/Library/Mobile Documents/iCloud~md~obsidian/Documents/projects',
  syncInterval: null,
  terminalMultiplexer: 'tmux',
  terminalUI: 'wezterm',
};

export function loadConfig(): GhwtConfig {
  try {
    const configFile = getConfigFilePath();
    if (existsSync(configFile)) {
      const data = readFileSync(configFile, 'utf-8');
      const parsed = JSON.parse(data);
      return validateGhwtConfig(parsed);
    }
    return validateGhwtConfig(DEFAULT_CONFIG);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const configFile = getConfigFilePath();
    console.error(`❌ Failed to load config from ${configFile}:\n${message}`);
    process.exit(1);
  }
}

export function saveConfig(config: GhwtConfig): void {
  try {
    const validated = validateGhwtConfig(config);
    const configFile = getConfigFilePath();
    writeFileSync(configFile, JSON.stringify(validated, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to save config:\n${message}`);
    process.exit(1);
  }
}

export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function getCiArtifactsDir(config: GhwtConfig): string {
  return join(expandPath(config.projectsRoot), 'ci-artifacts');
}

export function getCiArtifactsConfigDir(config: GhwtConfig): string {
  return join(expandPath(config.projectsRoot), 'ci-artifacts-config');
}

export function getTerminalSessionConfigDir(config: GhwtConfig): string {
  return join(expandPath(config.projectsRoot), 'terminal-session-config');
}
