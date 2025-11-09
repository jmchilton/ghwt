import Enquirer from "enquirer";
import { listWorktrees, WorktreeInfo } from "./worktree-list.js";

export interface PickedWorktree {
  project: string;
  branch: string;
}

/**
 * Interactive fuzzy picker for selecting a worktree
 * Optionally prefiltered by project
 */
export async function pickWorktree(filterProject?: string): Promise<PickedWorktree> {
  const worktrees = listWorktrees(filterProject);

  if (worktrees.length === 0) {
    const filterText = filterProject ? ` in project '${filterProject}'` : "";
    console.error(`❌ No worktrees found${filterText}`);
    process.exit(1);
  }

  if (worktrees.length === 1) {
    // Auto-select if only one option
    const wt = worktrees[0];
    console.log(`📂 Selected: ${wt.displayName}`);
    return {
      project: wt.project,
      branch: wt.branch,
    };
  }

  // Create prompt choices with clean formatting
  const choices = worktrees.map((wt) => ({
    name: wt.displayName,
    value: wt,
  }));

  const enquirer = new Enquirer<{ worktree: WorktreeInfo | string }>();

  try {
    const answer = await enquirer.prompt({
      type: "select",
      name: "worktree",
      message: filterProject ? `Select branch in ${filterProject}` : "Select worktree",
      choices,
    });

    const selected = answer.worktree;

    // Handle case where selected might be the value object or a string
    if (typeof selected === "object" && selected !== null && "project" in selected && "branch" in selected) {
      return {
        project: selected.project,
        branch: selected.branch,
      };
    }

    // Fallback: find matching worktree by display name
    const found = worktrees.find((wt) => wt.displayName === String(selected));
    if (found) {
      return {
        project: found.project,
        branch: found.branch,
      };
    }

    throw new Error(`Failed to parse selected worktree: ${selected}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cancelled")) {
      console.log("Cancelled.");
      process.exit(0);
    }
    throw error;
  }
}
