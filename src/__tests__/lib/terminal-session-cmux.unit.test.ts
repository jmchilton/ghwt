import { describe, it, expect, vi, beforeEach } from 'vitest';

// execa is mocked so no real cmux binary is invoked.
const execaMock = vi.fn();
vi.mock('execa', () => ({ execa: (...args: unknown[]) => execaMock(...args) }));

import {
  CmuxSessionManager,
  parseCmuxVersion,
  assertCmuxReady,
} from '../../lib/terminal-session-cmux.js';
import { SessionConfig } from '../../lib/terminal-session-base.js';

type Call = [string, string[]];

function calls(): Call[] {
  return execaMock.mock.calls.map((c) => [c[0] as string, c[1] as string[]]);
}

function cmuxCalls(): string[][] {
  return calls()
    .filter(([bin]) => bin === 'cmux')
    .map(([, args]) => args);
}

/**
 * Default mock: empty workspace list, sequential surface refs.
 * Tests override list-workspaces output via `workspacesJson`.
 */
let workspacesJson = '[]';

beforeEach(() => {
  execaMock.mockReset();
  workspacesJson = '[]';
  process.env.GHWT_CMUX_SURFACE_DELAY_MS = '0';

  // Pane model: a workspace is created with one initial pane (pane:1);
  // each additional ghwt pane is a new-split that returns a fresh pane ref.
  let paneN = 1;
  execaMock.mockImplementation(async (_bin: string, args: string[]) => {
    const sub = args[0];
    if (sub === 'list-workspaces') return { stdout: workspacesJson };
    if (sub === 'new-workspace') return { stdout: 'OK workspace:1' };
    if (sub === 'list-panes') {
      return { stdout: JSON.stringify({ panes: [{ ref: 'pane:1', index: 0, focused: true }] }) };
    }
    if (sub === 'new-split') {
      paneN += 1;
      return { stdout: JSON.stringify({ pane_ref: `pane:${paneN}` }) };
    }
    if (sub === 'version') return { stdout: 'cmux 0.64.1' };
    return { stdout: '' };
  });
});

describe('CmuxSessionManager.createSession', () => {
  it('emits ordered cmux calls: workspace, rename(title), initial pane, focus+send cascade, split', async () => {
    const mgr = new CmuxSessionManager();
    const config: SessionConfig = {
      name: 'sample',
      pre: ['nvm use'],
      windows: [{ name: 'editor', panes: ['vim', 'npm test'] }, { name: 'shell' }],
    };

    await mgr.createSession('proj-branch', config, '/wt', 'proj', 'branch');

    expect(cmuxCalls()).toEqual([
      // sessionExists pre-check
      ['list-workspaces', '--json'],
      ['new-workspace', '--cwd', '/wt', '--json'],
      ['rename-workspace', '--workspace', 'workspace:1', 'ghwt:proj-branch'],
      // initial pane discovered from the freshly created workspace
      ['list-panes', '--workspace', 'workspace:1', '--json'],
      // editor pane 0 reuses the initial pane; send addressed by --workspace
      // (send --surface is rejected by cmux even for live surfaces)
      ['focus-pane', '--pane', 'pane:1', '--workspace', 'workspace:1'],
      ['send', 'nvm use\n', '--workspace', 'workspace:1'],
      ['send', 'vim\n', '--workspace', 'workspace:1'],
      // editor pane 1 -> split (new pane), focus, cascade
      ['new-split', 'right', '--workspace', 'workspace:1', '--json'],
      ['focus-pane', '--pane', 'pane:2', '--workspace', 'workspace:1'],
      ['send', 'nvm use\n', '--workspace', 'workspace:1'],
      ['send', 'npm test\n', '--workspace', 'workspace:1'],
      // window "shell" -> split (new pane), focus, cascade, no command
      ['new-split', 'right', '--workspace', 'workspace:1', '--json'],
      ['focus-pane', '--pane', 'pane:3', '--workspace', 'workspace:1'],
      ['send', 'nvm use\n', '--workspace', 'workspace:1'],
    ]);
  });

  it('cd into window root only when it differs from worktree path', async () => {
    const mgr = new CmuxSessionManager();
    const config: SessionConfig = {
      name: 'sample',
      windows: [{ name: 'srv', root: 'server', panes: ['npm start'] }],
    };

    await mgr.createSession('p-b', config, '/wt', 'p', 'b');

    const sends = cmuxCalls().filter((a) => a[0] === 'send');
    expect(sends).toEqual([
      ['send', 'cd /wt/server\n', '--workspace', 'workspace:1'],
      ['send', 'npm start\n', '--workspace', 'workspace:1'],
    ]);
  });

  it('skips creation when the workspace already exists', async () => {
    workspacesJson = JSON.stringify([{ ref: 'workspace:9', title: 'ghwt:p-b' }]);
    const mgr = new CmuxSessionManager();

    await mgr.createSession('p-b', { name: 's', windows: [{ name: 'w' }] }, '/wt', 'p', 'b');

    expect(cmuxCalls()).toEqual([['list-workspaces', '--json']]);
  });
});

