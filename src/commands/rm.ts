import { join } from "path";
import { existsSync, rmSync, mkdirSync, cpSync } from "fs";
import { execa } from "execa";
import { loadConfig, expandPath } from "../lib/config.js";
import { killSession } from "../lib/terminal-session.js";
import { pickWorktree } from "../lib/worktree-picker.js";

export async function rmCommand(project?: string, branch?: string): Promise<void> {
  // Show picker if project or branch not specified
  if (!project || !branch) {
    const picked = await pickWorktree(project);
    project = picked.project;
    branch = picked.branch;
  }

  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const reposRoot = join(projectsRoot, config.repositoriesDir);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);
  const vaultRoot = expandPath(config.vaultPath);

  const repoPath = join(reposRoot, project);
  const worktreeName = `${project}-${branch.replace(/\//g, "-")}`;
  const worktreePath = join(worktreesRoot, worktreeName);
  const noteDir = join(vaultRoot, "projects", project, "worktrees");
  const notePath = join(noteDir, branch.replace(/\//g, "-") + ".md");
  const archiveDir = join(projectsRoot, "old");

  console.log(`🗑️  Removing worktree: ${branch}`);

  // Kill session if it exists
  const sessionName = `${project}-${branch.replace(/\//g, "-")}`;
  try {
    await killSession(sessionName, config);
    console.log(`✅ Killed terminal session: ${sessionName}`);
  } catch (error) {
    console.log(`⚠️  Terminal session not found: ${sessionName}`);
  }

  // Check if worktree exists
  if (!existsSync(worktreePath)) {
    console.log(`⚠️  Worktree not found: ${worktreePath}`);
  } else {
    // Remove worktree
    try {
      rmSync(worktreePath, { recursive: true, force: true });
      console.log(`✅ Deleted worktree: ${worktreePath}`);
    } catch (error) {
      console.error(`❌ Failed to delete worktree: ${error}`);
      throw error;
    }
  }

  // Prune repository
  try {
    await execa("git", ["worktree", "prune"], { cwd: repoPath });
    console.log(`✅ Pruned repository`);
  } catch (error) {
    console.error(`⚠️  Failed to prune repository: ${error}`);
  }

  // Archive note
  if (!existsSync(notePath)) {
    console.log(`⚠️  Note not found: ${notePath}`);
  } else {
    try {
      // Create archive directory if it doesn't exist
      mkdirSync(archiveDir, { recursive: true });

      // Copy note to archive
      const archiveNotePath = join(archiveDir, `${project}-${branch.replace(/\//g, "-")}.md`);
      cpSync(notePath, archiveNotePath);

      // Delete original note
      rmSync(notePath);

      console.log(`✅ Archived note: ${archiveNotePath}`);
    } catch (error) {
      console.error(`❌ Failed to archive note: ${error}`);
      throw error;
    }
  }

  console.log(`\n✅ Done! Worktree removed, note archived to ${archiveDir}`);
}
