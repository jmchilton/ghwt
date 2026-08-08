import { execa } from 'execa';
import { join } from 'path';
import { GhwtConfig } from '../types.js';
import {
  TerminalSessionManager,
  SessionConfig,
  TemplateVars,
  AttachOptions,
  AgentStatus,
  substituteVariables,
  normalizeSessionConfig,
  launchGhostty,
} from './terminal-session-base.js';

/**
 * herdr session backend (opt-in via terminalMultiplexer: 'herdr').
 *
 * Arms-length integration: this adapter shells out to the `herdr` binary only.
 * No linking, no socket parsing beyond herdr's documented JSON CLI output. All
 * herdr-specific behavior is quarantined here so the rest of ghwt stays
 * portable and MIT-clean. (herdr itself is AGPL-3.0; shelling out to a separate
 * binary via execa is not linking and does not affect ghwt's MIT license.)
 *
 * Why herdr is a much thinner adapter than the cmux one (validated against
 * herdr 0.5.10 on macOS, server protocol 6):
 *   - `workspace create` returns the workspace_id AND root pane_id directly,
 *     so there is no "no deterministic addressing -> stamp a title and resolve
 *     fresh every call" dance. We still resolve by label (a workspace is the
 *     per-worktree unit, same as cmux) but only because herdr ids are not
 *     stable across server restarts; the create path needs no round-trip.
 *   - `pane run <pane_id> <cmd>` executes a command in a specific pane: no
 *     missing --command flag, so NO shell-not-ready fixed-sleep race hack.
 *   - `pane split <pane_id> --direction right --cwd PATH` addresses a specific
 *     pane and sets its cwd: no focus-first hack, no per-pane re-`cd` hack.
 *   - herdr exits non-zero on failure AND emits {"error":{code,message}}: no
 *     "exit 0 on error, sniff stdout with regexes" hack.
 *   - The control socket is the documented interface for external agents, so
 *     there is no cmux-#1864-style "refuses processes it didn't spawn" wall.
 *
 * herdr is a TUI multiplexer (like tmux/zellij), not a fused GUI (like cmux):
 * session/workspace management is CLI-driven (cmux-like) but attaching is done
 * by running `herdr` in a terminal (tmux/zellij-like), so `terminalUI`
 * (wezterm/ghostty/none) IS honored here, unlike the cmux backend.
 *
 * herdr exposes no external notification trigger (no `herdr notify`; it detects
 * agent state itself and self-notifies), so this backend deliberately omits the
 * optional `notify` method - the sync notify bridge no-ops for herdr exactly as
 * it does for tmux/zellij. herdr's own per-pane agent-state detection is the
 * intended attention signal; wiring that into ghwt's needs-attention model is a
 * separate, follow-up integration.
 */

/**
 * Minimum supported herdr. herdr churns fast with breaking protocol bumps
 * between patch releases; this is the version this adapter was validated
 * against (server protocol 6). Unparseable version strings are accepted (the
 * session-list readiness probe already proves a compatible server is up).
 */
export const HERDR_MIN_VERSION = '0.5.10';

/** Label namespace so ghwt-managed workspaces don't collide with user-created ones. */
const LABEL_PREFIX = 'ghwt:';

/**
 * Roll-up urgency when a session has >1 agent: the most-urgent state wins.
 * 'blocked' (agent waiting on the human) is the one ghwt's needs-attention
 * model keys on, so it must rank highest.
 *
 * `done` is intentionally kept: herdr 0.5.10's `report-agent`/`agent wait`
 * enums document only idle|working|blocked|unknown, but real `herdr workspace
 * list` / `agent list` output was observed emitting `agent_status: "done"` at
 * runtime (probed against a live workspace). The enum docs are herdr's own
 * inconsistency - do not drop `done` to "match the docs"; it occurs.
 */
const STATUS_RANK: Record<AgentStatus, number> = {
  blocked: 4,
  working: 3,
  done: 2,
  idle: 1,
  unknown: 0,
};

function normalizeStatus(raw: unknown): AgentStatus {
  return raw === 'blocked' || raw === 'working' || raw === 'done' || raw === 'idle'
    ? raw
    : 'unknown';
}

