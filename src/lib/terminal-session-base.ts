export interface WindowConfig {
  name: string;
  root?: string;
  pre?: string[];
  panes?: string[];
  /**
   * Zellij-specific: show prompt before running commands in this window
   * (ignored by tmux)
   */
  start_suspended?: boolean;
}

export interface TabConfig {
  name: string;
  pre?: string[];
  windows: WindowConfig[];
}

export interface SessionConfig {
  name: string;
  root?: string;
  pre?: string[];
  tabs?: TabConfig[];
  windows?: WindowConfig[];
  /**
   * Zellij-specific UI configuration (ignored by tmux)
   */
  zellij_ui?: {
    /**
     * UI mode: 'full' (tab-bar + status-bar), 'compact' (minimal), 'none' (no bars)
     * @default 'full'
     */
    mode?: 'full' | 'compact' | 'none';
  };
}

export interface AttachOptions {
  /**
   * If true, reuse existing wezterm instance. If false, launch new process.
   */
  alwaysNewProcess?: boolean;
}

export interface TerminalSessionManager {
  /**
   * Check if session exists
   */
  sessionExists(sessionName: string): Promise<boolean>;

  /**
   * Create session with configured windows and panes
   */
  createSession(sessionName: string, config: SessionConfig, worktreePath: string): Promise<void>;

  /**
   * Launch terminal UI attached to session
   */
  launchUI(sessionName: string, worktreePath: string): Promise<void>;

  /**
   * Attach to existing session in terminal
   */
  attachToSession(
    sessionName: string,
    worktreePath: string,
    options?: AttachOptions,
  ): Promise<void>;

  /**
   * Kill session
   */
  killSession(sessionName: string): Promise<void>;
}

export interface TemplateVars {
  worktree_path: string;
  project: string;
  branch: string;
}

/**
 * Shorten session name for zellij (max ~25 chars to be safe)
 * Uses abbreviations: galaxy-architecture -> ga, feature/implement -> fi
 * Exported so it can be reused by commands that need to match session names
 */
export function shortenSessionName(sessionName: string): string {
  // Zellij has a strict char limit for session names (be conservative with 25)
  if (sessionName.length <= 25) {
    return sessionName;
  }

  // Try abbreviating: galaxy-architecture-feature-implement -> ga-fi
  const parts = sessionName.split('-');
  const abbreviated = parts.map((part) => part[0]).join('');

  if (abbreviated.length <= 32) {
    return abbreviated;
  }

  // Fall back to hash + keep project prefix
  const { createHash } = require('crypto');
  const hash = createHash('sha256').update(sessionName).digest('hex').substring(0, 8);
  const project = parts[0] || 'session';
  return `${project}-${hash}`;
}

/**
 * Check if a terminal UI application is available
 */
export async function isUIAvailable(ui: 'wezterm' | 'ghostty' | 'none'): Promise<boolean> {
  if (ui === 'none') return true; // 'none' is always valid

  try {
    const { execa } = await import('execa');
    await execa(ui, ['--help']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch ghostty with command (same as wezterm - just call directly)
 */
export async function launchGhostty(
  args: string[],
  options?: { stdio?: 'inherit' | 'pipe' | 'ignore' },
): Promise<void> {
  const { execa } = await import('execa');
  await execa('ghostty', args, options);
}

/**
 * Substitute template variables in strings
 */
export function substituteVariables(text: string, vars: TemplateVars): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

/**
 * Normalize session config to always have tabs structure
 * Converts legacy windows-only config to tabs format for backward compatibility
 */
export function normalizeSessionConfig(config: SessionConfig): SessionConfig & { tabs: TabConfig[] } {
  // If tabs already exist, use them
  if (config.tabs && config.tabs.length > 0) {
    return config as SessionConfig & { tabs: TabConfig[] };
  }

  // Convert legacy windows format to tabs format
  const windows = config.windows || [];
  const tabs: TabConfig[] = [
    {
      name: 'default',
      windows: windows,
    },
  ];

  return {
    ...config,
    tabs,
  };
}