describe('CmuxSessionManager.sessionExists', () => {
  it('matches by ghwt-stamped title and returns true', async () => {
    workspacesJson = JSON.stringify([
      { ref: 'workspace:2', title: 'ghwt:proj-branch', selected: false },
      { ref: 'workspace:3', title: 'something-else' },
    ]);
    const mgr = new CmuxSessionManager();
    expect(await mgr.sessionExists('proj-branch')).toBe(true);
  });

  it('returns false when no title matches', async () => {
    workspacesJson = JSON.stringify([{ ref: 'workspace:2', title: 'ghwt:other' }]);
    const mgr = new CmuxSessionManager();
    expect(await mgr.sessionExists('proj-branch')).toBe(false);
  });

  it('throws on ambiguous multi-title match (never guesses)', async () => {
    workspacesJson = JSON.stringify([
      { ref: 'workspace:2', title: 'ghwt:proj-branch' },
      { ref: 'workspace:5', title: 'ghwt:proj-branch' },
    ]);
    const mgr = new CmuxSessionManager();
    await expect(mgr.sessionExists('proj-branch')).rejects.toThrow(/Ambiguous cmux workspace/);
  });
});

describe('CmuxSessionManager attach/kill resolve ref then map to cmux verbs', () => {
  it('attachToSession ensures app then select-workspace by ref', async () => {
    workspacesJson = JSON.stringify([{ ref: 'workspace:7', title: 'ghwt:p-b' }]);
    const mgr = new CmuxSessionManager();

    await mgr.attachToSession('p-b', '/wt');

    const c = cmuxCalls();
    expect(c).toContainEqual(['ping']);
    expect(c).toContainEqual(['select-workspace', '--workspace', 'workspace:7']);
  });

  it('killSession resolves ref then close-workspace', async () => {
    workspacesJson = JSON.stringify([{ ref: 'workspace:7', title: 'ghwt:p-b' }]);
    const mgr = new CmuxSessionManager();

    await mgr.killSession('p-b');

    expect(cmuxCalls()).toContainEqual(['close-workspace', '--workspace', 'workspace:7']);
  });

  it('killSession is a no-op when the workspace is absent', async () => {
    const mgr = new CmuxSessionManager();
    await mgr.killSession('p-b');
    expect(cmuxCalls()).toEqual([['list-workspaces', '--json']]);
  });

  it('notify rings the resolved workspace with a title', async () => {
    workspacesJson = JSON.stringify([{ ref: 'workspace:7', title: 'ghwt:p-b' }]);
    const mgr = new CmuxSessionManager();

    await mgr.notify('p-b', 'ghwt', 'needs attention');

    expect(cmuxCalls()).toContainEqual([
      'notify',
      '--title',
      'ghwt',
      '--subtitle',
      'needs attention',
      '--workspace',
      'workspace:7',
    ]);
  });
});

