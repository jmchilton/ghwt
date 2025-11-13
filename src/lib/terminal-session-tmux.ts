import { execa } from 'execa';
import { join } from 'path';
import { GhwtConfig } from '../types.js';
import {
  TerminalSessionManager,
  SessionConfig,
  TemplateVars,
  AttachOptions,
  substituteVariables,
  normalizeSessionConfig,
  launchGhostty,
} from './terminal-session-base.js';

export class TmuxSessionManager implements TerminalSessionManager {
  constructor(private config?: GhwtConfig, private verbose = false) {}
  /**
   * Check if tmux session exists
   */
  async sessionExists(sessionName: string): Promise<boolean> {
    try {
      const { stdout } = await execa('tmux', ['list-sessions', '-F', '#{session_name}']);
      return stdout.split('\n').includes(sessionName);
    } catch {
      return false;
    }
  }

  /**
   * Create tmux session with configured tabs, windows and panes
   */
  async createSession(
    sessionName: string,
    config: SessionConfig,
    worktreePath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    notePath?: string,
  ): Promise<void> {
    const sessionExists = await this.sessionExists(sessionName);
    if (sessionExists) {
      console.log(`⚙️  Tmux session already exists: ${sessionName}`);
      return;
    }

    const vars: TemplateVars = {
      worktree_path: worktreePath,
      project: sessionName.split('-')[0],
      branch: sessionName.split('-').slice(1).join('-'),
    };

    // Normalize config to tabs format (handles backward compatibility)
    const normalizedConfig = normalizeSessionConfig(config);

    // Create detached session in worktree directory
    await execa('tmux', ['new-session', '-d', '-s', sessionName, '-c', worktreePath]);

    let globalWindowIndex = 0;

    // Process tabs
    for (const tab of normalizedConfig.tabs) {
      // Process windows within this tab
      for (let windowIndex = 0; windowIndex < tab.windows.length; windowIndex++) {
        const window = tab.windows[windowIndex];
        const windowRoot = window.root ? join(worktreePath, window.root) : worktreePath;
        const substitutedRoot = substituteVariables(windowRoot, vars);

        // Create window name with tab prefix: {tab-name}:{window-name}
        const prefixedWindowName = `${tab.name}:${window.name}`;

        if (globalWindowIndex === 0) {
          // Rename first window (created with session)
          await execa('tmux', ['rename-window', '-t', `${sessionName}:0`, prefixedWindowName]);
          // Change to specified directory if different from session root
          if (windowRoot !== worktreePath) {
            await execa('tmux', [
              'send-keys',
              '-t',
              `${sessionName}:0`,
              `cd ${substitutedRoot}`,
              'C-m',
            ]);
          }
        } else {
          // Create new window
          await execa('tmux', [
            'new-window',
            '-t',
            sessionName,
            '-n',
            prefixedWindowName,
            '-c',
            substitutedRoot,
          ]);
        }

        // Create panes and send commands
        const panes = window.panes || [];
        for (let paneIndex = 0; paneIndex < panes.length; paneIndex++) {
          if (paneIndex > 0) {
            // Split window for additional panes
            await execa('tmux', [
              'split-window',
              '-t',
              `${sessionName}:${globalWindowIndex}`,
              '-c',
              substitutedRoot,
            ]);
            await execa('tmux', [
              'select-layout',
              '-t',
              `${sessionName}:${globalWindowIndex}`,
              'tiled',
            ]);
          }

          const cmd = panes[paneIndex];
          const paneTarget = `${sessionName}:${globalWindowIndex}.${paneIndex}`;

          // Run cascading pre-commands: session → tab → window → pane command
          // 1. Session-level pre commands
          if (normalizedConfig.pre && normalizedConfig.pre.length > 0) {
            for (const preCmd of normalizedConfig.pre) {
              const substitutedPre = substituteVariables(preCmd, vars);
              await execa('tmux', ['send-keys', '-t', paneTarget, substitutedPre, 'C-m']);
            }
          }

          // 2. Tab-level pre commands
          if (tab.pre && tab.pre.length > 0) {
            for (const preCmd of tab.pre) {
              const substitutedPre = substituteVariables(preCmd, vars);
              await execa('tmux', ['send-keys', '-t', paneTarget, substitutedPre, 'C-m']);
            }
          }

          // 3. Window-level pre commands
          if (window.pre && window.pre.length > 0) {
            for (const preCmd of window.pre) {
              const substitutedPre = substituteVariables(preCmd, vars);
              await execa('tmux', ['send-keys', '-t', paneTarget, substitutedPre, 'C-m']);
            }
          }

          // 4. Send actual pane command
          if (cmd) {
            const substitutedCmd = substituteVariables(cmd, vars);
            await execa('tmux', ['send-keys', '-t', paneTarget, substitutedCmd, 'C-m']);
          }
        }

        globalWindowIndex++;
      }
    }

    // Select first window
    await execa('tmux', ['select-window', '-t', `${sessionName}:0`]);
  }

