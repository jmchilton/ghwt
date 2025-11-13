import { readdirSync } from 'fs';
import { execa } from 'execa';
import { loadProjectPaths } from '../lib/paths.js';
import { shortenSessionName } from '../lib/terminal-session-base.js';

interface CleanSessionsOptions {
  force?: boolean;
  verbose?: boolean;
}

export async function cleanSessionsCommand(options?: CleanSessionsOptions): Promise<void> {
  const { worktreesRoot } = loadProjectPaths();

  // Get all worktree directories to determine possible session names
  let worktrees: Array<{ project: string; branch: string }> = [];
  try {
    const entries = readdirSync(worktreesRoot, { withFileTypes: true });
    worktrees = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const name = entry.name;
        // Parse worktree name: project-branch-name
        const parts = name.split('-');
        const project = parts[0];
        const branch = parts.slice(1).join('-');
        return { project, branch };
      });
  } catch (error) {
    console.error(`❌ Failed to read worktrees directory: ${error}`);
    process.exit(1);
  }

  // Collect sessions to kill
  const sessionsToKill = {
    tmux: [] as string[],
    zellij: [] as string[],
  };

  // Check tmux sessions
  try {
    const { stdout: tmuxSessions } = await execa('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}',
    ]);
    const tmuxList = tmuxSessions.split('\n').filter((s) => s.trim());

    for (const worktree of worktrees) {
      const sessionName = `${worktree.project}-${worktree.branch}`;
      if (tmuxList.includes(sessionName)) {
        sessionsToKill.tmux.push(sessionName);
      }
    }
  } catch {
    // tmux not running, that's fine
  }

  // Check zellij sessions
  try {
    const { stdout: zellijSessions } = await execa('zellij', ['list-sessions']);
    const zellijList = zellijSessions.split('\n').filter((s) => s.trim());

    for (const worktree of worktrees) {
      const sessionName = `${worktree.project}-${worktree.branch}`;
      const shortened = shortenSessionName(sessionName);

      // Check both full and shortened names
      if (zellijList.some((s) => s.includes(shortened) || s.includes(sessionName))) {
        sessionsToKill.zellij.push(shortened);
      }
    }
  } catch {
    // zellij not running, that's fine
  }

  // Show summary
  const totalSessions = sessionsToKill.tmux.length + sessionsToKill.zellij.length;
  if (totalSessions === 0) {
    console.log('✨ No active ghwt sessions found');
    return;
  }

  console.log(`\n📋 Found ${totalSessions} active session(s):\n`);
  if (sessionsToKill.tmux.length > 0) {
    console.log('  Tmux:');
    sessionsToKill.tmux.forEach((s) => console.log(`    - ${s}`));
  }
  if (sessionsToKill.zellij.length > 0) {
    console.log('  Zellij:');
    sessionsToKill.zellij.forEach((s) => console.log(`    - ${s}`));
  }

  // Confirm unless --force
  if (!options?.force) {
    const promptSync = await import('prompt-sync');
    const prompt = promptSync.default();
    const answer = prompt(`\nKill these ${totalSessions} session(s)? (y/N) `) as string | null;
    if ((answer || '').toLowerCase() !== 'y') {
      console.log('❌ Cancelled');
      return;
    }
  }

  // Kill tmux sessions
  const killed = { tmux: 0, zellij: 0 };
  for (const sessionName of sessionsToKill.tmux) {
    try {
      await execa('tmux', ['kill-session', '-t', sessionName]);
      killed.tmux++;
      if (options?.verbose) {
        console.log(`  ✓ Killed tmux session: ${sessionName}`);
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to kill tmux session ${sessionName}: ${error}`);
    }
  }

  // Kill zellij sessions
  for (const sessionName of sessionsToKill.zellij) {
    try {
      await execa('zellij', ['delete-session', '-f', sessionName]);
      killed.zellij++;
      if (options?.verbose) {
        console.log(`  ✓ Killed zellij session: ${sessionName}`);
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to kill zellij session ${sessionName}: ${error}`);
    }
  }

  // Summary
  console.log(`\n✅ Killed ${killed.tmux} tmux session(s), ${killed.zellij} zellij session(s)`);
}
