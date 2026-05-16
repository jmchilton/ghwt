import { describe, it, expect, vi } from 'vitest';
import { needsAttention, ATTENTION_STALE_DAYS } from '../../lib/attention.js';
import { notifyOnAttentionTransition } from '../../commands/sync.js';
import { TerminalSessionManager } from '../../lib/terminal-session-base.js';

describe('needsAttention truth table', () => {
  it('false for a healthy worktree', () => {
    expect(
      needsAttention({
        pr_checks: 'passing',
        ci_checks: 'passing',
        has_uncommitted_changes: false,
        days_since_activity: 1,
      }),
    ).toBe(false);
  });

  it('true when PR checks failing', () => {
    expect(needsAttention({ pr_checks: 'failing' })).toBe(true);
  });

  it('true when CI checks failing', () => {
    expect(needsAttention({ ci_checks: 'failing' })).toBe(true);
  });

  it('true when there are uncommitted changes', () => {
    expect(needsAttention({ has_uncommitted_changes: true })).toBe(true);
  });

  it('true only past the staleness threshold', () => {
    expect(needsAttention({ days_since_activity: ATTENTION_STALE_DAYS })).toBe(false);
    expect(needsAttention({ days_since_activity: ATTENTION_STALE_DAYS + 1 })).toBe(true);
  });

  it('false on an empty/partial frontmatter', () => {
    expect(needsAttention({})).toBe(false);
  });
});

describe('notifyOnAttentionTransition', () => {
  const makeManager = (withNotify: boolean) => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const mgr = { notify: withNotify ? notify : undefined } as unknown as TerminalSessionManager;
    return { mgr, notify };
  };

  it('fires on a false -> true transition', async () => {
    const { mgr, notify } = makeManager(true);
    await notifyOnAttentionTransition(
      mgr,
      'proj-branch',
      'proj',
      'branch',
      { pr_checks: 'passing' },
      { pr_checks: 'failing' },
    );
    expect(notify).toHaveBeenCalledWith('proj-branch', 'ghwt: needs attention', 'proj/branch');
  });

  it('does not fire when already needing attention (no transition)', async () => {
    const { mgr, notify } = makeManager(true);
    await notifyOnAttentionTransition(
      mgr,
      'proj-branch',
      'proj',
      'branch',
      { pr_checks: 'failing' },
      { pr_checks: 'failing' },
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not fire on a true -> false transition', async () => {
    const { mgr, notify } = makeManager(true);
    await notifyOnAttentionTransition(
      mgr,
      'proj-branch',
      'proj',
      'branch',
      { has_uncommitted_changes: true },
      { has_uncommitted_changes: false },
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('merges partial updates over prior frontmatter (a sparse delta cannot erase prior attention)', async () => {
    const { mgr, notify } = makeManager(true);
    // Prior already needs attention via ci_checks; the sync delta only carries
    // pr_checks. Merge must keep ci_checks=failing -> still attention, no
    // false->true transition, so no notification.
    await notifyOnAttentionTransition(
      mgr,
      'proj-branch',
      'proj',
      'branch',
      { ci_checks: 'failing' },
      { pr_checks: 'passing' },
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('is a no-op for backends without notify (tmux/zellij)', async () => {
    const { mgr } = makeManager(false);
    await expect(
      notifyOnAttentionTransition(
        mgr,
        'proj-branch',
        'proj',
        'branch',
        { pr_checks: 'passing' },
        { pr_checks: 'failing' },
      ),
    ).resolves.toBeUndefined();
  });

  it('swallows notify errors (advisory only)', async () => {
    const notify = vi.fn().mockRejectedValue(new Error('cmux down'));
    const mgr = { notify } as unknown as TerminalSessionManager;
    await expect(
      notifyOnAttentionTransition(
        mgr,
        'p-b',
        'p',
        'b',
        { ci_checks: 'passing' },
        { ci_checks: 'failing' },
      ),
    ).resolves.toBeUndefined();
  });
});
