import { join } from "path";
import { readdirSync, existsSync } from "fs";
import { loadConfig, expandPath } from "./config.js";

export interface WorktreeInfo {
  project: string;
  branch: string;
  path: string;
  displayName: string; // "project: branch" for display
}

/**
 * Get list of all worktrees, optionally filtered by project
 */
export function listWorktrees(filterProject?: string): WorktreeInfo[] {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);
  const repositoriesRoot = join(projectsRoot, config.repositoriesDir || "repositories");

  if (!existsSync(worktreesRoot)) {
    return [];
  }

  // Get list of actual project names from repositories
  let projectNames: string[] = [];
  if (existsSync(repositoriesRoot)) {
    try {
      projectNames = readdirSync(repositoriesRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => b.length - a.length); // Sort by length descending for longest match
    } catch (error) {
      console.error(`Failed to list repositories: ${error}`);
    }
  }

  const worktrees: WorktreeInfo[] = [];

  try {
    const entries = readdirSync(worktreesRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Parse worktree name by matching against known project names
      let project = "";
      let branch = "";

      // Find matching project name (use longest match to handle "galaxy" vs "galaxy-architecture")
      for (const projectName of projectNames) {
        if (entry.name.startsWith(projectName + "-")) {
          project = projectName;
          const remainder = entry.name.slice(projectName.length + 1); // +1 for the hyphen
          branch = remainder.replace(/-/g, "/"); // Convert hyphens back to slashes
          break;
        }
      }

      // Fallback if project not found in repositories
      if (!project) {
        const parts = entry.name.split("-");
        if (parts.length < 2) continue;
        project = parts[0];
        branch = parts.slice(1).join("/");
      }

      // Apply project filter if provided
      if (filterProject && project !== filterProject) {
        continue;
      }

      const path = join(worktreesRoot, entry.name);
      worktrees.push({
        project,
        branch,
        path,
        displayName: `${project}: ${branch}`,
      });
    }

    // Sort by project, then by branch
    worktrees.sort((a, b) => {
      if (a.project !== b.project) {
        return a.project.localeCompare(b.project);
      }
      return a.branch.localeCompare(b.branch);
    });
  } catch (error) {
    console.error(`Failed to list worktrees: ${error}`);
  }

  return worktrees;
}

/**
 * Format worktree for display in picker
 */
export function formatWorktreeForDisplay(info: WorktreeInfo): string {
  return `${info.displayName}`;
}
