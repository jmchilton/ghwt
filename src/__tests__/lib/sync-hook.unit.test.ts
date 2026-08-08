import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

vi.mock('os', async (importActual) => {
  const actual = await importActual<typeof import('os')>();
  return { ...actual, homedir: () => fakeHome };
});

import {
  installSyncHook,
  uninstallSyncHook,
  getClaudeSettingsPath,
  SYNC_HOOK_COMMAND,
} from '../../lib/sync-hook.js';

function readSettings() {
  return JSON.parse(readFileSync(getClaudeSettingsPath(), 'utf-8'));
}

describe('sync-hook installer', () => {
  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'ghwt-hook-'));
  });
  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('creates settings.json with the Stop hook when none exists', () => {
    const { created } = installSyncHook();
    expect(created).toBe(true);
    expect(readSettings().hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: SYNC_HOOK_COMMAND }] },
    ]);
  });

  it('is idempotent (no duplicate entry on repeated install)', () => {
    installSyncHook();
    installSyncHook();
    const stop = readSettings().hooks.Stop;
    const ours = stop.flatMap((g: { hooks: { command: string }[] }) =>
      g.hooks.filter((h) => h.command === SYNC_HOOK_COMMAND),
    );
    expect(ours).toHaveLength(1);
  });

  it('preserves unrelated settings and other Stop hooks', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(
      getClaudeSettingsPath(),
      JSON.stringify({
        env: { FOO: 'bar' },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] },
      }),
    );

    installSyncHook();
    const s = readSettings();
    expect(s.env).toEqual({ FOO: 'bar' });
    expect(s.hooks.Stop).toContainEqual({
      hooks: [{ type: 'command', command: 'other-tool' }],
    });
    expect(s.hooks.Stop).toContainEqual({
      hooks: [{ type: 'command', command: SYNC_HOOK_COMMAND }],
    });
  });

  it('uninstall removes only our hook and drops empty Stop', () => {
    installSyncHook();
    uninstallSyncHook();
    const s = readSettings();
    expect(s.hooks.Stop).toBeUndefined();
  });

  it('uninstall keeps other Stop hooks intact', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(
      getClaudeSettingsPath(),
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] },
      }),
    );
    installSyncHook();
    uninstallSyncHook();
    expect(readSettings().hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'other-tool' }] },
    ]);
  });

  it('throws a clear error on malformed settings.json', () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(getClaudeSettingsPath(), '{ not json');
    expect(() => installSyncHook()).toThrow(/invalid JSON/);
  });
});
