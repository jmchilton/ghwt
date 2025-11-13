import { execa } from 'execa';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch, getCurrentWorktreeContext } from '../lib/worktree-list.js';
import { loadProjectPaths, getNotePath } from '../lib/paths.js';
import { assertNoteExists } from '../lib/errors.js';
import { getObsidianNoteUrl } from '../lib/obsidian.js';

export async function noteCommand(
  project?: string,
  branch?: string,

  options?: { verbose?: boolean; this?: boolean },
): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  // If --this flag is set, use current worktree context
  if (options?.this) {
    try {
      const context = await getCurrentWorktreeContext();
      selectedProject = context.project;
      selectedBranch = context.branch;
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else if (!selectedProject || !selectedBranch) {
    // If either is missing, show picker
    const picked = await pickWorktree(project);
    selectedProject = picked.project;
    selectedBranch = picked.branch;
  } else if (selectedBranch && selectedProject) {
    // Resolve branch to get the full reference with type prefix
    selectedBranch = resolveBranch(selectedProject, selectedBranch);
  }

  const { vaultRoot } = loadProjectPaths();
  const notePath = getNotePath(vaultRoot, selectedProject, selectedBranch);

  // Check if note exists
  assertNoteExists(notePath);

  try {
    const obsidianUrl = getObsidianNoteUrl(selectedProject, selectedBranch);
    await execa('open', [obsidianUrl]);
    console.log(`📖 Opened in Obsidian: ${notePath}`);
  } catch (error) {
    console.error(`❌ Failed to open Obsidian: ${error}`);
    process.exit(1);
  }
}
