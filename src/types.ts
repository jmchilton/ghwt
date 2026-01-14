export interface GhwtConfig {
  projectsRoot: string;
  repositoriesDir: string;
  worktreesDir: string;
  vaultPath: string;
  syncInterval: number | null;
  obsidianVaultName?: string;
  shellCommandExecuteId?: string;
  terminalMultiplexer?: 'tmux' | 'zellij';
  terminalUI?: 'wezterm' | 'ghostty' | 'none';
  zellijSessionsDir?: string;
  setupPreCommitHooks?: boolean;
}

export interface WorktreeMetadata {
  // Auto-synced from git
  repo_url: string;
  worktree_path: string;
  base_branch: string;
  commits_ahead: number;
  commits_behind: number;
  has_uncommitted_changes: boolean;
  last_commit_date: string;
  tracking_branch: string;

  // Auto-synced from GitHub (PR-specific)
  pr_state?: string;
  pr_checks?: string;
  pr_reviews?: number;
  pr_labels?: string[];
  pr_updated_at?: string;

  // Auto-synced from GitHub Actions (works for branches and PRs)
  ci_checks?: 'passing' | 'failing' | 'pending' | 'none';

  // CI Artifacts
  ci_status?: 'complete' | 'partial' | 'incomplete';
  ci_failed_tests?: number;
  ci_linter_errors?: number;
  ci_artifacts_path?: string;
  ci_last_synced?: string;
  ci_viewer_url?: string;
  ci_head_sha?: string;

  // Activity tracking
  days_since_activity: number;
  last_synced: string;

  // Claude session tracking
  claude_session_id?: string;

  // Manual/static fields
  project: string;
  branch: string;
  pr?: string;
  status: 'draft' | 'in-progress' | 'testing' | 'review' | 'blocked' | 'merged';
  created: string;
}

export interface NoteFrontmatter {
  [key: string]: unknown;
}