describe('createSession pane model (initial pane reuse + split + parsing)', () => {
  it('reuses the workspace initial pane for window 0, splits a fresh pane after', async () => {
    let paneN = 0;
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      const sub = args[0];
      if (sub === 'list-workspaces') return { stdout: '[]' };
      if (sub === 'new-workspace') return { stdout: 'OK workspace:1' };
      if (sub === 'list-panes') {
        return { stdout: JSON.stringify({ panes: [{ ref: 'pane:1', index: 0 }] }) };
      }
      if (sub === 'new-split') {
        paneN += 1;
        return { stdout: JSON.stringify({ pane_ref: `pane:${100 + paneN}` }) };
      }
      return { stdout: '' };
    });

    const mgr = new CmuxSessionManager();
    const config: SessionConfig = {
      name: 's',
      windows: [
        { name: 'a', panes: ['echo a'] },
        { name: 'b', panes: ['echo b'] },
      ],
    };
    await mgr.createSession('p-b', config, '/wt', 'p', 'b');

    const c = cmuxCalls();
    // Window 0 reuses the initial pane:1 - no new-split for it.
    expect(c).toContainEqual(['focus-pane', '--pane', 'pane:1', '--workspace', 'workspace:1']);
    expect(c).toContainEqual(['send', 'echo a\n', '--workspace', 'workspace:1']);
    // Window 1 splits a fresh pane (first and only new-split call).
    const splitCalls = c.filter((a) => a[0] === 'new-split');
    expect(splitCalls).toEqual([['new-split', 'right', '--workspace', 'workspace:1', '--json']]);
    expect(c).toContainEqual(['focus-pane', '--pane', 'pane:101', '--workspace', 'workspace:1']);
    expect(c).toContainEqual(['send', 'echo b\n', '--workspace', 'workspace:1']);
  });

  it('parses --json ref forms for new-workspace and new-split (not just OK text)', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      const sub = args[0];
      if (sub === 'list-workspaces') return { stdout: '[]' };
      if (sub === 'new-workspace')
        return { stdout: JSON.stringify({ workspace_ref: 'workspace:4' }) };
      if (sub === 'list-panes') {
        return { stdout: JSON.stringify({ panes: [{ ref: 'pane:7' }] }) };
      }
      if (sub === 'new-split') return { stdout: JSON.stringify({ pane_ref: 'pane:9' }) };
      return { stdout: '' };
    });

    const mgr = new CmuxSessionManager();
    await mgr.createSession(
      'p-b',
      {
        name: 's',
        windows: [{ name: 'w', panes: ['ls'] }, { name: 'x' }],
      },
      '/wt',
      'p',
      'b',
    );

    const c = cmuxCalls();
    expect(c).toContainEqual(['rename-workspace', '--workspace', 'workspace:4', 'ghwt:p-b']);
    expect(c).toContainEqual(['list-panes', '--workspace', 'workspace:4', '--json']);
    // window 0 reuses initial pane:7; window 1 splits -> pane:9 (json pane_ref)
    expect(c).toContainEqual(['focus-pane', '--pane', 'pane:7', '--workspace', 'workspace:4']);
    expect(c).toContainEqual(['send', 'ls\n', '--workspace', 'workspace:4']);
    expect(c).toContainEqual(['focus-pane', '--pane', 'pane:9', '--workspace', 'workspace:4']);
  });
});

describe('assertCmuxReady', () => {
  it('throws a macOS-only message when ping fails', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === 'ping') throw new Error('ECONNREFUSED');
      return { stdout: '' };
    });
    await expect(assertCmuxReady()).rejects.toThrow(/macOS-only/);
  });

  it('throws when the version is below the floor', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === 'ping') return { stdout: 'pong' };
      if (args[0] === 'version') return { stdout: 'cmux 0.62.9' };
      return { stdout: '' };
    });
    await expect(assertCmuxReady()).rejects.toThrow(/too old/);
  });

  it('accepts an unparseable version (presence already confirmed by ping)', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === 'ping') return { stdout: 'pong' };
      if (args[0] === 'version') return { stdout: 'cmux dev-build' };
      return { stdout: '' };
    });
    await expect(assertCmuxReady()).resolves.toBeUndefined();
  });

  it('does not hard-block when `cmux version` itself fails', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === 'ping') return { stdout: 'pong' };
      if (args[0] === 'version') throw new Error('unknown subcommand');
      return { stdout: '' };
    });
    await expect(assertCmuxReady()).resolves.toBeUndefined();
  });
});

