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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * cmux ref-creating commands print `OK workspace:N` / `OK surface:N` and,
 * with --json, a small object. Field names for the JSON form are not
 * documented and the tool churns fast, so parse defensively: try JSON with
 * several candidate keys, then fall back to the documented text form.
 */
function parseRef(stdout: string, kind: 'workspace' | 'surface'): string | null {
  const trimmed = stdout.trim();

  try {
    const parsed = JSON.parse(trimmed);
    const candidates =
      kind === 'workspace'
        ? ['workspace_ref', 'workspaceRef', 'workspace', 'ref']
        : ['surface_ref', 'surfaceRef', 'surface', 'ref'];
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
 * Probe cmux: socket alive (`ping`) + version floor (`version`).
 * Throws with an actionable, macOS-only message on any failure.
 * Mirrors the isUIAvailable not-found block in terminal-session.ts.
 */
export async function assertCmuxReady(): Promise<void> {
  try {
    await execa('cmux', ['ping']);
  } catch {
    throw new Error(
      `cmux is not reachable (terminalMultiplexer: 'cmux').\n` +
        `   cmux is macOS-only. Install/start it: https://cmux.com (then open the app).`,
    );
  }

  let versionStdout: string;
  try {
    ({ stdout: versionStdout } = await execa('cmux', ['version']));
  } catch {
    // `cmux version` itself failed - presence already confirmed by ping, so
    // don't hard-block (older cmux may lack the subcommand).
    return;
  }

  // Comparison + throw live outside the try so a too-old failure can never be
  // swallowed by the subprocess catch (no message-string sniffing).
  const got = parseCmuxVersion(versionStdout);
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
      const { stdout } = await execa('cmux', ['list-workspaces', '--json']);
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

  /** Send one command line to a surface (cmux unescapes \n and runs it). */
  private async sendLine(surfaceRef: string, line: string): Promise<void> {
    if (this.verbose) {
      console.log(`  $ cmux send ${JSON.stringify(line)} --surface ${surfaceRef}`);
    }
    await execa('cmux', ['send', `${line}\n`, '--surface', surfaceRef]);
  }

  private async newWorkspace(
    worktreePath: string,
  ): Promise<{ workspaceRef: string; surfaceRef: string | null }> {
    const { stdout } = await execa('cmux', ['new-workspace', '--cwd', worktreePath, '--json']);
    const workspaceRef = parseRef(stdout, 'workspace');
    if (!workspaceRef) {
      throw new Error(`cmux new-workspace did not return a workspace ref (got: ${stdout.trim()})`);
    }
    // new-workspace may also surface the initial surface ref; capture if present.
    return { workspaceRef, surfaceRef: parseRef(stdout, 'surface') };
  }

  private async newSurface(workspaceRef: string): Promise<string> {
    const { stdout } = await execa('cmux', ['new-surface', '--workspace', workspaceRef, '--json']);
    const ref = parseRef(stdout, 'surface');
    if (!ref) {
      throw new Error(`cmux new-surface did not return a surface ref (got: ${stdout.trim()})`);
    }
    return ref;
  }

  private async newSplit(surfaceRef: string, direction: string): Promise<string> {
    const { stdout } = await execa('cmux', [
      'new-split',
      direction,
      '--surface',
      surfaceRef,
      '--json',
    ]);
    const ref = parseRef(stdout, 'surface');
    if (!ref) {
      throw new Error(`cmux new-split did not return a surface ref (got: ${stdout.trim()})`);
    }
    return ref;
  }

  /**
   * Create a cmux workspace mirroring TmuxSessionManager.createSession control
   * flow: flatten tabs[].windows[].panes[] to a sequence of cmux surfaces in
   * one workspace. cmux's TabConfig grouping has no analog beyond ordering.
   * zellij_ui / start_suspended have no cmux analog (ignored, like tmux).
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

    const { workspaceRef, surfaceRef: initialSurface } = await this.newWorkspace(worktreePath);

    // Stamp the ghwt title (cmux new-workspace has no --name flag; rename does).
    await execa('cmux', [
      'rename-workspace',
      '--workspace',
      workspaceRef,
      this.workspaceTitle(sessionName),
    ]);

    let initialSurfaceFree = initialSurface !== null;

    for (const tab of normalizedConfig.tabs) {
      for (const window of tab.windows) {
        const windowRoot = window.root ? join(worktreePath, window.root) : worktreePath;
        const substitutedRoot = substituteVariables(windowRoot, vars);

        // One window == one cmux surface; extra panes == splits off it.
        const panes = window.panes && window.panes.length > 0 ? window.panes : [undefined];

        let windowSurface: string;
        if (initialSurfaceFree && initialSurface) {
          windowSurface = initialSurface;
          initialSurfaceFree = false;
        } else {
          windowSurface = await this.newSurface(workspaceRef);
        }

        for (let paneIndex = 0; paneIndex < panes.length; paneIndex++) {
          const surfaceRef =
            paneIndex === 0 ? windowSurface : await this.newSplit(windowSurface, 'right');

          // cmux issue #2538: wait for the shell before sending.
          await delay(surfaceReadyDelayMs());

          // cd into the window root if it differs from the workspace cwd.
          // Deliberately per-pane, not per-window like the tmux template:
          // tmux split panes inherit the window cwd; cmux splits do not
          // reliably, so every surface re-establishes its own dir. Runs
          // before the pre cascade so pre-commands execute in the right dir
          // (same ordering as tmux send-keys).
          if (substitutedRoot !== worktreePath) {
            await this.sendLine(surfaceRef, `cd ${substitutedRoot}`);
          }

          // Cascading pre-commands: session -> tab -> window -> pane command.
          for (const preCmd of normalizedConfig.pre || []) {
            await this.sendLine(surfaceRef, substituteVariables(preCmd, vars));
          }
          for (const preCmd of tab.pre || []) {
            await this.sendLine(surfaceRef, substituteVariables(preCmd, vars));
          }
          for (const preCmd of window.pre || []) {
            await this.sendLine(surfaceRef, substituteVariables(preCmd, vars));
          }

          const cmd = panes[paneIndex];
          if (cmd) {
            await this.sendLine(surfaceRef, substituteVariables(cmd, vars));
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
    try {
      await execa('cmux', ['ping']);
      return;
    } catch {
      // Not running yet - launch the app (cmux analog of `wezterm start`).
    }

    try {
      await execa('open', ['-a', 'cmux']);
    } catch {
      // `open` may fail if the app isn't installed; surface via ping retries.
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      await delay(500);
      try {
        await execa('cmux', ['ping']);
        return;
      } catch {
        // keep waiting
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
    await execa('cmux', ['select-workspace', '--workspace', ref]);
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
      await execa('cmux', ['close-workspace', '--workspace', ref]);
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
      await execa('cmux', args);
    } catch {
      // Notification is advisory only.
    }
  }
}
