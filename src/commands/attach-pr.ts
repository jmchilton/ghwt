import { join } from 'path';
import { existsSync } from 'fs';
import { loadConfig, expandPath } from '../lib/config.js';
import { getPRInfo, getPRRepoUrl } from '../lib/github.js';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch } from '../lib/worktree-list.js';
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

  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const reposRoot = join(projectsRoot, config.repositoriesDir);
  const worktreesRoot = join(projectsRoot, config.worktreesDir);
  const vaultRoot = expandPath(config.vaultPath);

  const repoPath = join(reposRoot, selectedProject);
  const worktreeName = `${selectedProject}-${selectedBranch.replace(/\//g, '-')}`;
  const worktreePath = join(worktreesRoot, worktreeName);
  const noteDir = join(vaultRoot, 'projects', selectedProject, 'worktrees');
  const notePath = join(noteDir, selectedBranch.replace(/\//g, '-') + '.md');

  // Check if worktree exists
  if (!existsSync(worktreePath)) {
    console.error(`❌ Worktree not found: ${worktreePath}`);
    process.exit(1);
  }

  // Check if note exists
  if (!existsSync(notePath)) {
    console.error(`❌ Note not found: ${notePath}`);
    process.exit(1);
  }

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
