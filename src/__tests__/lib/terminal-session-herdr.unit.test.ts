import { describe, it, expect, vi, beforeEach } from 'vitest';

// execa is mocked so no real herdr binary is invoked.
const execaMock = vi.fn();
vi.mock('execa', () => ({ execa: (...args: unknown[]) => execaMock(...args) }));

import {
  HerdrSessionManager,
  parseHerdrVersion,
  assertHerdrReady,
} from '../../lib/terminal-session-herdr.js';
import { SessionConfig } from '../../lib/terminal-session-base.js';

type Call = [string, string[]];

function calls(): Call[] {
  return execaMock.mock.calls.map((c) => [c[0] as string, c[1] as string[]]);
}

function herdrCalls(): string[][] {
  return calls()
    .filter(([bin]) => bin === 'herdr')
    .map(([, args]) => args);
}

/** herdr's envelope shapes, validated against herdr 0.5.10 (server protocol 6). */
function ok(result: unknown): { stdout: string; exitCode: number } {
  return { stdout: JSON.stringify({ id: 'cli:x', result }), exitCode: 0 };
}

let workspaces: Array<{ workspace_id: string; label?: string }> = [];

beforeEach(() => {
  execaMock.mockReset();
  workspaces = [];

  let paneN = 1;
  execaMock.mockImplementation(async (bin: string, args: string[]) => {
    if (bin !== 'herdr') return { stdout: '', exitCode: 0 };
    const [a0, a1] = args;
    if (a0 === '--version') return { stdout: 'herdr 0.5.10', exitCode: 0 };
    if (a0 === 'session' && a1 === 'list') {
      return {
        stdout: JSON.stringify({ sessions: [{ default: true, name: 'default', running: true }] }),
        exitCode: 0,
      };
    }
    if (a0 === 'workspace' && a1 === 'list') {
      return ok({ type: 'workspace_list', workspaces });
    }
    if (a0 === 'workspace' && a1 === 'create') {
      return ok({
        type: 'workspace_created',
        workspace: { workspace_id: 'w1', label: args[args.indexOf('--label') + 1] },
        root_pane: { pane_id: 'w1-1' },
      });
    }
    if (a0 === 'pane' && a1 === 'split') {
      paneN += 1;
      return ok({ type: 'pane_info', pane: { pane_id: `w1-${paneN}` } });
    }
    if (a0 === 'pane' && a1 === 'run') return { stdout: '', exitCode: 0 };
    if (a0 === 'workspace' && (a1 === 'close' || a1 === 'focus')) {
      return ok({ type: 'ok' });
    }
    return { stdout: '', exitCode: 0 };
  });
});

