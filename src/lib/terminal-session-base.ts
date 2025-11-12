export interface WindowConfig {
  name: string;
  root?: string;
  pre?: string[];
  panes?: string[];
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
 * Check if a terminal UI application is available
 */
export async function isUIAvailable(ui: 'wezterm' | 'ghostty' | 'none'): Promise<boolean> {
  if (ui === 'none') return true; // 'none' is always valid

  try {
    const { existsSync } = await import('fs');
    const { execa } = await import('execa');

    if (ui === 'ghostty') {
      // On macOS, check if Ghostty.app exists in /Applications
      const appPath = '/Applications/Ghostty.app';
      const homeAppPath = `${process.env.HOME}/Applications/Ghostty.app`;
      return existsSync(appPath) || existsSync(homeAppPath);
    } else {
      // For other apps, check if command exists
      await execa(ui, ['--help']);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Launch ghostty with command (handles macOS requirement to use `open`)
 */
export async function launchGhostty(
  args: string[],
  options?: { stdio?: 'inherit' | 'pipe' | 'ignore' },
): Promise<void> {
  const { execa } = await import('execa');

  // Ghostty on macOS requires special handling for -e flag
  // Convert args like ['-e', 'zellij', 'attach', 'session']
  // to: open -a Ghostty --args -e sh -c "zellij attach session"
  const openArgs: string[] = ['-a', 'Ghostty', '--args'];

  if (args[0] === '-e') {
    // If using -e flag, wrap the command in sh -c for proper parsing
    // This ensures all arguments are treated as a single command
    const command = args
      .slice(1)
      .map((arg) => (arg.includes(' ') ? `'${arg.replace(/'/g, "'\\''")}'` : arg))
      .join(' ');
    openArgs.push('-e', 'sh', '-c', command);
  } else {
    // For other args, pass them through as-is
    openArgs.push(...args);
  }

  await execa('open', openArgs, options);
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
