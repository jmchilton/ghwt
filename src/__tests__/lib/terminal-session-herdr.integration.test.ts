import { describe, it, expect, afterAll } from 'vitest';
import { execa } from 'execa';
import { HerdrSessionManager } from '../../lib/terminal-session-herdr.js';
import type { SessionConfig } from '../../lib/terminal-session-base.js';

/**
 * Real-herdr integration test (herdr installed + background server running).
 *
 * The cmux backend's history (its mocked unit contract did not survive contact
 * with real cmux) is the reason this exists: it drives the actual `herdr`
 * binary end to end - create a labelled workspace, verify the pre/pane cascade
 * really executed via `pane read`, then tear down.
 *
 * Self-gating: skipped unless the platform is linux/darwin AND `herdr session
 * list` reports a running default session. Mirrors how the cmux integration
 * test stays green when the resource is absent.
 */

async function herdrReachable(): Promise<boolean> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return false;
  try {
    const r = await execa('herdr', ['session', 'list', '--json'], { reject: false });
    if ((r.exitCode ?? 1) !== 0) return false;
    const parsed = JSON.parse(r.stdout ?? '{}') as {
      sessions?: Array<{ default?: boolean; running?: boolean }>;
    };
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const def = sessions.find((s) => s.default) ?? sessions[0];
    return def?.running === true;
  } catch {
    return false;
  }
}

describe('herdr integration (real herdr, server running)', () => {
  const createdIds: string[] = [];

  // Close every workspace any test registered. Idempotent (reject:false), so
  // a test that already tore its own down needs no fragile bookkeeping - it
  // just leaves the id here and this double-close is a harmless no-op.
  afterAll(async () => {
    for (const id of createdIds) {
      await execa('herdr', ['workspace', 'close', id], { reject: false }).catch(() => {});
    }
  });

  it('createSession builds a ghwt-labelled workspace whose pane runs the cascade', async (ctx) => {
    if (!(await herdrReachable())) {
      ctx.skip(); // not linux/darwin / herdr absent / server down
      return;
    }
    const mgr = new HerdrSessionManager(undefined, false);
    const sessionName = `itest-${Date.now()}`;
    const config: SessionConfig = {
      name: 'itest',
      pre: ['echo GHWT_PRE_OK'],
      windows: [{ name: 'w', panes: ['echo GHWT_PANE_OK'] }],
    };

    await mgr.createSession(sessionName, config, process.cwd(), 'proj', 'branch');

    // Resolve the workspace herdr just created (for teardown + pane read).
    const wsList = await execa('herdr', ['workspace', 'list']);
    const ws = (
      JSON.parse(wsList.stdout).result.workspaces as Array<{
        workspace_id: string;
        label?: string;
      }>
    ).find((w) => w.label === `ghwt:${sessionName}`);
    expect(ws, 'ghwt-labelled workspace should exist after createSession').toBeTruthy();
    createdIds.push(ws!.workspace_id);

    expect(await mgr.sessionExists(sessionName)).toBe(true);

    // Find the workspace's pane, let the shell render, assert the cascade ran.
    const paneList = await execa('herdr', ['pane', 'list', '--workspace', ws!.workspace_id]);
    const paneId = (JSON.parse(paneList.stdout).result.panes as Array<{ pane_id: string }>)[0]
      .pane_id;

    await new Promise((r) => setTimeout(r, 2000));
    const screen = await execa('herdr', ['pane', 'read', paneId, '--source', 'recent']);
    expect(screen.stdout).toMatch(/GHWT_PRE_OK/);
    expect(screen.stdout).toMatch(/GHWT_PANE_OK/);

    await mgr.killSession(sessionName);
    expect(await mgr.sessionExists(sessionName)).toBe(false);
    // No createdIds bookkeeping: afterAll's close is idempotent (see above).
  }, 40000);
});
