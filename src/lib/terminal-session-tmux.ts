import { execa } from "execa";
import { join } from "path";
import {
  TerminalSessionManager,
  SessionConfig,
  TemplateVars,
  AttachOptions,
  substituteVariables,
} from "./terminal-session-base.js";

export class TmuxSessionManager implements TerminalSessionManager {
  /**
   * Check if tmux session exists
   */
  async sessionExists(sessionName: string): Promise<boolean> {
    try {
      const { stdout } = await execa("tmux", [
        "list-sessions",
        "-F",
        "#{session_name}",
      ]);
      return stdout.split("\n").includes(sessionName);
    } catch {
      return false;
    }
  }

  /**
   * Create tmux session with configured windows and panes
   */
  async createSession(
    sessionName: string,
    config: SessionConfig,
    worktreePath: string
  ): Promise<void> {
    const sessionExists = await this.sessionExists(sessionName);
    if (sessionExists) {
      console.log(`⚙️  Tmux session already exists: ${sessionName}`);
      return;
    }

    const vars: TemplateVars = {
      worktree_path: worktreePath,
      project: sessionName.split("-")[0],
      branch: sessionName.split("-").slice(1).join("-"),
    };

    // Create detached session in worktree directory
    await execa("tmux", ["new-session", "-d", "-s", sessionName, "-c", worktreePath]);

    // Run pre-commands in the first window (send them)
    if (config.pre && config.pre.length > 0) {
      for (const preCmd of config.pre) {
        const substituted = substituteVariables(preCmd, vars);
        await execa("tmux", [
          "send-keys",
          "-t",
          `${sessionName}:0`,
          substituted,
          "C-m",
        ]);
      }
    }

    // Process windows (skip first window which was created with session)
    for (let i = 0; i < config.windows.length; i++) {
      const window = config.windows[i];
      const windowRoot = window.root
        ? join(worktreePath, window.root)
        : worktreePath;
      const substitutedRoot = substituteVariables(windowRoot, vars);

      if (i === 0) {
        // Rename first window
        await execa("tmux", [
          "rename-window",
          "-t",
          `${sessionName}:0`,
          window.name,
        ]);
        // Change to specified directory if different from session root
        if (windowRoot !== worktreePath) {
          await execa("tmux", [
            "send-keys",
            "-t",
            `${sessionName}:0`,
            `cd ${substitutedRoot}`,
            "C-m",
          ]);
        }
      } else {
        // Create new window
        await execa("tmux", [
          "new-window",
          "-t",
          sessionName,
          "-n",
          window.name,
          "-c",
          substitutedRoot,
        ]);
      }

      // Create panes and send commands
      const panes = window.panes || [];
      for (let j = 0; j < panes.length; j++) {
        if (j > 0) {
          // Split window for additional panes
          await execa("tmux", [
            "split-window",
            "-t",
            `${sessionName}:${i}`,
            "-c",
            substitutedRoot,
          ]);
          await execa("tmux", [
            "select-layout",
            "-t",
            `${sessionName}:${i}`,
            "tiled",
          ]);
        }

        const cmd = panes[j];
        if (cmd) {
          const substitutedCmd = substituteVariables(cmd, vars);
          // Re-run pre commands in each pane (for venv activation, etc.)
          if (config.pre && config.pre.length > 0) {
            for (const preCmd of config.pre) {
              const substitutedPre = substituteVariables(preCmd, vars);
              await execa("tmux", [
                "send-keys",
                "-t",
                `${sessionName}:${i}.${j}`,
                substitutedPre,
                "C-m",
              ]);
            }
          }
          // Send actual command
          await execa("tmux", [
            "send-keys",
            "-t",
            `${sessionName}:${i}.${j}`,
            substitutedCmd,
            "C-m",
          ]);
        }
      }
    }

    // Select first window
    await execa("tmux", ["select-window", "-t", `${sessionName}:0`]);
  }

  /**
   * Launch wezterm workspace attached to tmux session
   */
  async launchUI(sessionName: string, worktreePath: string): Promise<void> {
    // Launch wezterm with workspace, starting in worktree, attached to tmux session
    await execa("wezterm", [
      "start",
      "--workspace",
      sessionName,
      "--cwd",
      worktreePath,
      "--",
      "tmux",
      "attach-session",
      "-t",
      sessionName,
    ]);
  }

  /**
   * Attach to existing tmux session in new wezterm window
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
      await execa("tmux", ["detach-client", "-s", sessionName]);
    } catch {
      // Session might not have other clients attached, that's fine
    }

    // Launch wezterm attached to the tmux session
    try {
      const weztermArgs = [
        "start",
        "--workspace",
        sessionName,
        "--cwd",
        worktreePath,
      ];

      // Add --always-new-process unless --existing-terminal flag is set
      if (options?.alwaysNewProcess !== false) {
        weztermArgs.push("--always-new-process");
      }

      weztermArgs.push(
        "--",
        "tmux",
        "attach-session",
        "-t",
        sessionName,
      );

      await execa("wezterm", weztermArgs, {
        stdio: "inherit",
      });
    } catch {
      // If wezterm is not available, fall back to direct tmux attach
      console.log(`📋 Attaching to session in current terminal...`);
      await execa("tmux", ["attach-session", "-t", sessionName], {
        stdio: "inherit",
      });
    }
  }

  /**
   * Kill tmux session
   */
  async killSession(sessionName: string): Promise<void> {
    try {
      await execa("tmux", ["kill-session", "-t", sessionName]);
    } catch {
      // Session doesn't exist, that's fine
    }
  }
}
