import { execa } from 'execa';
import { spawn } from 'child_process';
import { join } from 'path';
import { mkdirSync, writeFileSync, openSync } from 'fs';
import { createHash } from 'crypto';
import { GhwtConfig } from '../types.js';
import {
  TerminalSessionManager,
  SessionConfig,
  TemplateVars,
  AttachOptions,
  substituteVariables,
  normalizeSessionConfig,
  launchGhostty,
  shortenSessionName,
} from './terminal-session-base.js';

export class ZellijSessionManager implements TerminalSessionManager {
  constructor(private config?: GhwtConfig, private verbose = false) {}

  /**
   * Check if zellij session exists
   */
  async sessionExists(sessionName: string): Promise<boolean> {
    try {
      const { stdout } = await execa('zellij', ['list-sessions']);
      const shortened = shortenSessionName(sessionName);
      return stdout.includes(shortened);
    } catch {
      return false;
    }
  }

  /**
   * Generate KDL layout from session config with tabs support
   */
  private generateKdlLayout(
    config: SessionConfig,
    worktreePath: string,
    vars: TemplateVars,
  ): string {
    const layout: string[] = [];
    layout.push('layout {');

    // Normalize config to tabs format (handles backward compatibility)
    const normalizedConfig = normalizeSessionConfig(config);

    // Get user's default shell, fallback to bash
    const shell = process.env.SHELL || '/bin/bash';

    // Get zellij UI mode (default: 'full')
    const uiMode = config.zellij_ui?.mode || 'full';

    // Generate default_tab_template with UI bars if needed
    if (uiMode === 'full' || uiMode === 'compact') {
      layout.push('  default_tab_template {');

      // Top UI bar
      if (uiMode === 'full') {
        layout.push('    pane size=1 borderless=true {');
        layout.push('      plugin location="zellij:tab-bar"');
        layout.push('    }');
      }

      // Content area placeholder
      layout.push('    children');

      // Bottom UI bar
      if (uiMode === 'full') {
        layout.push('    pane size=2 borderless=true {');
        layout.push('      plugin location="zellij:status-bar"');
        layout.push('    }');
      } else if (uiMode === 'compact') {
        layout.push('    pane size=1 borderless=true {');
        layout.push('      plugin location="zellij:compact-bar"');
        layout.push('    }');
      }

      layout.push('  }');
    }

    // Process tabs
    for (const tab of normalizedConfig.tabs) {
      layout.push(`  tab name="${tab.name}" {`);

      // Process windows within this tab
      for (const window of tab.windows) {
        const windowRoot = window.root ? join(worktreePath, window.root) : worktreePath;
        const substitutedRoot = substituteVariables(windowRoot, vars);
        const panes = window.panes || [];

        // Start pane for this window
        layout.push(`    pane name="${window.name}" {`);
        layout.push(`      cwd "${substitutedRoot}"`);

        // Run cascading pre-commands: session → tab → window → pane command
        // 1. Session-level pre commands
        if (normalizedConfig.pre && normalizedConfig.pre.length > 0) {
          for (const preCmd of normalizedConfig.pre) {
            const substituted = substituteVariables(preCmd, vars);
            layout.push(`      command "${shell}" {`);
            layout.push(`        args "-c" "${escapeQuotes(substituted)}"`);
            layout.push(`      }`);
          }
        }

        // 2. Tab-level pre commands
        if (tab.pre && tab.pre.length > 0) {
          for (const preCmd of tab.pre) {
            const substituted = substituteVariables(preCmd, vars);
            layout.push(`      command "${shell}" {`);
            layout.push(`        args "-c" "${escapeQuotes(substituted)}"`);
            layout.push(`      }`);
          }
        }

        // 3. Window-level pre commands
        if (window.pre && window.pre.length > 0) {
          for (const preCmd of window.pre) {
            const substituted = substituteVariables(preCmd, vars);
            layout.push(`      command "${shell}" {`);
            layout.push(`        args "-c" "${escapeQuotes(substituted)}"`);
            layout.push(`      }`);
          }
        }

        // 4. Run first pane command if exists
        if (panes.length > 0 && panes[0]) {
          const substitutedCmd = substituteVariables(panes[0], vars);
          layout.push(`      command "${shell}" {`);
          layout.push(`        args "-c" "${escapeQuotes(substitutedCmd)}"`);
          layout.push(`      }`);
        }

        // Close main pane
        layout.push(`    };`);

        // Create additional panes (splits) if they exist
        for (let j = 1; j < panes.length; j++) {
          layout.push(`    pane split direction="vertical" {`);
          layout.push(`      cwd "${substitutedRoot}"`);

          // Run cascading pre-commands for split panes
          // 1. Session-level pre commands
          if (normalizedConfig.pre && normalizedConfig.pre.length > 0) {
            for (const preCmd of normalizedConfig.pre) {
              const substituted = substituteVariables(preCmd, vars);
              layout.push(`      command "${shell}" {`);
              layout.push(`        args "-c" "${escapeQuotes(substituted)}"`);
              layout.push(`      }`);
            }
          }

          // 2. Tab-level pre commands
          if (tab.pre && tab.pre.length > 0) {
            for (const preCmd of tab.pre) {
              const substituted = substituteVariables(preCmd, vars);
              layout.push(`      command "${shell}" {`);
              layout.push(`        args "-c" "${escapeQuotes(substituted)}"`);
              layout.push(`      }`);
            }
          }

          // 3. Window-level pre commands
          if (window.pre && window.pre.length > 0) {
            for (const preCmd of window.pre) {
              const substituted = substituteVariables(preCmd, vars);
              layout.push(`      command "${shell}" {`);
              layout.push(`        args "-c" "${escapeQuotes(substituted)}"`);
              layout.push(`      }`);
            }
          }

          // 4. Run pane command
          const cmd = panes[j];
          if (cmd) {
            const substitutedCmd = substituteVariables(cmd, vars);
            layout.push(`      command "${shell}" {`);
            layout.push(`        args "-c" "${escapeQuotes(substitutedCmd)}"`);
            layout.push(`      }`);
          }

          layout.push(`    };`);
        }
      }

      // Close tab
      layout.push(`  };`);
    }

    layout.push('}');
    return layout.join('\n');
  }

