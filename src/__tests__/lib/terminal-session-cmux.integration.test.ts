import { describe, it, expect, afterAll } from 'vitest';
import { execa } from 'execa';
import { CmuxSessionManager } from '../../lib/terminal-session-cmux.js';
import type { SessionConfig } from '../../lib/terminal-session-base.js';

/**
 * Real-cmux integration test (macOS + cmux reachable only).
 *
 * The mocked unit tests asserted a contract that did not survive contact with
 * real cmux (send --surface is rejected; new-surface stacks non-live views).
 * This exercise drives the actual `cmux` binary end to end: create a workspace,
 * verify the pre/pane cascade really executed via read-screen, then tear down.
 *
 * Self-gating: skipped unless on darwin AND `cmux ping` succeeds without an
 * auth-refusal/error envelope (manaflow-ai/cmux#1864 - external CLI access
 * requires cmux's external-access setting). Mirrors how other *.integration
 * tests use real resources but stay green when the resource is absent.
 */

async function cmuxReachable(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    const r = await execa('cmux', ['ping'], { reject: false });
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    if (/Access denied|Failed to write to socket|Broken pipe|(^|\n)\s*Error:/i.test(out)) {
      return false;
    }
    return /PONG/i.test(out);
  } catch {
    return false;
  }
}

describe('cmux integration (real cmux, macOS, socket reachable)', () => {
  const createdRefs: string[] = [];

  afterAll(async () => {
    for (const ref of createdRefs) {
      await execa('cmux', ['close-workspace', '--workspace', ref], { reject: false }).catch(
        () => {},
      );
    }
  });

  it('createSession builds a ghwt-titled workspace whose pane actually runs the cascade', async (ctx) => {
    if (!(await cmuxReachable())) {
      ctx.skip(); // not darwin / cmux unreachable / external access refused
      return;
    }
    const mgr = new CmuxSessionManager(undefined, false);
    const sessionName = `itest-${Date.now()}`;
    const config: SessionConfig = {
      name: 'itest',
      pre: ['echo GHWT_PRE_OK'],
      windows: [{ name: 'w', panes: ['echo GHWT_PANE_OK'] }],
    };
    // A little headroom for the shell-not-ready race (cmux#2538).
    process.env.GHWT_CMUX_SURFACE_DELAY_MS = '800';

    await mgr.createSession(sessionName, config, process.cwd(), 'proj', 'branch');

    const { stdout } = await execa('cmux', ['list-workspaces', '--json']);
    const ws = (JSON.parse(stdout).workspaces as Array<{ ref: string; title?: string }>).find(
      (w) => w.title === `ghwt:${sessionName}`,
    );
    expect(ws, 'ghwt-titled workspace should exist after createSession').toBeTruthy();
    createdRefs.push(ws!.ref);

    expect(await mgr.sessionExists(sessionName)).toBe(true);

    // Let the shell render the echoed output, then assert it really ran.
    await new Promise((r) => setTimeout(r, 1500));
    const screen = await execa('cmux', ['read-screen', '--workspace', ws!.ref]);
    expect(screen.stdout).toMatch(/GHWT_PRE_OK/);
    expect(screen.stdout).toMatch(/GHWT_PANE_OK/);

    await mgr.killSession(sessionName);
    expect(await mgr.sessionExists(sessionName)).toBe(false);
    createdRefs.pop(); // already closed
  }, 40000);
});
