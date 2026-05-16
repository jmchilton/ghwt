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

  let surfaceN = 0;
  execaMock.mockImplementation(async (_bin: string, args: string[]) => {
    const sub = args[0];
    if (sub === 'list-workspaces') return { stdout: workspacesJson };
    if (sub === 'new-workspace') return { stdout: 'OK workspace:1' };
    if (sub === 'new-surface' || sub === 'new-split') {
      surfaceN += 1;
      return { stdout: `OK surface:${surfaceN}` };
    }
    if (sub === 'version') return { stdout: 'cmux 0.64.1' };
    return { stdout: '' };
  });
});

describe('CmuxSessionManager.createSession', () => {
  it('emits ordered cmux calls: workspace, rename(title), surface, send cascade, split', async () => {
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
      // window "editor" -> new surface (no initial surface ref returned)
      ['new-surface', '--workspace', 'workspace:1', '--json'],
      ['send', 'nvm use\n', '--surface', 'surface:1'],
      ['send', 'vim\n', '--surface', 'surface:1'],
      // pane 2 -> split off the window surface
      ['new-split', 'right', '--surface', 'surface:1', '--json'],
      ['send', 'nvm use\n', '--surface', 'surface:2'],
      ['send', 'npm test\n', '--surface', 'surface:2'],
      // window "shell" -> new surface, no command
      ['new-surface', '--workspace', 'workspace:1', '--json'],
      ['send', 'nvm use\n', '--surface', 'surface:3'],
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
      ['send', 'cd /wt/server\n', '--surface', 'surface:1'],
      ['send', 'npm start\n', '--surface', 'surface:1'],
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

describe('createSession initial-surface reuse (new-workspace returns a surface)', () => {
  it('reuses the workspace initial surface for window 0, allocates fresh after', async () => {
    let surfaceN = 0;
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      const sub = args[0];
      if (sub === 'list-workspaces') return { stdout: '[]' };
      // new-workspace surfaces the initial surface ref alongside the workspace.
      if (sub === 'new-workspace') return { stdout: 'OK workspace:1 surface:1' };
      if (sub === 'new-surface' || sub === 'new-split') {
        surfaceN += 1;
        return { stdout: `OK surface:${100 + surfaceN}` };
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
    // Window 0 reuses surface:1 (the initial surface) - no new-surface for it.
    expect(c).toContainEqual(['send', 'echo a\n', '--surface', 'surface:1']);
    // Window 1 allocates a fresh surface (first new-surface call).
    const newSurfaceCalls = c.filter((a) => a[0] === 'new-surface');
    expect(newSurfaceCalls).toEqual([['new-surface', '--workspace', 'workspace:1', '--json']]);
    expect(c).toContainEqual(['send', 'echo b\n', '--surface', 'surface:101']);
  });

  it('parses --json surface_ref form (not just OK text)', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      const sub = args[0];
      if (sub === 'list-workspaces') return { stdout: '[]' };
      if (sub === 'new-workspace')
        return { stdout: JSON.stringify({ workspace_ref: 'workspace:4' }) };
      if (sub === 'new-surface') return { stdout: JSON.stringify({ surface_ref: 'surface:9' }) };
      return { stdout: '' };
    });

    const mgr = new CmuxSessionManager();
    await mgr.createSession(
      'p-b',
      { name: 's', windows: [{ name: 'w', panes: ['ls'] }] },
      '/wt',
      'p',
      'b',
    );

    const c = cmuxCalls();
    expect(c).toContainEqual(['rename-workspace', '--workspace', 'workspace:4', 'ghwt:p-b']);
    expect(c).toContainEqual(['new-surface', '--workspace', 'workspace:4', '--json']);
    expect(c).toContainEqual(['send', 'ls\n', '--surface', 'surface:9']);
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
