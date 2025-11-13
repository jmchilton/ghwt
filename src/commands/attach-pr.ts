import { join } from 'path';
import { getPRInfo, getPRRepoUrl } from '../lib/github.js';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch } from '../lib/worktree-list.js';
import {
  loadProjectPaths,
  getWorktreePath,
  getNotePath,
  parseBranchFromOldFormat,
} from '../lib/paths.js';
import { assertWorktreeExists, assertNoteExists } from '../lib/errors.js';
import { updateNoteMetadata } from '../lib/obsidian.js';

export async function attachPrCommand(
  project?: string,
  branch?: string,
  prNumber?: string,
): Promise<void> {
  // PR number is required
  if (!prNumber) {
    console.error(`❌ PR number is required`);
    process.exit(1);
  }

  let selectedProject = project;
  let selectedBranch = branch;

  // If either is missing, show picker
  if (!selectedProject || !selectedBranch) {
    const picked = await pickWorktree(project);
    selectedProject = picked.project;
    selectedBranch = picked.branch;
    if (!selectedProject || !selectedBranch) {
      console.error(`❌ Failed to pick worktree`);
      process.exit(1);
    }
  } else if (selectedBranch && selectedProject) {
    // Resolve branch to get the full reference with type prefix
    selectedBranch = resolveBranch(selectedProject, selectedBranch);
  }

  const { config, projectsRoot, reposRoot, vaultRoot } = loadProjectPaths();

  const repoPath = join(reposRoot, selectedProject);
  const { branchType, name } = parseBranchFromOldFormat(selectedBranch);
  const worktreePath = getWorktreePath(projectsRoot, config, selectedProject, branchType, name);
  const notePath = getNotePath(vaultRoot, selectedProject, name);

  // Check if worktree exists
  assertWorktreeExists(worktreePath);

  // Check if note exists
  assertNoteExists(notePath);

  try {
    // Get the appropriate repo URL for PR operations (upstream if available, else origin)
    const ghRepo = await getPRRepoUrl(repoPath);

    // Fetch PR info
    const prInfo = await getPRInfo(prNumber, ghRepo);

    console.log(`🔗 PR #${prInfo.number}: ${prInfo.url}`);
    console.log(`📊 State: ${prInfo.state}`);
    console.log(`✅ Checks: ${prInfo.checks}`);

    // Update note frontmatter with PR info
    updateNoteMetadata(notePath, {
      pr: prInfo.url,
      pr_state: prInfo.state,
      pr_checks: prInfo.checks,
      pr_reviews: prInfo.reviews,
      pr_labels: prInfo.labels,
      pr_updated_at: prInfo.updatedAt,
    });

    console.log(`✨ Attached PR #${prInfo.number} to ${selectedProject}/${selectedBranch}`);
  } catch (error) {
    console.error(`❌ Failed to attach PR: ${error}`);
    process.exit(1);
  }
}
