import { execa } from "execa";
import { spawn } from "child_process";
import { join } from "path";
import { mkdirSync, writeFileSync, openSync } from "fs";
import { createHash } from "crypto";
import {
  TerminalSessionManager,
  SessionConfig,
  TemplateVars,
  AttachOptions,
  substituteVariables,
} from "./terminal-session-base.js";

export class ZellijSessionManager implements TerminalSessionManager {
  /**
   * Shorten session name for zellij (max 32 chars)
   * Uses abbreviations: galaxy-architecture -> ga, feature/implement -> fi
   */
  private shortenSessionName(sessionName: string): string {
    // Zellij has a ~32 char limit for session names
    if (sessionName.length <= 32) {
      return sessionName;
    }

    // Try abbreviating: galaxy-architecture-feature-implement -> ga-fi
    const parts = sessionName.split("-");
    const abbreviated = parts.map((part) => part[0]).join("");

    if (abbreviated.length <= 32) {
      return abbreviated;
    }

    // Fall back to hash + keep project prefix
    const hash = createHash("sha256")
      .update(sessionName)
      .digest("hex")
      .substring(0, 8);
    const project = parts[0] || "session";
    return `${project}-${hash}`;
  }

  /**
   * Check if zellij session exists
   */
  async sessionExists(sessionName: string): Promise<boolean> {
    try {
      const { stdout } = await execa("zellij", ["list-sessions"]);
      const shortened = this.shortenSessionName(sessionName);
      return stdout.includes(shortened);
    } catch {
      return false;
    }
  }

  /**
   * Generate KDL layout from session config
   */
  private generateKdlLayout(
    config: SessionConfig,
    worktreePath: string,
    vars: TemplateVars
  ): string {
    const layout: string[] = [];
    layout.push('layout {');

    // Get user's default shell, fallback to bash
    const shell = process.env.SHELL || "/bin/bash";

    for (let i = 0; i < config.windows.length; i++) {
      const window = config.windows[i];
      const windowRoot = window.root
        ? join(worktreePath, window.root)
        : worktreePath;
      const substitutedRoot = substituteVariables(windowRoot, vars);
      const panes = window.panes || [];

      // Start pane for this window
      layout.push(`  pane name="${window.name}" {`);
      layout.push(`    cwd "${substitutedRoot}"`);

      // Run pre-commands
      if (config.pre && config.pre.length > 0) {
        for (const preCmd of config.pre) {
          const substituted = substituteVariables(preCmd, vars);
          layout.push(`    command "${shell}" {`);
          layout.push(`      args "-c" "${escapeQuotes(substituted)}"`);
          layout.push(`    }`);
        }
      }

      // Run first pane command if exists
      if (panes.length > 0 && panes[0]) {
        const substitutedCmd = substituteVariables(panes[0], vars);
        layout.push(`    command "${shell}" {`);
        layout.push(`      args "-c" "${escapeQuotes(substitutedCmd)}"`);
        layout.push(`    }`);
      }

      // Close main pane
      layout.push(`  };`);

      // Create additional panes (splits) if they exist
      for (let j = 1; j < panes.length; j++) {
        layout.push(`  pane split direction="vertical" {`);
        layout.push(`    cwd "${substitutedRoot}"`);

        // Run pre-commands in split pane
        if (config.pre && config.pre.length > 0) {
          for (const preCmd of config.pre) {
            const substituted = substituteVariables(preCmd, vars);
            layout.push(`      command "${shell}" {`);
            layout.push(`        args "-c" "${escapeQuotes(substituted)}"`);
            layout.push(`      }`);
          }
        }

        // Run pane command
        const cmd = panes[j];
        if (cmd) {
          const substitutedCmd = substituteVariables(cmd, vars);
          layout.push(`      command "${shell}" {`);
          layout.push(`        args "-c" "${escapeQuotes(substitutedCmd)}"`);
          layout.push(`      }`);
        }

        layout.push(`  };`);
      }
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
    worktreePath: string
  ): Promise<void> {
    const shortenedName = this.shortenSessionName(sessionName);

    const sessionExists = await this.sessionExists(sessionName);
    if (sessionExists) {
      console.log(`⚙️  Zellij session already exists: ${shortenedName}`);
      return;
    }

    const vars: TemplateVars = {
      worktree_path: worktreePath,
      project: sessionName.split("-")[0],
      branch: sessionName.split("-").slice(1).join("-"),
    };

    // Generate KDL layout
    const kdlLayout = this.generateKdlLayout(config, worktreePath, vars);

    // Write layout to persistent cache directory (not /tmp which gets cleaned)
    const layoutDir = join(worktreePath, ".zellij");
    mkdirSync(layoutDir, { recursive: true });
    const layoutPath = join(layoutDir, "layout.kdl");
    writeFileSync(layoutPath, kdlLayout);

    try {
      // Create session in background with layout (using spawn for detached mode)
      return new Promise((resolve, reject) => {
        // Open /dev/null to prevent zellij from trying to interact with terminal
        const devNull = openSync("/dev/null", "r");

        const proc = spawn("zellij", [
          "-s",
          shortenedName,
          "-n",
          layoutPath,
        ], {
          cwd: worktreePath,
          detached: true,
          stdio: [devNull, "ignore", "ignore"],
        });

        // Unref the process so parent can exit without waiting
        proc.unref();

        // Resolve immediately - session is created in background
        // Give zellij a moment to initialize the session
        setTimeout(() => resolve(), 300);

        // Don't log exit codes - zellij exits quickly even when successful
        // Session creation happens asynchronously in the background
        proc.on("error", (error) => {
          reject(new Error(`Failed to create zellij session: ${error}`));
        });
      });
    } catch (error) {
      throw new Error(`Failed to create zellij session: ${error}`);
    }
  }

  /**
   * Launch zellij directly (native UI) or via wezterm
   */
  async launchUI(sessionName: string, worktreePath: string): Promise<void> {
    const shortenedName = this.shortenSessionName(sessionName);

    // Simply attach to the session - zellij will use its native UI
    await execa("zellij", ["attach", shortenedName], {
      cwd: worktreePath,
      stdio: "inherit",
    });
  }

  /**
   * Attach to existing zellij session
   */
  async attachToSession(
    sessionName: string,
    worktreePath: string,
    options?: AttachOptions,
  ): Promise<void> {
    const shortenedName = this.shortenSessionName(sessionName);

    const exists = await this.sessionExists(sessionName);
    if (!exists) {
      throw new Error(`Zellij session not found: ${sessionName}`);
    }

    // Try to launch WezTerm with zellij attached
    try {
      const weztermArgs = [
        "start",
        "--workspace",
        shortenedName,
        "--cwd",
        worktreePath,
      ];

      // Add --always-new-process unless --existing-terminal flag is set
      if (options?.alwaysNewProcess !== false) {
        weztermArgs.push("--always-new-process");
      }

      weztermArgs.push(
        "--",
        "zellij",
        "attach",
        shortenedName,
      );

      await execa("wezterm", weztermArgs, {
        stdio: "inherit",
      });
    } catch {
      // If wezterm is not available, fall back to direct zellij attach
      console.log(`📋 Attaching to session in current terminal...`);
      await execa("zellij", ["attach", shortenedName], {
        cwd: worktreePath,
        stdio: "inherit",
      });
    }
  }

  /**
   * Kill zellij session
   */
  async killSession(sessionName: string): Promise<void> {
    const shortenedName = this.shortenSessionName(sessionName);

    try {
      await execa("zellij", ["delete-session", "-f", shortenedName]);
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
