import { z } from 'zod';
import { GhwtConfig, WorktreeMetadata, NoteFrontmatter } from '../types.js';
import { WindowConfig, TabConfig, SessionConfig } from './terminal-session-base.js';

/**
 * Zod schemas for ghwt configuration validation
 * These schemas validate actual runtime behavior and can be used to generate
 * TypeScript types via z.infer<typeof Schema>
 */

// ============================================================================
// Global Config Schema (.ghwtrc.json)
// ============================================================================

export const GhwtConfigSchema = z
  .object({
    projectsRoot: z.string().describe('Root directory for all projects (supports ~ expansion)'),
    repositoriesDir: z.string().default('repositories').describe('Directory name for bare repositories'),
    worktreesDir: z.string().default('worktrees').describe('Directory name for worktrees'),
    vaultPath: z.string().describe('Path to Obsidian vault (supports ~ expansion)'),
    syncInterval: z
      .union([z.number().int().min(60), z.null()])
      .default(null)
      .describe('Sync interval in seconds (minimum 60, null for no auto-sync)'),
    defaultBaseBranch: z.string().default('dev').describe('Default base branch for new worktrees'),
    terminalMultiplexer: z
      .enum(['tmux', 'zellij'])
      .default('tmux')
      .describe('Terminal multiplexer to use for sessions'),
    terminalUI: z
      .enum(['wezterm', 'ghostty', 'none'])
      .default('wezterm')
      .describe('Terminal UI application'),
    obsidianVaultName: z.string().optional().describe('Name of Obsidian vault for shell command URIs'),
    shellCommandExecuteId: z.string().optional().describe('Shell command executor ID for Obsidian integration'),
  })
  .strict() // Reject unknown properties
  .describe('GHWT global configuration');

export type GhwtConfigType = z.infer<typeof GhwtConfigSchema>;

// ============================================================================
// Session Config Schemas (terminal-session-config/*.ghwt-session.yaml)
// ============================================================================

export const WindowConfigSchema: z.ZodType<WindowConfig> = z
  .object({
    name: z.string().describe('Window/pane name'),
    root: z.string().optional().describe('Working directory relative to worktree root'),
    pre: z.array(z.string()).optional().describe('Commands to run before main command'),
    panes: z.array(z.string()).optional().describe('Commands to execute in this window'),
  })
  .strict()
  .describe('Terminal window configuration');

export const TabConfigSchema: z.ZodType<TabConfig> = z
  .object({
    name: z.string().describe('Tab name'),
    pre: z.array(z.string()).optional().describe('Commands to run before windows'),
    windows: z
      .array(WindowConfigSchema)
      .min(1)
      .describe('Windows within this tab (must have at least 1)'),
  })
  .strict()
  .describe('Terminal tab with windows');

export const SessionConfigSchema: z.ZodType<SessionConfig> = z
  .object({
    name: z.string().describe('Session name (informational)'),
    root: z.string().optional().describe('Root directory (unused - always set to worktree path)'),
    pre: z.array(z.string()).optional().describe('Session-level setup commands'),
    tabs: z.array(TabConfigSchema).optional().describe('New format: tabs with windows'),
    windows: z.array(WindowConfigSchema).optional().describe('Legacy format: windows only (wrapped in default tab)'),
    zellij_ui: z.object({
      mode: z.enum(['full', 'compact', 'none']).optional().default('full').describe('UI mode: full (tab-bar + status-bar), compact (minimal), none (no bars)'),
    }).optional().describe('Zellij-specific UI configuration (ignored by tmux)'),
  })
  .strict()
  .refine(
    (data) => (data.tabs && data.tabs.length > 0) || (data.windows && data.windows.length > 0),
    {
      message: "Session must have either 'tabs' or 'windows' defined",
      path: ['tabs', 'windows'],
    },
  )
  .describe('Terminal session configuration');

export type SessionConfigType = z.infer<typeof SessionConfigSchema>;

// ============================================================================
// Note Frontmatter Schema
// ============================================================================

export const NoteFrontmatterSchema = z
  .object({
    project: z.string().describe('Project name'),
    branch: z.string().describe('Branch name'),
    status: z
      .enum(['draft', 'in-progress', 'testing', 'review', 'blocked', 'merged'])
      .describe('Worktree status'),
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Creation date (YYYY-MM-DD)'),
    repo_url: z.string().describe('Repository URL'),
    worktree_path: z.string().describe('Absolute path to worktree'),
    base_branch: z.string().describe('Base branch name'),
    commits_ahead: z.number().int().min(0).describe('Commits ahead of base branch'),
    commits_behind: z.number().int().min(0).describe('Commits behind base branch'),
    has_uncommitted_changes: z.boolean().describe('Whether worktree has uncommitted changes'),
    last_commit_date: z.string().describe('Date of last commit'),
    tracking_branch: z.string().describe('Remote tracking branch'),
    pr: z.string().optional().describe('Pull request URL'),
    pr_state: z.string().optional().describe('PR state (open/closed/merged)'),
    pr_checks: z.string().optional().describe('PR check status (passing/failing/pending)'),
    pr_reviews: z.number().int().optional().describe('Number of PR reviews'),
    pr_labels: z.array(z.string()).optional().describe('PR labels'),
    pr_updated_at: z.string().optional().describe('PR last updated timestamp'),
    ci_status: z.enum(['complete', 'partial', 'incomplete']).optional().describe('CI artifact status'),
    ci_failed_tests: z.number().int().optional().describe('Number of failed CI tests'),
    ci_linter_errors: z.number().int().optional().describe('Number of CI linter errors'),
    ci_artifacts_path: z.string().optional().describe('Path to CI artifacts'),
    ci_last_synced: z.string().optional().describe('Last CI artifact sync timestamp'),
    ci_viewer_url: z.string().optional().describe('URL to view CI artifacts'),
    ci_head_sha: z.string().optional().describe('Commit SHA for CI artifacts'),
    days_since_activity: z.number().int().min(0).describe('Days since last activity'),
    last_synced: z.string().describe('Metadata last sync timestamp'),
  })
  .passthrough() // Allow additional fields for backward compatibility
  .describe('Worktree note frontmatter metadata');

export type NoteFrontmatterType = z.infer<typeof NoteFrontmatterSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

function formatZodError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
  }
  return String(error);
}

export function validateGhwtConfig(data: unknown): GhwtConfig {
  try {
    return GhwtConfigSchema.parse(data) as GhwtConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid global config:\n${formatZodError(error)}`);
    }
    throw error;
  }
}

export function validateSessionConfig(data: unknown): SessionConfig {
  try {
    return SessionConfigSchema.parse(data) as SessionConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid session config:\n${formatZodError(error)}`);
    }
    throw error;
  }
}

export function validateNoteFrontmatter(data: unknown): NoteFrontmatter {
  try {
    return NoteFrontmatterSchema.parse(data) as NoteFrontmatter;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid note frontmatter:\n${formatZodError(error)}`);
    }
    throw error;
  }
}