  /**
   * Launch terminal UI app attached to tmux session
   */
  async launchUI(sessionName: string, worktreePath: string): Promise<void> {
    const ui = this.config?.terminalUI || 'wezterm';

    if (ui === 'none') {
      // No UI app, attach directly to tmux
      await execa('tmux', ['attach-session', '-t', sessionName], {
        stdio: 'inherit',
      });
      return;
    }

    // Launch UI app with workspace, starting in worktree, attached to tmux session
    if (ui === 'wezterm') {
      await execa('wezterm', [
        'start',
        '--workspace',
        sessionName,
        '--cwd',
        worktreePath,
        '--',
        'tmux',
        'attach-session',
        '-t',
        sessionName,
      ]);
    } else if (ui === 'ghostty') {
      // Ghostty: launch with -e to execute tmux attach
      // Working directory is inherited from tmux session
      await launchGhostty(['-e', 'tmux', 'attach-session', '-t', sessionName]);
    } else {
      // Unknown UI, fall back to direct tmux attach
      await execa('tmux', ['attach-session', '-t', sessionName], {
        stdio: 'inherit',
      });
    }
  }

  /**
   * Attach to existing tmux session in new UI app window
   */
  async attachToSession(
    sessionName: string,
    worktreePath: string,
    options?: AttachOptions,
  ): Promise<void> {
    // Check if session exists
    const exists = await this.sessionExists(sessionName);
    if (!exists) {
      throw new Error(`Tmux session not found: ${sessionName}`);
    }

    // Detach any other clients from the session first
    try {
      await execa('tmux', ['detach-client', '-s', sessionName]);
    } catch {
      // Session might not have other clients attached, that's fine
    }

    const ui = this.config?.terminalUI || 'wezterm';

    // Launch UI app attached to the tmux session
    try {
      if (ui === 'wezterm') {
        const weztermArgs = ['start', '--workspace', sessionName, '--cwd', worktreePath];

        // Add --always-new-process unless --existing-terminal flag is set
        if (options?.alwaysNewProcess !== false) {
          weztermArgs.push('--always-new-process');
        }

        weztermArgs.push('--', 'tmux', 'attach-session', '-t', sessionName);

        await execa('wezterm', weztermArgs, {
          stdio: 'inherit',
        });
      } else if (ui === 'ghostty') {
        // Ghostty: launch with -e to execute tmux attach
        // --always-new-process option doesn't apply to ghostty on macOS
        await launchGhostty(['-e', 'tmux', 'attach-session', '-t', sessionName], {
          stdio: 'inherit',
        });
      } else if (ui === 'none') {
        // Direct tmux attach
        await execa('tmux', ['attach-session', '-t', sessionName], {
          stdio: 'inherit',
        });
      } else {
        // Unknown UI, fall back to direct tmux attach
        await execa('tmux', ['attach-session', '-t', sessionName], {
          stdio: 'inherit',
        });
      }
    } catch {
      // If UI app is not available, fall back to direct tmux attach
      console.log(`📋 Attaching to session in current terminal...`);
      await execa('tmux', ['attach-session', '-t', sessionName], {
        stdio: 'inherit',
      });
    }
  }

  /**
   * Kill tmux session
   */
  async killSession(sessionName: string): Promise<void> {
    try {
      await execa('tmux', ['kill-session', '-t', sessionName]);
    } catch {
      // Session doesn't exist, that's fine
    }
  }
}