  /**
   * Create zellij session with configured layout
   */
  async createSession(
    sessionName: string,
    config: SessionConfig,
    worktreePath: string,
  ): Promise<void> {
    const shortenedName = shortenSessionName(sessionName);

    const sessionExists = await this.sessionExists(sessionName);
    if (sessionExists) {
      console.log(`⚙️  Zellij session already exists: ${shortenedName}`);
      return;
    }

    const vars: TemplateVars = {
      worktree_path: worktreePath,
      project: sessionName.split('-')[0],
      branch: sessionName.split('-').slice(1).join('-'),
    };

    // Generate KDL layout
    const kdlLayout = this.generateKdlLayout(config, worktreePath, vars);

    // Write layout to persistent cache directory (not /tmp which gets cleaned)
    const layoutDir = join(worktreePath, '.zellij');
    mkdirSync(layoutDir, { recursive: true });
    const layoutPath = join(layoutDir, 'layout.kdl');
    writeFileSync(layoutPath, kdlLayout);

    try {
      // Create session in background with layout (using spawn for detached mode)
      if (this.verbose) {
        console.log(`  $ zellij -s ${shortenedName} -n ${layoutPath}`);
      }

      return new Promise((resolve, reject) => {
        // Open /dev/null to prevent zellij from trying to interact with terminal
        const devNull = openSync('/dev/null', 'r');

        const proc = spawn('zellij', ['-s', shortenedName, '-n', layoutPath], {
          cwd: worktreePath,
          detached: true,
          stdio: [devNull, 'ignore', 'ignore'],
        });

        // Unref the process so parent can exit without waiting
        proc.unref();

        // Resolve immediately - session is created in background
        // Give zellij a moment to initialize the session
        setTimeout(() => resolve(), 300);

        // Don't log exit codes - zellij exits quickly even when successful
        // Session creation happens asynchronously in the background
        proc.on('error', (error) => {
          reject(new Error(`Failed to create zellij session: ${error}`));
        });
      });
    } catch (error) {
      throw new Error(`Failed to create zellij session: ${error}`);
    }
  }

