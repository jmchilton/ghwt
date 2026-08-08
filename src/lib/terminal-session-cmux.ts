import { execa } from 'execa';
import { join } from 'path';
import { GhwtConfig } from '../types.js';
import {
  TerminalSessionManager,
  SessionConfig,
  TemplateVars,
  AttachOptions,
  substituteVariables,
  normalizeSessionConfig,
} from './terminal-session-base.js';

/**
 * cmux session backend (macOS-only, opt-in via terminalMultiplexer: 'cmux').
 *
 * Arms-length integration: this adapter shells out to the `cmux` binary only.
 * No linking, no libghostty, no socket parsing beyond the documented CLI.
 * All cmux-specific behavior is quarantined to this file so the rest of ghwt
 * stays portable and MIT-clean.
 *
 * Identity model: cmux assigns its own workspace ids; it has no deterministic
 * name addressing. ghwt stamps a title (`ghwt:<sessionName>`) via
 * `cmux rename-workspace` right after creation and resolves the workspace
 * fresh on every call by matching that title in `list-workspaces --json`.
 * Nothing is persisted (cmux workspaces are ephemeral + enumerable).
 *
 * cmux is UI+multiplexer fused: `terminalUI` is a no-op for this backend
 * (cmux *is* the UI), exactly as tmux/zellij ignore cmux-only session fields.
 */

/** Minimum supported cmux version (gives stable ref-addressing + rename-workspace). */
export const CMUX_MIN_VERSION = '0.63.0';

/** Title namespace so ghwt-managed workspaces don't collide with user-created ones. */
const TITLE_PREFIX = 'ghwt:';

/**
 * Shell-not-ready race after surface creation (cmux issue #2538): there is no
 * --command flag on new-surface/new-split, so a `send` immediately after
 * creation can land before the shell is interactive. Short fixed wait,
 * overridable via GHWT_CMUX_SURFACE_DELAY_MS (also lets tests set it to 0).
 * Read at call time so the env override doesn't depend on import order.
 */
function surfaceReadyDelayMs(): number {
  const raw = process.env.GHWT_CMUX_SURFACE_DELAY_MS;
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return 600;
  // Clamp: reject negatives and absurd waits from a fat-fingered override.
  return Math.min(Math.max(parsed, 0), 60_000);
}

interface CmuxWorkspace {
  ref: string;
  id?: string;
  index?: number;
  title?: string;
  selected?: boolean;
}

