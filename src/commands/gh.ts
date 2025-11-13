import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { execa } from 'execa';
import { pickWorktree } from '../lib/worktree-picker.js';
import { resolveBranch, getCurrentWorktreeContext } from '../lib/worktree-list.js';
import { loadProjectPaths, getNotePath } from '../lib/paths.js';
import { assertRepoExists } from '../lib/errors.js';
import { parseGitRepoUrl } from '../lib/github.js';

/**
 * Parse YAML frontmatter from note to extract PR URL
 */
function extractPRFromNote(notePath: string): string | null {
  try {
    const content = readFileSync(notePath, 'utf-8');
    // Match: pr: 'url' or pr: url (with or without quotes)
    const match = content.match(/^pr:\s*(?:'([^']+)'|"([^"]+)"|([^\n]+))/m);
    if (match && match[1]) return match[1];
    if (match && match[2]) return match[2];
    if (match && match[3]) {
      const value = match[3].trim();
      return value !== 'null' && value.length > 0 ? value : null;
    }
  } catch {
    // Silently fail if we can't read the note
  }
  return null;
}

export async function ghCommand(
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
    const picked = await pickWorktree(project);
    selectedProject = picked.project;
    selectedBranch = picked.branch;
  } else if (selectedBranch && selectedProject) {
    // Resolve branch to get the full reference with type prefix
    selectedBranch = resolveBranch(selectedProject, selectedBranch);
  }

  const { reposRoot, vaultRoot } = loadProjectPaths();

  const repoPath = join(reposRoot, selectedProject);
  const notePath = getNotePath(vaultRoot, selectedProject, selectedBranch);

  // Check if repo exists
  assertRepoExists(repoPath);

  let url = '';

  // Try to get PR URL from note
  if (existsSync(notePath)) {
    const prUrl = extractPRFromNote(notePath);
    if (prUrl) {
      url = prUrl;
    }
  }

  // If no PR URL, construct URL from repo and branch
  if (!url) {
    try {
      // Get origin remote URL
      const { stdout: remoteUrl } = await execa('git', ['remote', 'get-url', 'origin'], {
        cwd: repoPath,
      });

      // Extract owner/repo from URL
      const parsed = parseGitRepoUrl(remoteUrl);
      if (parsed) {
        url = `https://github.com/${parsed.owner}/${parsed.repo}/tree/${selectedBranch}`;
      }
    } catch (error) {
      console.error(`❌ Failed to get GitHub URL: ${error}`);
      process.exit(1);
    }
  }

  try {
    await execa('open', [url]);
    console.log(`🌐 Opened on GitHub: ${url}`);
  } catch (error) {
    console.error(`❌ Failed to open browser: ${error}`);
    process.exit(1);
  }
}