describe('HerdrSessionManager.createSession', () => {
  it('emits ordered herdr calls: workspace create(label), reuse root pane, run cascade, split', async () => {
    const mgr = new HerdrSessionManager();
    const config: SessionConfig = {
      name: 'sample',
      pre: ['nvm use'],
      windows: [{ name: 'editor', panes: ['vim', 'npm test'] }, { name: 'shell' }],
    };

    await mgr.createSession('proj-branch', config, '/wt', 'proj', 'branch');

    expect(herdrCalls()).toEqual([
      // sessionExists pre-check
      ['workspace', 'list'],
      ['workspace', 'create', '--cwd', '/wt', '--label', 'ghwt:proj-branch', '--no-focus'],
      // editor pane 0 reuses the root pane (w1-1); cwd == worktree so no cd
      ['pane', 'run', 'w1-1', 'nvm use'],
      ['pane', 'run', 'w1-1', 'vim'],
      // editor pane 1 -> split off the previous pane, cascade re-runs
      ['pane', 'split', 'w1-1', '--direction', 'right', '--cwd', '/wt', '--no-focus'],
      ['pane', 'run', 'w1-2', 'nvm use'],
      ['pane', 'run', 'w1-2', 'npm test'],
      // window "shell" -> split off the previous pane, cascade, no command
      ['pane', 'split', 'w1-2', '--direction', 'right', '--cwd', '/wt', '--no-focus'],
      ['pane', 'run', 'w1-3', 'nvm use'],
    ]);
  });

  it('cd the root pane only when the window root differs from the worktree path', async () => {
    const mgr = new HerdrSessionManager();
    const config: SessionConfig = {
      name: 'sample',
      windows: [{ name: 'srv', root: 'server', panes: ['npm start'] }],
    };

    await mgr.createSession('p-b', config, '/wt', 'p', 'b');

    const runs = herdrCalls().filter((a) => a[0] === 'pane' && a[1] === 'run');
    expect(runs).toEqual([
      ['pane', 'run', 'w1-1', 'cd /wt/server'],
      ['pane', 'run', 'w1-1', 'npm start'],
    ]);
  });

  it('split panes get their cwd via --cwd, not a cd command', async () => {
    const mgr = new HerdrSessionManager();
    const config: SessionConfig = {
      name: 's',
      windows: [{ name: 'w', root: 'sub', panes: ['a', 'b'] }],
    };

    await mgr.createSession('p-b', config, '/wt', 'p', 'b');

    const c = herdrCalls();
    expect(c).toContainEqual([
      'pane',
      'split',
      'w1-1',
      '--direction',
      'right',
      '--cwd',
      '/wt/sub',
      '--no-focus',
    ]);
    // The split pane's command runs directly - no `cd` for it.
    expect(c).toContainEqual(['pane', 'run', 'w1-2', 'b']);
    expect(c).not.toContainEqual(['pane', 'run', 'w1-2', 'cd /wt/sub']);
  });

  it('skips creation when the workspace already exists', async () => {
    workspaces = [{ workspace_id: 'w9', label: 'ghwt:p-b' }];
    const mgr = new HerdrSessionManager();

    await mgr.createSession('p-b', { name: 's', windows: [{ name: 'w' }] }, '/wt', 'p', 'b');

    expect(herdrCalls()).toEqual([['workspace', 'list']]);
  });
});

describe('HerdrSessionManager.sessionExists', () => {
  it('matches by ghwt-stamped label and returns true', async () => {
    workspaces = [
      { workspace_id: 'w2', label: 'ghwt:proj-branch' },
      { workspace_id: 'w3', label: 'something-else' },
    ];
    const mgr = new HerdrSessionManager();
    expect(await mgr.sessionExists('proj-branch')).toBe(true);
  });

  it('returns false when no label matches', async () => {
    workspaces = [{ workspace_id: 'w2', label: 'ghwt:other' }];
    const mgr = new HerdrSessionManager();
    expect(await mgr.sessionExists('proj-branch')).toBe(false);
  });

  it('throws on ambiguous multi-label match (never guesses)', async () => {
    workspaces = [
      { workspace_id: 'w2', label: 'ghwt:proj-branch' },
      { workspace_id: 'w5', label: 'ghwt:proj-branch' },
    ];
    const mgr = new HerdrSessionManager();
    await expect(mgr.sessionExists('proj-branch')).rejects.toThrow(/Ambiguous herdr workspace/);
  });
});

describe('HerdrSessionManager.killSession', () => {
  it('resolves the id then closes the workspace', async () => {
    workspaces = [{ workspace_id: 'w7', label: 'ghwt:p-b' }];
    const mgr = new HerdrSessionManager();

    await mgr.killSession('p-b');

    expect(herdrCalls()).toContainEqual(['workspace', 'close', 'w7']);
  });

  it('is a no-op when the workspace is absent', async () => {
    const mgr = new HerdrSessionManager();
    await mgr.killSession('p-b');
    expect(herdrCalls()).toEqual([['workspace', 'list']]);
  });

  it('does not omit a notify method (herdr has no external notify trigger)', () => {
    const mgr = new HerdrSessionManager();
    expect((mgr as unknown as { notify?: unknown }).notify).toBeUndefined();
  });
});