interface HerdrWorkspace {
  workspace_id: string;
  label?: string;
  agent_status?: string;
}

async function herdrRaw(
  args: string[],
): Promise<{ stdout: string; exitCode: number; spawnFailed: boolean; combined: string }> {
  try {
    const r = await execa('herdr', args, { reject: false });
    const stdout = r.stdout ?? '';
    return {
      stdout,
      exitCode: r.exitCode ?? 0,
      spawnFailed: false,
      combined: `${stdout}\n${r.stderr ?? ''}`,
    };
  } catch (e) {
    // execa only rejects here on spawn failure (binary missing), not on a
    // non-zero exit (reject:false) - so this is "herdr not found".
    return {
      stdout: '',
      exitCode: -1,
      spawnFailed: true,
      combined: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Pull herdr's structured error message out of JSON output, if present.
 * herdr emits {"error":{"code":"...","message":"..."}} on failures.
 */
function herdrErrorMessage(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    const err = parsed?.error;
    if (err && typeof err === 'object') {
      const code = typeof err.code === 'string' ? err.code : '';
      const message = typeof err.message === 'string' ? err.message : '';
      return [code, message].filter(Boolean).join(': ') || JSON.stringify(err);
    }
  } catch {
    // Not JSON / no error envelope.
  }
  return null;
}

/**
 * Run a herdr command. Throws on spawn failure, non-zero exit, or a
 * {"error":...} envelope. herdr's exit codes are reliable (unlike cmux), so
 * this is a straightforward status + structured-error check - no regex
 * output sniffing.
 */
async function herdr(args: string[]): Promise<string> {
  const { stdout, exitCode, spawnFailed, combined } = await herdrRaw(args);
  if (spawnFailed) {
    throw new Error(`herdr not found / failed to spawn (\`herdr ${args[0]}\`): ${combined.trim()}`);
  }
  const errMsg = herdrErrorMessage(stdout);
  if (exitCode !== 0 || errMsg) {
    const detail = errMsg ?? (combined.trim() || `exit ${exitCode}`);
    throw new Error(`herdr ${args[0]} failed: ${detail}`);
  }
  return stdout;
}

/** Unwrap herdr's `{"id":...,"result":{...}}` envelope; throws if absent. */
function resultOf(stdout: string, context: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`herdr ${context}: expected JSON, got: ${stdout.trim().slice(0, 200)}`);
  }
  const result = (parsed as { result?: unknown })?.result;
  if (!result || typeof result !== 'object') {
    throw new Error(`herdr ${context}: missing "result" in: ${stdout.trim().slice(0, 200)}`);
  }
  return result as Record<string, unknown>;
}

