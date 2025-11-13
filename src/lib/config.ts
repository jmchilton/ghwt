import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { GhwtConfig } from '../types.js';
import { validateGhwtConfig } from './schemas.js';

const CONFIG_FILE = join(homedir(), '.ghwtrc.json');

const DEFAULT_CONFIG: GhwtConfig = {
  projectsRoot: '~/projects',
  repositoriesDir: 'repositories',
  worktreesDir: 'worktrees',
  vaultPath: '~/Library/Mobile Documents/iCloud~md~obsidian/Documents/projects',
  syncInterval: null,
  defaultBaseBranch: 'dev',
  terminalMultiplexer: 'tmux',
  terminalUI: 'wezterm',
};

export function loadConfig(): GhwtConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      return validateGhwtConfig(parsed);
    }
    return validateGhwtConfig(DEFAULT_CONFIG);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to load config from ${CONFIG_FILE}:\n${message}`);
    process.exit(1);
  }
}

export function saveConfig(config: GhwtConfig): void {
  try {
    const validated = validateGhwtConfig(config);
    writeFileSync(CONFIG_FILE, JSON.stringify(validated, null, 2));
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