describe('HerdrSessionManager.agentStatuses', () => {
  function mockAgents(
    wss: Array<{ workspace_id: string; label?: string }>,
    agents: Array<{ agent_status: string; workspace_id: string }>,
  ) {
    execaMock.mockImplementation(async (bin: string, args: string[]) => {
      if (bin !== 'herdr') return { stdout: '', exitCode: 0 };
      if (args[0] === 'workspace' && args[1] === 'list') {
        return ok({ type: 'workspace_list', workspaces: wss });
      }
      if (args[0] === 'agent' && args[1] === 'list') {
        return ok({ type: 'agent_list', agents });
      }
      return { stdout: '', exitCode: 0 };
    });
  }

  async function statuses() {
    const map = await new HerdrSessionManager().agentStatuses();
    expect(map, 'success should return a Map, not null').not.toBeNull();
    return map!;
  }

  it('joins agent.workspace_id -> ghwt label -> session name', async () => {
    mockAgents(
      [{ workspace_id: 'wA', label: 'ghwt:proj-branch' }],
      [{ agent_status: 'blocked', workspace_id: 'wA' }],
    );
    const map = await statuses();
    expect(map.get('proj-branch')).toBe('blocked');
    expect(map.size).toBe(1);
  });

  it('rolls up to the most-urgent status when a session has multiple agents', async () => {
    mockAgents(
      [{ workspace_id: 'wA', label: 'ghwt:p-b' }],
      [
        { agent_status: 'working', workspace_id: 'wA' },
        { agent_status: 'blocked', workspace_id: 'wA' },
        { agent_status: 'idle', workspace_id: 'wA' },
      ],
    );
    expect((await statuses()).get('p-b')).toBe('blocked');
  });

  it('ignores agents in non-ghwt (unprefixed/user-created) workspaces', async () => {
    mockAgents(
      [
        { workspace_id: 'wA', label: 'ghwt:mine' },
        { workspace_id: 'wB', label: 'cmux_integration' },
      ],
      [
        { agent_status: 'working', workspace_id: 'wA' },
        { agent_status: 'blocked', workspace_id: 'wB' },
      ],
    );
    const map = await statuses();
    expect(map.get('mine')).toBe('working');
    expect(map.has('cmux_integration')).toBe(false);
    expect(map.size).toBe(1);
  });

  it('normalizes unrecognized statuses to "unknown"', async () => {
    mockAgents(
      [{ workspace_id: 'wA', label: 'ghwt:p-b' }],
      [{ agent_status: 'starting', workspace_id: 'wA' }],
    );
    expect((await statuses()).get('p-b')).toBe('unknown');
  });

  it('keeps the documented `done` state (herdr emits it despite enum docs)', async () => {
    mockAgents(
      [{ workspace_id: 'wA', label: 'ghwt:p-b' }],
      [{ agent_status: 'done', workspace_id: 'wA' }],
    );
    expect((await statuses()).get('p-b')).toBe('done');
  });

  it('success with no live agents returns an empty Map (NOT null) so sync clears stale state', async () => {
    mockAgents([{ workspace_id: 'wA', label: 'ghwt:p-b' }], []);
    const map = await statuses();
    expect(map.size).toBe(0);
  });

  it('returns null on herdr failure so sync leaves agent_status untouched (no mass-wipe)', async () => {
    execaMock.mockImplementation(async (bin: string, args: string[]) => {
      if (bin !== 'herdr') return { stdout: '', exitCode: 0 };
      if (args[0] === 'agent' && args[1] === 'list') {
        return {
          stdout: JSON.stringify({ error: { code: 'server_error', message: 'boom' } }),
          exitCode: 1,
        };
      }
      return { stdout: '', exitCode: 0 };
    });
    expect(await new HerdrSessionManager().agentStatuses()).toBeNull();
  });
});

