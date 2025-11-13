import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { dirname } from 'path';
import YAML from 'js-yaml';
import { NoteFrontmatter, WorktreeMetadata } from '../types.js';
import { loadConfig } from './config.js';
import { getNoteFileName } from './paths.js';

export interface NoteContent {
  frontmatter: NoteFrontmatter;
  body: string;
}

export function parseFrontmatter(content: string): {
  frontmatter: NoteFrontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterStr = match[1];
  const body = match[2];

  try {
    const frontmatter = YAML.load(frontmatterStr) as NoteFrontmatter;
    return { frontmatter: frontmatter || {}, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export function serializeFrontmatter(frontmatter: NoteFrontmatter): string {
  const yaml = YAML.dump(frontmatter, {
    lineWidth: -1,
    quotingType: "'",
  });
  return `---\n${yaml}---`;
}

export function readNote(notePath: string): NoteContent {
  if (!existsSync(notePath)) {
    return { frontmatter: {}, body: '' };
  }

  const content = readFileSync(notePath, 'utf-8');
  return parseFrontmatter(content);
}

export function writeNote(notePath: string, frontmatter: NoteFrontmatter, body: string): void {
  const dir = dirname(notePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const frontmatterStr = serializeFrontmatter(frontmatter);
  const content = `${frontmatterStr}\n\n${body}`;

  writeFileSync(notePath, content, 'utf-8');
}

export function extractUserNotes(body: string): string {
  // Extract content between "## Notes" and "## Quick Actions" sections
  const match = body.match(/## Notes\n([\s\S]*?)\n## Quick Actions/);
  return match ? match[1] : '';
}

export function generateNoteBody(metadata: Partial<WorktreeMetadata>): string {
  const ciSection = metadata.ci_viewer_url
    ? `## CI Artifacts
- [View Results](${metadata.ci_viewer_url})

`
    : '';

  // Generate quick action links using Obsidian shell commands URI
  let quickActionsSection = '## Quick Actions\n\n';

  try {
    const config = loadConfig();
    if (config.obsidianVaultName && config.shellCommandExecuteId) {
      const vault = encodeURIComponent(config.obsidianVaultName);
      const executeId = encodeURIComponent(config.shellCommandExecuteId);
      const project = encodeURIComponent(metadata.project || '');
      const worktree = encodeURIComponent(metadata.branch || '');

      quickActionsSection += `[📝 Open Code](obsidian://shell-commands/?vault=${vault}&execute=${executeId}&_subcommand=code&_project=${project}&_worktree=${worktree})\n`;
      quickActionsSection += `[📄 Open Note](obsidian://shell-commands/?vault=${vault}&execute=${executeId}&_subcommand=note&_project=${project}&_worktree=${worktree})\n`;
      quickActionsSection += `[⌨️  Open Terminal](obsidian://shell-commands/?vault=${vault}&execute=${executeId}&_subcommand=attach&_project=${project}&_worktree=${worktree})\n`;
    }
  } catch {
    // If config fails, skip quick actions
  }

  const linksSection = `## Links
- [Open in VS Code](vscode://file/${metadata.worktree_path})
- \`${metadata.worktree_path}\` (copy path)
${metadata.pr ? `- [PR link](${metadata.pr})` : ''}`;

  const body = `## Summary
Worktree created for **${metadata.branch}** in project **${metadata.project}**

## TODO
- [ ] Implement main feature
- [ ] Push branch
- [ ] Create PR (if not exists)

${ciSection}## Notes

${quickActionsSection}
${linksSection}
`;

  return body;
}

export function createWorktreeNote(notePath: string, metadata: Partial<WorktreeMetadata>): void {
  const frontmatter: NoteFrontmatter = {
    project: metadata.project,
    branch: metadata.branch,
    pr: metadata.pr || null,
    status: metadata.status || 'in-progress',
    created: metadata.created || new Date().toISOString().split('T')[0],
    repo_url: metadata.repo_url,
    worktree_path: metadata.worktree_path,
    base_branch: metadata.base_branch,
    commits_ahead: metadata.commits_ahead || 0,
    commits_behind: metadata.commits_behind || 0,
    has_uncommitted_changes: metadata.has_uncommitted_changes || false,
    last_commit_date: metadata.last_commit_date,
    tracking_branch: metadata.tracking_branch || null,
    ...(metadata.ci_status && {
      ci_status: metadata.ci_status,
      ci_failed_tests: metadata.ci_failed_tests,
      ci_linter_errors: metadata.ci_linter_errors,
      ci_artifacts_path: metadata.ci_artifacts_path,
      ci_viewer_url: metadata.ci_viewer_url,
      ci_head_sha: metadata.ci_head_sha,
      ci_last_synced: metadata.ci_last_synced,
    }),
    last_synced: new Date().toISOString(),
  };

  const body = generateNoteBody(metadata);
  writeNote(notePath, frontmatter, body);
}

export function updateNoteMetadata(notePath: string, updates: Partial<WorktreeMetadata>): void {
  const { frontmatter, body } = readNote(notePath);

  // Merge updates with existing frontmatter, preserving user-added fields
  const merged = {
    ...frontmatter,
    ...updates,
    last_synced: new Date().toISOString(),
  };

  // Preserve user notes from existing body, regenerate other sections
  const userNotes = extractUserNotes(body);
  const newBody = generateNoteBody(merged);

  // Insert preserved user notes after the Notes section
  const finalBody = newBody.replace(/## Notes\n/, `## Notes\n${userNotes}`);

  writeNote(notePath, merged, finalBody);
}

export function calculateDaysSinceActivity(notePath: string): number {
  if (!existsSync(notePath)) {
    return 0;
  }

  const stats = statSync(notePath);
  const lastModified = new Date(stats.mtime);
  const now = new Date();
  const diffMs = now.getTime() - lastModified.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get Obsidian URL to open a note
 * @param project The project name
 * @param branch The branch reference (with or without type prefix)
 * @param vaultName The Obsidian vault name (defaults to 'projects' for backward compatibility)
 * @example getObsidianNoteUrl('galaxy', 'branch/main') => 'obsidian://open?vault=projects&file=projects/galaxy/worktrees/main.md'
 * @example getObsidianNoteUrl('galaxy', 'pr/1234', 'ghwt') => 'obsidian://open?vault=ghwt&file=projects/galaxy/worktrees/1234.md'
 */
export function getObsidianNoteUrl(project: string, branch: string, vaultName?: string): string {
  const noteFileName = getNoteFileName(branch);
  const vault = vaultName || 'projects';
  return `obsidian://open?vault=${vault}&file=projects/${project}/worktrees/${noteFileName}`;
}
