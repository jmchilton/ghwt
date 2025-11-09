import { join } from "path";
import { existsSync } from "fs";
import { loadConfig, expandPath } from "../lib/config.js";
import {
  attachCommand,
  type AttachCommandOptions,
} from "../lib/terminal-session.js";
import { pickWorktree } from "../lib/worktree-picker.js";

export async function attachCmd(
  project?: string,
  branch?: string,
  options?: AttachCommandOptions,
): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  // If either is missing, show picker
  if (!selectedProject || !selectedBranch) {
    const picked = await pickWorktree(project);
    selectedProject = picked.project;
    selectedBranch = picked.branch;
  }

  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);

  const worktreeName = `${selectedProject}-${selectedBranch.replace(/\//g, "-")}`;
  const worktreePath = join(worktreesRoot, worktreeName);

  // Check if worktree exists
  if (!existsSync(worktreePath)) {
    console.error(`❌ Worktree not found: ${worktreePath}`);
    process.exit(1);
  }

  try {
    await attachCommand(
      selectedProject,
      selectedBranch,
      worktreePath,
      config,
      options,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to attach: ${message}`);
    process.exit(1);
  }
}
