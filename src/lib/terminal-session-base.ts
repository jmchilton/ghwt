export interface WindowConfig {
  name: string;
  root?: string;
  panes?: string[];
}

export interface SessionConfig {
  name: string;
  root?: string;
  pre?: string[];
  windows: WindowConfig[];
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
  createSession(
    sessionName: string,
    config: SessionConfig,
    worktreePath: string
  ): Promise<void>;

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
 * Substitute template variables in strings
 */
export function substituteVariables(
  text: string,
  vars: TemplateVars
): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return result;
}