describe('hardened herdr exec (reliable exit codes + structured errors)', () => {
  it('createSession throws on a herdr {"error":...} envelope (no silent misroute)', async () => {
    execaMock.mockImplementation(async (bin: string, args: string[]) => {
      if (bin !== 'herdr') return { stdout: '', exitCode: 0 };
      if (args[0] === 'workspace' && args[1] === 'list') {
        return { stdout: JSON.stringify({ result: { workspaces: [] } }), exitCode: 0 };
      }
      if (args[0] === 'workspace' && args[1] === 'create') {
        return {
          stdout: JSON.stringify({ error: { code: 'invalid_params', message: 'bad cwd' } }),
          exitCode: 1,
        };
      }
      return { stdout: '', exitCode: 0 };
    });
    const mgr = new HerdrSessionManager();
    await expect(
      mgr.createSession(
        'p-b',
        { name: 's', windows: [{ name: 'w', panes: ['ls'] }] },
        '/wt',
        'p',
        'b',
      ),
    ).rejects.toThrow(/invalid_params: bad cwd/);
    expect(herdrCalls().some((a) => a[0] === 'pane' && a[1] === 'run')).toBe(false);
  });

  it('createSession throws on a non-zero exit even without an error envelope', async () => {
    execaMock.mockImplementation(async (bin: string, args: string[]) => {
      if (bin !== 'herdr') return { stdout: '', exitCode: 0 };
      if (args[0] === 'workspace' && args[1] === 'list') {
        return { stdout: JSON.stringify({ result: { workspaces: [] } }), exitCode: 0 };
      }
      if (args[0] === 'workspace' && args[1] === 'create') {
        return { stdout: '', exitCode: 2 };
      }
      return { stdout: '', exitCode: 0 };
    });
    const mgr = new HerdrSessionManager();
    await expect(
      mgr.createSession('p-b', { name: 's', windows: [{ name: 'w' }] }, '/wt', 'p', 'b'),
    ).rejects.toThrow(/herdr workspace failed/);
  });
});

describe('assertHerdrReady', () => {
  it('throws an install message when herdr is not installed', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === '--version') throw new Error('spawn herdr ENOENT');
      return { stdout: '', exitCode: 0 };
    });
    await expect(assertHerdrReady()).rejects.toThrow(/install\.sh/);
  });

  it('throws an actionable message when the server is not running', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: 'herdr 0.5.10', exitCode: 0 };
      if (args[0] === 'session' && args[1] === 'list') {
        return {
          stdout: JSON.stringify({ sessions: [{ default: true, running: false }] }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 0 };
    });
    await expect(assertHerdrReady()).rejects.toThrow(/server is not running/);
  });

  it('throws when the version is below the floor', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: 'herdr 0.4.0', exitCode: 0 };
      if (args[0] === 'session' && args[1] === 'list') {
        return {
          stdout: JSON.stringify({ sessions: [{ default: true, running: true }] }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 0 };
    });
    await expect(assertHerdrReady()).rejects.toThrow(/too old/);
  });

  it('accepts an unparseable version once the server is proven up', async () => {
    execaMock.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: 'herdr dev-build', exitCode: 0 };
      if (args[0] === 'session' && args[1] === 'list') {
        return {
          stdout: JSON.stringify({ sessions: [{ default: true, running: true }] }),
          exitCode: 0,
        };
      }
      return { stdout: '', exitCode: 0 };
    });
    await expect(assertHerdrReady()).resolves.toBeUndefined();
  });
});

describe('parseHerdrVersion', () => {
  it('parses a plain version', () => {
    expect(parseHerdrVersion('herdr 0.5.10')).toEqual([0, 5, 10]);
  });
  it('returns null when unparseable', () => {
    expect(parseHerdrVersion('dev-build')).toBeNull();
  });
});