  /**
   * Launch zellij, optionally wrapped in UI app (wezterm/ghostty)
   */
  async launchUI(sessionName: string, worktreePath: string): Promise<void> {
    const shortenedName = shortenSessionName(sessionName);
    const ui = this.config?.terminalUI || 'wezterm';

    if (ui === 'none') {
      // Direct zellij attach
      if (this.verbose) {
        console.log(`  $ zellij attach ${shortenedName}`);
      }
      await execa('zellij', ['attach', shortenedName], {
        cwd: worktreePath,
        stdio: 'inherit',
      });
      return;
    }

    // Launch UI app with zellij attached
    if (ui === 'wezterm') {
      if (this.verbose) {
        console.log(`  $ wezterm start --workspace ${shortenedName} --cwd ${worktreePath} -- zellij attach ${shortenedName}`);
      }
      await execa('wezterm', [
        'start',
        '--workspace',
        shortenedName,
        '--cwd',
        worktreePath,
        '--',
        'zellij',
        'attach',
        shortenedName,
      ]);
    } else if (ui === 'ghostty') {
      // Ghostty: launch with -e to execute zellij attach
      if (this.verbose) {
        console.log(`  $ ghostty -e zellij attach ${shortenedName}`);
      }
      await launchGhostty(['-e', 'zellij', 'attach', shortenedName]);
    } else {
      // Unknown UI, fall back to direct zellij attach
      if (this.verbose) {
        console.log(`  $ zellij attach ${shortenedName}`);
      }
      await execa('zellij', ['attach', shortenedName], {
        cwd: worktreePath,
        stdio: 'inherit',
      });
    }
  }

  /**
   * Attach to existing zellij session
   */
  async attachToSession(
    sessionName: string,
    worktreePath: string,
    options?: AttachOptions,
  ): Promise<void> {
    const shortenedName = shortenSessionName(sessionName);

    const exists = await this.sessionExists(sessionName);
    if (!exists) {
      throw new Error(`Zellij session not found: ${sessionName}`);
    }

    const ui = this.config?.terminalUI || 'wezterm';

    // Try to launch UI app with zellij attached
    try {
      if (ui === 'wezterm') {
        const weztermArgs = ['start', '--workspace', shortenedName, '--cwd', worktreePath];

        // Add --always-new-process unless --existing-terminal flag is set
        if (options?.alwaysNewProcess !== false) {
          weztermArgs.push('--always-new-process');
        }

        weztermArgs.push('--', 'zellij', 'attach', shortenedName);

        if (this.verbose) {
          console.log(`  $ wezterm ${weztermArgs.join(' ')}`);
        }

        await execa('wezterm', weztermArgs, {
          stdio: 'inherit',
        });
      } else if (ui === 'ghostty') {
        // Ghostty: launch with -e to execute zellij attach
        // --always-new-process option doesn't apply to ghostty on macOS
        if (this.verbose) {
          console.log(`  $ ghostty -e zellij attach ${shortenedName}`);
        }
        await launchGhostty(['-e', 'zellij', 'attach', shortenedName], {
          stdio: 'inherit',
        });
      } else if (ui === 'none') {
        // Direct zellij attach
        if (this.verbose) {
          console.log(`  $ zellij attach ${shortenedName}`);
        }
        await execa('zellij', ['attach', shortenedName], {
          cwd: worktreePath,
          stdio: 'inherit',
        });
      } else {
        // Unknown UI, fall back to direct zellij attach
        if (this.verbose) {
          console.log(`  $ zellij attach ${shortenedName}`);
        }
        await execa('zellij', ['attach', shortenedName], {
          cwd: worktreePath,
          stdio: 'inherit',
        });
      }
    } catch {
      // If UI app is not available, fall back to direct zellij attach
      console.log(`📋 Attaching to session in current terminal...`);
      if (this.verbose) {
        console.log(`  $ zellij attach ${shortenedName}`);
      }
      await execa('zellij', ['attach', shortenedName], {
        cwd: worktreePath,
        stdio: 'inherit',
      });
    }
  }

  /**
   * Kill zellij session
   */
  async killSession(sessionName: string): Promise<void> {
    const shortenedName = shortenSessionName(sessionName);

    try {
      await execa('zellij', ['delete-session', '-f', shortenedName]);
    } catch {
      // Session doesn't exist, that's fine
    }
  }
}

/**
 * Escape quotes in KDL strings
 */
function escapeQuotes(str: string): string {
  return str.replace(/"/g, '\\"');
}