interface CmuxPane {
  ref: string;
  index?: number;
  focused?: boolean;
  selected_surface_ref?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * cmux ref-creating commands print `OK workspace:N` / `OK surface:N` and,
 * with --json, a small object. Field names for the JSON form are not
 * documented and the tool churns fast, so parse defensively: try JSON with
 * several candidate keys, then fall back to the documented text form.
 */
function parseRef(stdout: string, kind: 'workspace' | 'surface' | 'pane'): string | null {
  const trimmed = stdout.trim();

  const candidatesByKind: Record<typeof kind, string[]> = {
    workspace: ['workspace_ref', 'workspaceRef', 'workspace', 'ref'],
    surface: ['surface_ref', 'surfaceRef', 'surface', 'ref'],
    pane: ['pane_ref', 'paneRef', 'pane', 'ref'],
  };

  try {
    const parsed = JSON.parse(trimmed);
    const candidates = candidatesByKind[kind];
    for (const key of candidates) {
      const value = parsed?.[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  } catch {
    // Not JSON - fall through to text parsing.
  }

  const match = trimmed.match(new RegExp(`\\b${kind}:\\d+\\b`));
  return match ? match[0] : null;
}

/**
 * Parse `cmux version` output into a comparable [major, minor, patch] tuple.
 * Strips any commit/build suffix (cmux v0.61.0+ appends commit metadata).
 * ghwt has no other version-parsing precedent - this is a deliberate new
 * pattern, scoped to enforcing the cmux floor.
 */
export function parseCmuxVersion(versionOutput: string): [number, number, number] | null {
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
 * cmux's error envelope. cmux exits 0 even on failure and prints the error on
 * stdout/stderr instead, so exit codes are useless - we must sniff output.
 */
const CMUX_ERROR_RE = /(^|\n)\s*(Error:|not_found:|invalid_params:|Access denied|Failed to write)/;

/**
 * Auth-refusal markers. cmux only accepts socket connections from processes it
 * spawned, unless its (beta) external-access setting is enabled. Without it an
 * external `cmux` call returns one of these instead of doing anything - and a
 * misrouted `send` would otherwise land in the user's active workspace.
 * See manaflow-ai/cmux#1864.
 */
const CMUX_AUTH_RE =
  /Access denied|only processes started inside cmux|Failed to write to socket|Broken pipe/i;

async function cmuxRaw(
  args: string[],
): Promise<{ stdout: string; combined: string; spawnFailed: boolean }> {
  try {
    const r = await execa('cmux', args, { reject: false });
    const stdout = r.stdout ?? '';
    return { stdout, combined: `${stdout}\n${r.stderr ?? ''}`, spawnFailed: false };
  } catch (e) {
    // execa only rejects here on spawn failure (binary missing), not on a
    // non-zero exit (reject:false) - so this is "cmux not found".
    return { stdout: '', combined: e instanceof Error ? e.message : String(e), spawnFailed: true };
  }
}

/**
 * Run a cmux command, throwing on cmux's error envelope regardless of exit
 * code. Exit codes are unreliable (cmux returns 0 on errors) and a stale
 * --workspace ref silently runs in the caller's active workspace, so every
 * call must be output-checked, not status-checked.
 */
async function cmux(args: string[]): Promise<string> {
  const { stdout, combined, spawnFailed } = await cmuxRaw(args);
  if (spawnFailed) {
    throw new Error(`cmux not found / failed to spawn (\`cmux ${args[0]}\`): ${combined.trim()}`);
  }
  if (CMUX_ERROR_RE.test(combined)) {
    const firstErr =
      combined
        .split('\n')
        .map((s) => s.trim())
        .find((s) =>
          /^(Error:|not_found:|invalid_params:|Access denied|Failed to write)/.test(s),
        ) ?? combined.trim();
    throw new Error(`cmux ${args[0]} failed: ${firstErr}`);
  }
  return stdout;
}

/**
 * Probe cmux: socket alive + external access allowed (`ping`) + version floor
 * (`version`). Throws with an actionable message on any failure. Distinguishes
 * "not installed/running" from "running but refusing external CLI access"
 * (manaflow-ai/cmux#1864) - the latter needs cmux's external-access setting,
 * not an install.
 */
export async function assertCmuxReady(): Promise<void> {
  const ping = await cmuxRaw(['ping']);

  if (ping.spawnFailed) {
    throw new Error(
      `cmux is not reachable (terminalMultiplexer: 'cmux').\n` +
        `   cmux is macOS-only. Install/start it: https://cmux.com (then open the app).`,
    );
  }
  if (CMUX_AUTH_RE.test(ping.combined)) {
    throw new Error(
      `cmux is running but refusing external CLI access (terminalMultiplexer: 'cmux').\n` +
        `   The cmux backend drives cmux from outside its own terminals, which cmux\n` +
        `   blocks by default (manaflow-ai/cmux#1864 - no password bypass exists).\n` +
        `   Enable cmux's external socket access setting, then retry.`,
    );
  }
  if (CMUX_ERROR_RE.test(ping.combined)) {
    throw new Error(
      `cmux ping failed (terminalMultiplexer: 'cmux'): ${ping.combined.trim()}\n` +
        `   cmux is macOS-only. Ensure the app is running: https://cmux.com`,
    );
  }

  const version = await cmuxRaw(['version']);
  if (version.spawnFailed || CMUX_ERROR_RE.test(version.combined)) {
    // `cmux version` itself failed - presence already confirmed by ping, so
    // don't hard-block (older cmux may lack the subcommand).
    return;
  }

  // Comparison + throw live outside any catch so a too-old failure can never
  // be swallowed (no message-string sniffing).
  const got = parseCmuxVersion(version.stdout);
  const min = parseCmuxVersion(CMUX_MIN_VERSION);
  if (got && min && compareVersions(got, min) < 0) {
    throw new Error(
      `cmux ${got.join('.')} is too old; ghwt needs >= ${CMUX_MIN_VERSION}. Upgrade cmux.`,
    );
  }
  // Unparseable version string: presence confirmed by ping, accept it.
}

export class CmuxSessionManager implements TerminalSessionManager {
  constructor(
    private config?: GhwtConfig,
    private verbose = false,
  ) {}

  private workspaceTitle(sessionName: string): string {
    return `${TITLE_PREFIX}${sessionName}`;
  }

  private async listWorkspaces(): Promise<CmuxWorkspace[]> {
    try {
      const stdout = await cmux(['list-workspaces', '--json']);
      const parsed = JSON.parse(stdout);
      const arr = Array.isArray(parsed) ? parsed : parsed?.workspaces;
      return Array.isArray(arr) ? (arr as CmuxWorkspace[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Resolve the workspace ref for a session by matching the ghwt-stamped title.
   * cmux does not enforce title uniqueness - a multi-match is an error, never
   * a guess (a user manually renaming in the cmux UI is the only realistic
   * way to break this; ghwt's not-found -> recreate path absorbs that).
   */
  private async resolveRef(
    sessionName: string,
    workspaces?: CmuxWorkspace[],
  ): Promise<string | null> {
    const title = this.workspaceTitle(sessionName);
    const list = workspaces ?? (await this.listWorkspaces());
    const matches = list.filter((w) => w.title === title);
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous cmux workspace: ${matches.length} workspaces titled "${title}". ` +
          `Rename or close the duplicates in cmux.`,
      );
    }
    return matches[0]?.ref ?? null;
  }

  async sessionExists(sessionName: string, workspaces?: CmuxWorkspace[]): Promise<boolean> {
    return (await this.resolveRef(sessionName, workspaces)) !== null;
  }

  /**
   * Send one command line to the workspace's focused pane.
   *
   * Addressed by --workspace, NOT --surface: `cmux send --surface <ref>` is
   * rejected with "Surface is not a terminal" even for the live, selected,
   * tty-backed surface (verified against cmux 0.64.6). `--workspace` routes to
   * the focused pane's active surface, so callers must focusPane() first.
   * (cmux unescapes \n and runs the line.)
   */
  private async sendLine(workspaceRef: string, line: string): Promise<void> {
    if (this.verbose) {
      console.log(`  $ cmux send ${JSON.stringify(line)} --workspace ${workspaceRef}`);
    }
    await cmux(['send', `${line}\n`, '--workspace', workspaceRef]);
  }

  private async newWorkspace(worktreePath: string): Promise<string> {
    const stdout = await cmux(['new-workspace', '--cwd', worktreePath, '--json']);
    const workspaceRef = parseRef(stdout, 'workspace');
    if (!workspaceRef) {
      throw new Error(`cmux new-workspace did not return a workspace ref (got: ${stdout.trim()})`);
    }
    return workspaceRef;
  }

  /** List a workspace's panes (the addressable terminal containers). */
  private async listPanes(workspaceRef: string): Promise<CmuxPane[]> {
    try {
      const stdout = await cmux(['list-panes', '--workspace', workspaceRef, '--json']);
      const parsed = JSON.parse(stdout);
      const arr = Array.isArray(parsed) ? parsed : parsed?.panes;
      return Array.isArray(arr) ? (arr as CmuxPane[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Split the workspace's active pane; returns the NEW pane's ref.
   * `cmux new-split` has no --pane flag, so callers focusPane() the pane they
   * want to split immediately before calling this. Each ghwt pane maps to a
   * cmux pane (a live terminal), not a stacked surface.
   */
  private async newSplitPane(workspaceRef: string, direction: string): Promise<string> {
    const stdout = await cmux(['new-split', direction, '--workspace', workspaceRef, '--json']);
    const ref = parseRef(stdout, 'pane');
    if (!ref) {
      throw new Error(`cmux new-split did not return a pane ref (got: ${stdout.trim()})`);
    }
    return ref;
  }

  /** Focus a pane so a subsequent --workspace send/split targets it. */
  private async focusPane(paneRef: string, workspaceRef: string): Promise<void> {
    if (this.verbose) {
      console.log(`  $ cmux focus-pane --pane ${paneRef} --workspace ${workspaceRef}`);
    }
    // Hardened cmux() throws on cmux's "not_found: Pane not found" envelope
    // (which cmux returns with exit 0), so a cross-workspace/stale pane fails
    // loudly here instead of letting the next send misroute.
    await cmux(['focus-pane', '--pane', paneRef, '--workspace', workspaceRef]);
  }

  /**
   * Create a cmux workspace mirroring TmuxSessionManager.createSession control
   * flow: flatten tabs[].windows[].panes[] to a sequence of cmux *panes* (each
   * a live terminal) in one workspace. cmux's TabConfig grouping has no analog
   * beyond ordering. zellij_ui / start_suspended have no cmux analog (ignored,
   * like tmux). Surfaces are NOT used: new-surface stacks non-live views inside
   * one pane; only panes are independently sendable.
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
      console.log(`⚙️  cmux workspace already exists: ${this.workspaceTitle(sessionName)}`);
      return;
    }

    const vars: TemplateVars = {
      worktree_path: worktreePath,
      project,
      branch,
      note_path: notePath,
    };

    const normalizedConfig = normalizeSessionConfig(config);

    const workspaceRef = await this.newWorkspace(worktreePath);

    // Stamp the ghwt title (cmux new-workspace has no --name flag; rename does).
    await cmux(['rename-workspace', '--workspace', workspaceRef, this.workspaceTitle(sessionName)]);

    // The workspace is created with one initial pane (a live terminal); reuse
    // it for the first ghwt pane, then split for each subsequent one.
    // Misroute guard: a freshly created workspace MUST have >= 1 pane. Zero
    // means workspaceRef is stale/invalid - sending into it would silently
    // run in the user's active workspace (cmux `send` falls back, not errors),
    // so abort rather than risk executing the session in the wrong place.
    const initialPanes = await this.listPanes(workspaceRef);
    if (initialPanes.length === 0) {
      throw new Error(
        `cmux workspace ${workspaceRef} reports no panes right after creation; ` +
          `aborting to avoid running the session in the wrong workspace.`,
      );
    }
    let initialPane: string | null = initialPanes[0]?.ref ?? null;

    for (const tab of normalizedConfig.tabs) {
      for (const window of tab.windows) {
        const windowRoot = window.root ? join(worktreePath, window.root) : worktreePath;
        const substitutedRoot = substituteVariables(windowRoot, vars);

        // Each ghwt pane (or a window with none) maps to one cmux pane.
        const panes = window.panes && window.panes.length > 0 ? window.panes : [undefined];

        for (let paneIndex = 0; paneIndex < panes.length; paneIndex++) {
          let paneRef: string;
          if (initialPane) {
            paneRef = initialPane;
            initialPane = null;
          } else {
            // new-split has no --pane; it splits the active pane. The previous
            // iteration focused the last pane, so the split chains off it.
            paneRef = await this.newSplitPane(workspaceRef, 'right');
          }

          // Focus so the --workspace-addressed sends below land in this pane.
          await this.focusPane(paneRef, workspaceRef);

          // cmux issue #2538: wait for the shell before sending.
          await delay(surfaceReadyDelayMs());

          // cd into the window root if it differs from the workspace cwd.
          // Per-pane (not per-window like the tmux template): cmux split panes
          // do not reliably inherit a cwd, so every pane re-establishes its
          // own dir. Runs before the pre cascade so pre-commands execute in
          // the right dir (same ordering as tmux send-keys).
          if (substitutedRoot !== worktreePath) {
            await this.sendLine(workspaceRef, `cd ${substitutedRoot}`);
          }

          // Cascading pre-commands: session -> tab -> window -> pane command.
          for (const preCmd of normalizedConfig.pre || []) {
            await this.sendLine(workspaceRef, substituteVariables(preCmd, vars));
          }
          for (const preCmd of tab.pre || []) {
            await this.sendLine(workspaceRef, substituteVariables(preCmd, vars));
          }
          for (const preCmd of window.pre || []) {
            await this.sendLine(workspaceRef, substituteVariables(preCmd, vars));
          }

          const cmd = panes[paneIndex];
          if (cmd) {
            await this.sendLine(workspaceRef, substituteVariables(cmd, vars));
          }
        }
      }
    }
  }

  /**
   * Ensure the cmux app is running. `cmux ping` tests socket connectivity;
   * if it fails, try to launch the macOS app and re-probe a few times.
   */
  private async ensureAppRunning(): Promise<void> {
    const probe = await cmuxRaw(['ping']);
    // Auth refusal means cmux IS running - relaunching won't help, and the
    // real problem (external-access setting) needs assertCmuxReady's message.
    if (CMUX_AUTH_RE.test(probe.combined)) {
      throw new Error(
        `cmux is running but refusing external CLI access (manaflow-ai/cmux#1864). ` +
          `Enable cmux's external socket access setting, then retry.`,
      );
    }
    if (!probe.spawnFailed && !CMUX_ERROR_RE.test(probe.combined)) {
      return; // reachable
    }

    // Not running yet - launch the app (cmux analog of `wezterm start`).
    try {
      await execa('open', ['-a', 'cmux']);
    } catch {
      // `open` may fail if the app isn't installed; surface via ping retries.
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      await delay(500);
      const retry = await cmuxRaw(['ping']);
      if (CMUX_AUTH_RE.test(retry.combined)) {
        throw new Error(
          `cmux is running but refusing external CLI access (manaflow-ai/cmux#1864). ` +
            `Enable cmux's external socket access setting, then retry.`,
        );
      }
      if (!retry.spawnFailed && !CMUX_ERROR_RE.test(retry.combined)) {
        return;
      }
    }
    throw new Error('cmux app did not become reachable (is it installed?)');
  }

  private async select(sessionName: string): Promise<void> {
    const ref = await this.resolveRef(sessionName);
    if (!ref) {
      throw new Error(`cmux workspace not found: ${this.workspaceTitle(sessionName)}`);
    }
    if (this.verbose) {
      console.log(`  $ cmux select-workspace --workspace ${ref}`);
    }
    await cmux(['select-workspace', '--workspace', ref]);
  }

  /**
   * Launch/focus cmux on the workspace. terminalUI is intentionally ignored
   * (cmux is the UI); never spawns wezterm/ghostty.
   */
  async launchUI(sessionName: string, _worktreePath: string): Promise<void> {
    void _worktreePath;
    await this.ensureAppRunning();
    await this.select(sessionName);
  }

  /**
   * Attach == focus the workspace in cmux. terminalUI / --existing-terminal
   * are no-ops (ghostty-style). Missing workspace is an error here; the
   * orchestrator's attach contract recreates before calling attach.
   */
  async attachToSession(
    sessionName: string,
    _worktreePath: string,
    _options?: AttachOptions,
  ): Promise<void> {
    void _worktreePath;
    void _options;
    await this.ensureAppRunning();
    await this.select(sessionName);
  }

  async killSession(sessionName: string): Promise<void> {
    try {
      const ref = await this.resolveRef(sessionName);
      if (!ref) return;
      await cmux(['close-workspace', '--workspace', ref]);
    } catch {
      // Workspace doesn't exist / ambiguous - nothing to kill.
    }
  }

  /**
   * Ring the worktree's cmux workspace (used by the ghwt sync notify bridge).
   * Best-effort: never throws into the sync path.
   */
  async notify(sessionName: string, title: string, subtitle?: string): Promise<void> {
    try {
      const ref = await this.resolveRef(sessionName);
      if (!ref) return;
      const args = ['notify', '--title', title];
      if (subtitle) args.push('--subtitle', subtitle);
      args.push('--workspace', ref);
      await cmux(args);
    } catch {
      // Notification is advisory only.
    }
  }
}
