import { NoteFrontmatter } from '../types.js';

/**
 * Staleness threshold (days since activity) for "needs attention".
 * Mirrors the dashboard's Dataview "Needs Attention" query in init.ts -
 * keep the two in sync if either changes.
 */
export const ATTENTION_STALE_DAYS = 7;

/**
 * Whether a worktree currently needs attention.
 *
 * This is the shared TS predicate behind the dashboard's "Needs Attention"
 * Dataview query (init.ts):
 *   pr_checks = "failing" OR days_since_activity > 7
 *     OR has_uncommitted_changes = true OR agent_status = "blocked"
 * plus failing CI (the ci_checks field), which the issue calls out explicitly.
 * Keep this predicate and that Dataview query in sync if either changes.
 *
 * agent_status === 'blocked' (agent-aware backends only, e.g. herdr: the
 * coding agent is waiting on the human) is exactly the per-worktree signal
 * this dashboard exists to surface, so it counts as needs-attention.
 *
 * Defensive about field presence: frontmatter is an open record.
 */
export function needsAttention(frontmatter: NoteFrontmatter): boolean {
  const prChecks = frontmatter.pr_checks;
  const ciChecks = frontmatter.ci_checks;
  const daysSinceActivity = frontmatter.days_since_activity;
  const hasUncommitted = frontmatter.has_uncommitted_changes;
  const agentStatus = frontmatter.agent_status;

  if (prChecks === 'failing') return true;
  if (ciChecks === 'failing') return true;
  if (hasUncommitted === true) return true;
  if (agentStatus === 'blocked') return true;
  if (typeof daysSinceActivity === 'number' && daysSinceActivity > ATTENTION_STALE_DAYS) {
    return true;
  }
  return false;
}
