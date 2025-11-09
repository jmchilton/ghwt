#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { createCommand } from "./commands/create.js";
import { syncCommand } from "./commands/sync.js";
import { rmCommand } from "./commands/rm.js";
import { cloneCommand } from "./commands/clone.js";
import { attachCmd } from "./commands/attach.js";
import { codeCommand } from "./commands/code.js";
import { noteCommand } from "./commands/note.js";
import { ghCommand } from "./commands/gh.js";
import { claudeCommand } from "./commands/claude.js";
import { dashboardCommand } from "./commands/dashboard.js";

const program = new Command();

program
  .name("ghwt")
  .description("Worktree-centered development dashboard with Obsidian integration")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize ghwt workspace structure")
  .option("--projects-root <path>", "Root directory for projects")
  .option("--vault-path <path>", "Path to Obsidian vault")
  .action(async (options) => {
    try {
      await initCommand(options);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("create <project> <branch>")
  .description(
    "Create a new worktree and Obsidian note\nBranch format: feature/<name>, bug/<name>, or pr/<number>"
  )
  .action(async (project, branch) => {
    try {
      await createCommand(project, branch);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("sync [project]")
  .description("Sync worktree metadata from git and GitHub")
  .option("-v, --verbose", "Verbose output")
  .action(async (project, options) => {
    try {
      await syncCommand(project, options);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("rm [project] [branch]")
  .description(
    "Remove a worktree, prune repository, and archive Obsidian note\nRun without args to pick from list, or with project to filter"
  )
  .action(async (project, branch) => {
    try {
      await rmCommand(project, branch);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("clone <repo-url> [branch]")
  .description(
    "Clone a repository and optionally create a worktree\nBranch format: feature/<name>, bug/<name>, or pr/<number>"
  )
  .option("--upstream <url>", "Upstream repository URL (e.g., for a fork)")
  .action(async (repoUrl, branch, options) => {
    try {
      await cloneCommand(repoUrl, branch, options.upstream);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("attach [project] [branch]")
  .description(
    "Attach to an existing worktree terminal session\nRun without args to pick from list, or with project to filter",
  )
  .option(
    "--existing-terminal",
    "Reuse existing terminal window instead of launching new wezterm process",
  )
  .action(async (project, branch, cmdOptions) => {
    try {
      await attachCmd(project, branch, {
        existingTerminal: cmdOptions.existingTerminal,
      });
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("code [project] [branch]")
  .description("Open worktree in VS Code\nRun without args to pick from list, or with project to filter")
  .action(async (project, branch) => {
    try {
      await codeCommand(project, branch);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("note [project] [branch]")
  .description("Open worktree note in Obsidian\nRun without args to pick from list, or with project to filter")
  .action(async (project, branch) => {
    try {
      await noteCommand(project, branch);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("gh [project] [branch]")
  .description("Open branch/PR on GitHub\nRun without args to pick from list, or with project to filter")
  .action(async (project, branch) => {
    try {
      await ghCommand(project, branch);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("claude [project] [branch] [prompt...]")
  .description("Open Claude in worktree directory\nRun without args to pick from list, or with project to filter. Optional prompt or --continue flag")
  .option("-c, --continue", "Continue the most recent conversation")
  .action(async (project, branch, prompt, options) => {
    try {
      const promptStr = prompt && prompt.length > 0 ? prompt.join(" ") : undefined;
      await claudeCommand(project, branch, promptStr, options);
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("dashboard")
  .description("Open Obsidian dashboard")
  .action(async () => {
    try {
      await dashboardCommand();
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

program.parse();