describe('hardened cmux exec (cmux exits 0 on errors; stale refs misroute)', () => {
  it('assertCmuxReady: broken-pipe auth refusal -> actionable #1864 message, not "install"', async () => {
    execaMock.mockImplementation(async (_b: string, args: string[]) => {
      if (args[0] === 'ping') {
        return { stdout: '', stderr: 'Error: Failed to write to socket (Broken pipe, errno 32)' };
      }
      return { stdout: '' };
    });
    await expect(assertCmuxReady()).rejects.toThrow(/refusing external CLI access/);
    await expect(assertCmuxReady()).rejects.toThrow(/cmux#1864/);
  });

  it('assertCmuxReady: "Access denied" classified as auth refusal (not unreachable)', async () => {
    execaMock.mockImplementation(async (_b: string, args: string[]) => {
      if (args[0] === 'ping') {
        return { stdout: 'ERROR: Access denied — only processes started inside cmux can connect' };
      }
      return { stdout: '' };
    });
    await expect(assertCmuxReady()).rejects.toThrow(/refusing external CLI access/);
  });

  it('createSession: aborts when a fresh workspace reports no panes (misroute guard)', async () => {
    execaMock.mockImplementation(async (_b: string, args: string[]) => {
      const sub = args[0];
      if (sub === 'list-workspaces') return { stdout: '[]' };
      if (sub === 'new-workspace') return { stdout: 'OK workspace:1' };
      if (sub === 'list-panes') return { stdout: JSON.stringify({ panes: [] }) };
      return { stdout: '' };
    });
    const mgr = new CmuxSessionManager();
    await expect(
      mgr.createSession(
        'p-b',
        { name: 's', windows: [{ name: 'w', panes: ['ls'] }] },
        '/wt',
        'p',
        'b',
      ),
    ).rejects.toThrow(/no panes|wrong workspace/);
    // The guard must fire before any send could misroute.
    expect(cmuxCalls().filter((a) => a[0] === 'send')).toEqual([]);
  });

  it('createSession: focus-pane "not_found" (exit 0) aborts instead of misrouting the send', async () => {
    execaMock.mockImplementation(async (_b: string, args: string[]) => {
      const sub = args[0];
      if (sub === 'list-workspaces') return { stdout: '[]' };
      if (sub === 'new-workspace') return { stdout: 'OK workspace:1' };
      if (sub === 'list-panes') return { stdout: JSON.stringify({ panes: [{ ref: 'pane:1' }] }) };
      // cmux returns errors on stdout with exit code 0:
      if (sub === 'focus-pane') return { stdout: 'Error: not_found: Pane not found' };
      return { stdout: '' };
    });
    const mgr = new CmuxSessionManager();
    await expect(
      mgr.createSession(
        'p-b',
        { name: 's', windows: [{ name: 'w', panes: ['ls'] }] },
        '/wt',
        'p',
        'b',
      ),
    ).rejects.toThrow(/focus-pane failed|not_found/);
    // Critical safety property: no command was sent anywhere.
    expect(cmuxCalls().filter((a) => a[0] === 'send')).toEqual([]);
  });
});

describe('parseCmuxVersion', () => {
  it('parses a plain version', () => {
    expect(parseCmuxVersion('cmux 0.64.1')).toEqual([0, 64, 1]);
  });
  it('strips a commit/build suffix', () => {
    expect(parseCmuxVersion('0.63.0+abc1234')).toEqual([0, 63, 0]);
  });
  it('returns null when unparseable', () => {
    expect(parseCmuxVersion('unknown')).toBeNull();
  });
});
