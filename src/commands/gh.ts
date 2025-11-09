import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { execa } from "execa";
import { loadConfig, expandPath } from "../lib/config.js";
import { pickWorktree } from "../lib/worktree-picker.js";

/**
 * Parse YAML frontmatter from note to extract PR URL
 */
function extractPRFromNote(notePath: string): string | null {
  try {
    const content = readFileSync(notePath, "utf-8");
    // Match: pr: 'url' or pr: url (with or without quotes)
    const match = content.match(/^pr:\s*(?:'([^']+)'|"([^"]+)"|([^\n]+))/m);
    if (match && match[1]) return match[1];
    if (match && match[2]) return match[2];
    if (match && match[3]) {
      const value = match[3].trim();
      return value !== "null" && value.length > 0 ? value : null;
    }
  } catch {
    // Silently fail if we can't read the note
  }
  return null;
}

export async function ghCommand(project?: string, branch?: string): Promise<void> {
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
  const reposRoot = join(projectsRoot, config.repositoriesDir);
  const vaultRoot = expandPath(config.vaultPath);

  const repoPath = join(reposRoot, selectedProject);
  const notePath = join(vaultRoot, "projects", selectedProject, "worktrees", selectedBranch.replace(/\//g, "-") + ".md");

  // Check if repo exists
  if (!existsSync(repoPath)) {
    console.error(`❌ Repository not found: ${repoPath}`);
    process.exit(1);
  }

  let url = "";

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
      const { stdout: remoteUrl } = await execa("git", ["remote", "get-url", "origin"], {
        cwd: repoPath,
      });

      // Extract owner/repo from URL
      const repoMatch = remoteUrl.match(/[:/]([^/]+)\/(.+?)(?:\.git)?$/);
      if (repoMatch) {
        const owner = repoMatch[1];
        const repo = repoMatch[2].replace(/\.git$/, "");
        url = `https://github.com/${owner}/${repo}/tree/${selectedBranch}`;
      }
    } catch (error) {
      console.error(`❌ Failed to get GitHub URL: ${error}`);
      process.exit(1);
    }
  }

  try {
    await execa("open", [url]);
    console.log(`🌐 Opened on GitHub: ${url}`);
  } catch (error) {
    console.error(`❌ Failed to open browser: ${error}`);
    process.exit(1);
  }
}
