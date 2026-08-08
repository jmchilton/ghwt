import { installSyncHook, uninstallSyncHook, SYNC_HOOK_COMMAND } from '../lib/sync-hook.js';

export async function installSyncHookCommand(options?: { uninstall?: boolean }): Promise<void> {
  if (options?.uninstall) {
    const { settingsPath } = uninstallSyncHook();
    console.log(`🧹 Removed ghwt sync Stop hook from ${settingsPath}`);
    return;
  }

  const { settingsPath, created } = installSyncHook();
  console.log(
    `✅ Installed ghwt sync Stop hook ${created ? '(created' : '(updated'} ${settingsPath})`,
  );
  console.log(`   On every Claude turn end: ${SYNC_HOOK_COMMAND}`);
  console.log(`   With terminalMultiplexer: 'cmux', this rings the worktree's`);
  console.log(`   workspace on a transition into needs-attention.`);
}
