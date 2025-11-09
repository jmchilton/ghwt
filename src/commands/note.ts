import { join } from "path";
import { existsSync } from "fs";
import { execa } from "execa";
import { loadConfig, expandPath } from "../lib/config.js";
import { pickWorktree } from "../lib/worktree-picker.js";

export async function noteCommand(project?: string, branch?: string): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  // If either is missing, show picker
  if (!selectedProject || !selectedBranch) {
    const picked = await pickWorktree(project);
    selectedProject = picked.project;
    selectedBranch = picked.branch;
  }

  const config = loadConfig();
  const vaultRoot = expandPath(config.vaultPath);

  const notePath = join(vaultRoot, "projects", selectedProject, "worktrees", selectedBranch.replace(/\//g, "-") + ".md");

  // Check if note exists
  if (!existsSync(notePath)) {
    console.error(`❌ Note not found: ${notePath}`);
    process.exit(1);
  }

  try {
    // Construct obsidian:// URL
    const obsidianUrl = `obsidian://open?vault=projects&file=projects/${selectedProject}/worktrees/${selectedBranch.replace(/\//g, "-")}.md`;
    await execa("open", [obsidianUrl]);
    console.log(`📖 Opened in Obsidian: ${notePath}`);
  } catch (error) {
    console.error(`❌ Failed to open Obsidian: ${error}`);
    process.exit(1);
  }
}