/** Parse `herdr --version` ("herdr 0.5.10") into a comparable tuple. */
export function parseHerdrVersion(versionOutput: string): [number, number, number] | null {
  const match = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Probe herdr: binary present + the default session's background server is
 * running + version floor. herdr is client-server; every workspace/pane call
 * talks to that server's socket, so a down server must fail fast with an
 * actionable message (ghwt does not auto-spawn herdr's TUI server - the user
 * runs `herdr` themselves). Uses `herdr session list --json` (the `--json`
 * flag is required here: bare `session list` prints a human table, unlike
 * `workspace list` which is JSON by default - herdr's flag convention is
 * per-command and inconsistent).
 */
export async function assertHerdrReady(): Promise<void> {
  const version = await herdrRaw(['--version']);
  if (version.spawnFailed) {
    throw new Error(
      `herdr is not reachable (terminalMultiplexer: 'herdr').\n` +
        `   Install it (Linux/macOS): curl -fsSL https://herdr.dev/install.sh | sh`,
    );
  }

  const list = await herdrRaw(['session', 'list', '--json']);
  let serverRunning = false;
  if (!list.spawnFailed && list.exitCode === 0) {
    try {
      const parsed = JSON.parse(list.stdout.trim()) as {
        sessions?: Array<{ default?: boolean; running?: boolean }>;
      };
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      const def = sessions.find((s) => s.default) ?? sessions[0];
      serverRunning = def?.running === true;
    } catch {
      // Unparseable - treat as not running (handled below).
    }
  }
  if (!serverRunning) {
    throw new Error(
      `herdr is installed but its background server is not running ` +
        `(terminalMultiplexer: 'herdr').\n` +
        `   Start it by running \`herdr\` in a terminal once, then retry.`,
    );
  }

  // Comparison + throw outside any catch so a too-old failure can't be
  // swallowed. Unparseable version: server liveness already proven, accept it.
  const got = parseHerdrVersion(version.stdout);
  const min = parseHerdrVersion(HERDR_MIN_VERSION);
  if (got && min && compareVersions(got, min) < 0) {
    throw new Error(
      `herdr ${got.join('.')} is too old; ghwt needs >= ${HERDR_MIN_VERSION}. Run \`herdr update\`.`,
    );
  }
}

export class HerdrSessionManager implements TerminalSessionManager {
  constructor(
    private config?: GhwtConfig,
    private verbose = false,
  ) {}

  private workspaceLabel(sessionName: string): string {
    return `${LABEL_PREFIX}${sessionName}`;
  }

  private async listWorkspaces(): Promise<HerdrWorkspace[]> {
    try {
      const result = resultOf(await herdr(['workspace', 'list']), 'workspace list');
      const arr = result.workspaces;
      return Array.isArray(arr) ? (arr as HerdrWorkspace[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Resolve the workspace id for a session by matching the ghwt-stamped label.
   * herdr does not enforce label uniqueness - a multi-match is an error, never
   * a guess (ghwt's not-found -> recreate path absorbs a user-renamed dup).
   */
  private async resolveId(
    sessionName: string,
    workspaces?: HerdrWorkspace[],
  ): Promise<string | null> {
    const label = this.workspaceLabel(sessionName);
    const list = workspaces ?? (await this.listWorkspaces());
    const matches = list.filter((w) => w.label === label);
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous herdr workspace: ${matches.length} workspaces labelled "${label}". ` +
          `Rename or close the duplicates in herdr.`,
      );
    }
    return matches[0]?.workspace_id ?? null;
  }

  async sessionExists(sessionName: string, workspaces?: HerdrWorkspace[]): Promise<boolean> {
    return (await this.resolveId(sessionName, workspaces)) !== null;
  }

  /** Run one command line in a specific pane (herdr executes it in the shell). */
  private async runInPane(paneId: string, line: string): Promise<void> {
    if (this.verbose) {
      console.log(`  $ herdr pane run ${paneId} ${JSON.stringify(line)}`);
    }
    await herdr(['pane', 'run', paneId, line]);
  }

  /**
   * Create the workspace; returns its id and the initial (root) pane id, both
   * straight from herdr's `workspace_created` payload - no list round-trip.
   */
  private async newWorkspace(
    worktreePath: string,
    label: string,
  ): Promise<{ workspaceId: string; rootPaneId: string }> {
    const result = resultOf(
      await herdr(['workspace', 'create', '--cwd', worktreePath, '--label', label, '--no-focus']),
      'workspace create',
    );
    const workspace = result.workspace as { workspace_id?: string } | undefined;
    const rootPane = result.root_pane as { pane_id?: string } | undefined;
    const workspaceId = workspace?.workspace_id;
    const rootPaneId = rootPane?.pane_id;
    if (!workspaceId || !rootPaneId) {
      throw new Error(
        `herdr workspace create did not return workspace_id + root pane_id ` +
          `(got: ${JSON.stringify(result).slice(0, 200)})`,
      );
    }
    return { workspaceId, rootPaneId };
  }

  /** Split a specific pane; returns the NEW pane's id. */
  private async splitPane(paneId: string, cwd: string): Promise<string> {
    const result = resultOf(
      await herdr(['pane', 'split', paneId, '--direction', 'right', '--cwd', cwd, '--no-focus']),
      'pane split',
    );
    const pane = result.pane as { pane_id?: string } | undefined;
    if (!pane?.pane_id) {
      throw new Error(
        `herdr pane split did not return a pane id (got: ${JSON.stringify(result).slice(0, 200)})`,
      );
    }
    return pane.pane_id;
  }

  /**
   * Create a herdr workspace mirroring the cmux backend's control flow:
   * flatten tabs[].windows[].panes[] to a sequence of herdr panes in one
   * workspace. herdr has real tabs, but flattening keeps the two newest
   * backends consistent and matches the cmux precedent; window->tab mapping
   * is a possible later refinement. zellij_ui / start_suspended have no herdr
   * analog (ignored, like tmux/cmux).
   */
  async createSession(
    sessionName: string,
    config: SessionConfig,
    worktreePath: string,
    project: string,
    branch: string,
    notePath?: string,
  ): Promise<void> {
    if (await this.sessionExists(sessionName)) {
      console.log(`⚙️  herdr workspace already exists: ${this.workspaceLabel(sessionName)}`);
      return;
    }

    const vars: TemplateVars = {
      worktree_path: worktreePath,
      project,
      branch,
      note_path: notePath,
    };

    const normalizedConfig = normalizeSessionConfig(config);

    const { workspaceId, rootPaneId } = await this.newWorkspace(
      worktreePath,
      this.workspaceLabel(sessionName),
    );
    if (this.verbose) {
      console.log(`  herdr workspace ${workspaceId} (root pane ${rootPaneId})`);
    }

    // The workspace starts with one live pane; reuse it for the first ghwt
    // pane, then split off the previous pane for each subsequent one (chained,
    // same layout strategy as the cmux backend).
    let initialPane: string | null = rootPaneId;
    let lastPaneId = rootPaneId;

    for (const tab of normalizedConfig.tabs) {
      for (const window of tab.windows) {
        const windowRoot = window.root ? join(worktreePath, window.root) : worktreePath;
        const substitutedRoot = substituteVariables(windowRoot, vars);

        // Each ghwt pane (or a window with none) maps to one herdr pane.
        const panes = window.panes && window.panes.length > 0 ? window.panes : [undefined];

        for (let paneIndex = 0; paneIndex < panes.length; paneIndex++) {
          let paneId: string;
          if (initialPane) {
            paneId = initialPane;
            initialPane = null;
            // The root pane's cwd is the workspace cwd (worktreePath); only
            // re-cd it if this window wants a different root. Split panes get
            // their cwd via --cwd, so this is the one place a cd is needed.
            if (substitutedRoot !== worktreePath) {
              await this.runInPane(paneId, `cd ${substitutedRoot}`);
            }
          } else {
            paneId = await this.splitPane(lastPaneId, substitutedRoot);
          }
          lastPaneId = paneId;

          // Cascading pre-commands: session -> tab -> window -> pane command.
          for (const preCmd of normalizedConfig.pre || []) {
            await this.runInPane(paneId, substituteVariables(preCmd, vars));
          }
          for (const preCmd of tab.pre || []) {
            await this.runInPane(paneId, substituteVariables(preCmd, vars));
          }
          for (const preCmd of window.pre || []) {
            await this.runInPane(paneId, substituteVariables(preCmd, vars));
          }

          const cmd = panes[paneIndex];
          if (cmd) {
            await this.runInPane(paneId, substituteVariables(cmd, vars));
          }
        }
      }
    }
  }

  /** Focus the workspace so an attaching herdr client lands on it. Best-effort. */
  private async focusWorkspace(sessionName: string): Promise<void> {
    try {
      const id = await this.resolveId(sessionName);
      if (!id) return;
      if (this.verbose) {
        console.log(`  $ herdr workspace focus ${id}`);
      }
      await herdr(['workspace', 'focus', id]);
    } catch {
      // Focus is advisory - attaching still works without it.
    }
  }

  /**
   * Attach a herdr TUI client (optionally wrapped in wezterm/ghostty), with
   * the target workspace pre-focused. herdr is a TUI multiplexer, so this
   * mirrors the tmux/zellij launch flow rather than the cmux GUI flow.
   */
  async launchUI(sessionName: string, worktreePath: string): Promise<void> {
    await this.focusWorkspace(sessionName);
    const ui = this.config?.terminalUI || 'wezterm';

    if (ui === 'wezterm') {
      await execa('wezterm', [
        'start',
        '--workspace',
        sessionName,
        '--cwd',
        worktreePath,
        '--',
        'herdr',
      ]);
    } else if (ui === 'ghostty') {
      await launchGhostty(['-e', 'herdr']);
    } else {
      // 'none' / unknown: attach herdr directly in the current terminal.
      await execa('herdr', [], { cwd: worktreePath, stdio: 'inherit' });
    }
  }

  /**
   * Attach to the workspace. The orchestrator's attach contract recreates a
   * missing session before calling attach, so a missing workspace here is an
   * error (mirrors tmux/zellij/cmux).
   */
  async attachToSession(
    sessionName: string,
    worktreePath: string,
    options?: AttachOptions,
  ): Promise<void> {
    const exists = await this.sessionExists(sessionName);
    if (!exists) {
      throw new Error(`herdr workspace not found: ${this.workspaceLabel(sessionName)}`);
    }
    await this.focusWorkspace(sessionName);
    const ui = this.config?.terminalUI || 'wezterm';

    try {
      if (ui === 'wezterm') {
        const weztermArgs = ['start', '--workspace', sessionName, '--cwd', worktreePath];
        if (options?.alwaysNewProcess !== false) {
          weztermArgs.push('--always-new-process');
        }
        weztermArgs.push('--', 'herdr');
        await execa('wezterm', weztermArgs, { stdio: 'inherit' });
      } else if (ui === 'ghostty') {
        await launchGhostty(['-e', 'herdr'], { stdio: 'inherit' });
      } else {
        await execa('herdr', [], { cwd: worktreePath, stdio: 'inherit' });
      }
    } catch {
      // UI app unavailable - fall back to a direct herdr attach.
      console.log(`📋 Attaching to herdr in current terminal...`);
      await execa('herdr', [], { cwd: worktreePath, stdio: 'inherit' });
    }
  }

  async killSession(sessionName: string): Promise<void> {
    try {
      const id = await this.resolveId(sessionName);
      if (!id) return;
      await herdr(['workspace', 'close', id]);
    } catch {
      // Workspace doesn't exist / ambiguous - nothing to kill.
    }
  }

  /**
   * Map ghwt session name -> most-urgent live agent status, by joining
   * `herdr agent list` (agent_status + workspace_id) to `herdr workspace list`
   * (workspace_id -> ghwt-stamped label). Only ghwt-labelled workspaces are
   * reported; herdr workspaces the user created themselves (unprefixed) are
   * intentionally not adopted. Best-effort: any failure -> empty map, so an
   * advisory signal never breaks a sync.
   */
  async agentStatuses(): Promise<Map<string, AgentStatus> | null> {
    try {
      const result = new Map<string, AgentStatus>();

      // listWorkspaces() swallows internally and returns []; an empty list is
      // ambiguous (no workspaces vs herdr down), so probe the agent list with
      // the throwing herdr() first - a hard failure here -> null (don't wipe).
      const agentResult = resultOf(await herdr(['agent', 'list']), 'agent list');

      const workspaces = await this.listWorkspaces();
      const labelById = new Map<string, string>();
      for (const w of workspaces) {
        if (w.workspace_id && typeof w.label === 'string') {
          labelById.set(w.workspace_id, w.label);
        }
      }

      const agents = Array.isArray(agentResult.agents)
        ? (agentResult.agents as Array<{ agent_status?: unknown; workspace_id?: unknown }>)
        : [];

      for (const a of agents) {
        const wsId = typeof a.workspace_id === 'string' ? a.workspace_id : undefined;
        const label = wsId ? labelById.get(wsId) : undefined;
        if (!label || !label.startsWith(LABEL_PREFIX)) continue;
        const sessionName = label.slice(LABEL_PREFIX.length);
        const status = normalizeStatus(a.agent_status);
        const prev = result.get(sessionName);
        if (!prev || STATUS_RANK[status] > STATUS_RANK[prev]) {
          result.set(sessionName, status);
        }
      }
      return result;
    } catch {
      // Could not determine (herdr unreachable / CLI error). null tells sync
      // to leave the existing agent_status untouched rather than mass-clear
      // every session on a transient outage.
      return null;
    }
  }
}
