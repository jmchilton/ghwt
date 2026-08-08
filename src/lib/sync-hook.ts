import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

/**
 * Claude Code Stop-hook installer for the cmux integration (A3).
 *
 * cmux has no hook registry of its own - its integration docs describe hooks
 * as agent-side scripts the coding agent invokes. So the "agent task-completion
 * -> ghwt sync --this" bridge is wired on the Claude Code side: a Stop hook
 * that runs `ghwt sync --this`, which (via the sync notify bridge) rings the
 * worktree's cmux workspace on a transition into needs-attention.
 *
 * Idempotent remove-then-write, modeled on setupAgentCommands().
 *
 * `|| true` keeps the hook non-fatal: sync --this calls process.exit(1) on
 * error, and a Stop hook fires on every turn - a failed sync must never block
 * the agent (the only softening the issue's Phase 3.4 caveat justifies).
 */
export const SYNC_HOOK_COMMAND = 'ghwt sync --this || true';

interface CommandHook {
  type: 'command';
  command: string;
}

interface HookGroup {
  matcher?: string;
  hooks: CommandHook[];
}

interface ClaudeSettings {
  hooks?: { Stop?: HookGroup[]; [key: string]: HookGroup[] | undefined };
  [key: string]: unknown;
}

export function getClaudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function readSettings(settingsPath: string): ClaudeSettings {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as ClaudeSettings) : {};
  } catch (error) {
    throw new Error(
      `Could not parse ${settingsPath} (invalid JSON): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Drop any Stop group that contains our sync hook (idempotency). */
function stripSyncHook(groups: HookGroup[]): HookGroup[] {
  return groups
    .map((g) => ({
      ...g,
      hooks: (g.hooks || []).filter((h) => h.command !== SYNC_HOOK_COMMAND),
    }))
    .filter((g) => g.hooks.length > 0);
}

export interface InstallResult {
  settingsPath: string;
  created: boolean;
}

/**
 * Idempotently install the ghwt sync Stop hook into the user's Claude
 * settings. Preserves all other settings and unrelated Stop hooks.
 */
export function installSyncHook(): InstallResult {
  const settingsPath = getClaudeSettingsPath();
  const created = !existsSync(settingsPath);

  const settings = readSettings(settingsPath);
  const hooks = settings.hooks || {};
  const existingStop = Array.isArray(hooks.Stop) ? hooks.Stop : [];

  const nextStop: HookGroup[] = [
    ...stripSyncHook(existingStop),
    { hooks: [{ type: 'command', command: SYNC_HOOK_COMMAND }] },
  ];

  const next: ClaudeSettings = {
    ...settings,
    hooks: { ...hooks, Stop: nextStop },
  };

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n');

  return { settingsPath, created };
}

/** Remove the ghwt sync Stop hook (idempotent). */
export function uninstallSyncHook(): InstallResult {
  const settingsPath = getClaudeSettingsPath();
  if (!existsSync(settingsPath)) return { settingsPath, created: false };

  const settings = readSettings(settingsPath);
  const hooks = settings.hooks || {};
  const existingStop = Array.isArray(hooks.Stop) ? hooks.Stop : [];
  const nextStop = stripSyncHook(existingStop);

  const { Stop: _dropped, ...otherHooks } = hooks;
  void _dropped;
  const nextHooks = nextStop.length === 0 ? otherHooks : { ...otherHooks, Stop: nextStop };

  const next: ClaudeSettings = { ...settings, hooks: nextHooks };
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n');

  return { settingsPath, created: false };
}
