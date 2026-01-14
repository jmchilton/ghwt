#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { createCommand } from './commands/create.js';
import { syncCommand } from './commands/sync.js';
import { rmCommand } from './commands/rm.js';
import { cloneCommand } from './commands/clone.js';
import { attachCmd } from './commands/attach.js';
import { attachPrCommand } from './commands/attach-pr.js';
import { codeCommand } from './commands/code.js';
import { noteCommand } from './commands/note.js';
import { ghCommand } from './commands/gh.js';
import { claudeCommand } from './commands/claude.js';
import { cursorCommand } from './commands/cursor.js';
import { dashboardCommand } from './commands/dashboard.js';
import { lintCommand } from './commands/lint.js';
import { cleanSessionCommand } from './commands/clean-session.js';
import { ciCleanCommand } from './commands/ci-artifacts-clean.js';
import { ciDownloadCommand } from './commands/ci-artifacts-download.js';
import { pathCiArtifactsCommand } from './commands/path-ci-artifacts.js';
import { pathNoteCommand } from './commands/path-note.js';
import { updateAgentCommandsCommand } from './commands/update-agent-commands.js';

const program = new Command();

program
  .name('ghwt')
  .description('Worktree-centered development dashboard with Obsidian integration')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize ghwt workspace structure')
  .option('--projects-root <path>', 'Root directory for projects')
  .option('--vaults-path <path>', 'Directory containing Obsidian vaults')
  .option('--vault-name <name>', 'Name of the Obsidian vault to create', 'ghwt')
  .action(async (options) => {
    try {
      await initCommand(options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('create <project> <branch>')
  .description(
    'Create a new worktree and Obsidian note\nBranch format: branch name (e.g., cool-feature) or PR number (e.g., 1234)',
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--from <base-branch>', 'Base branch to branch from (e.g., origin/dev, main)')
  .option('--no-fetch', 'Skip fetching remote refs before creating worktree')
  .action(async (project, branch, options) => {
    try {
      await createCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('sync [project] [branch]')
  .description('Sync worktree metadata from git and GitHub (or all with --all)')
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Sync current worktree (requires running from within worktree)')
  .option('--all', 'Sync all worktrees')
  .action(async (project, branch, options) => {
    try {
      await syncCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Shortcut alias for sync --all
program
  .command('sync-all')
  .description('Sync all worktrees (shortcut for "sync --all")')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      await syncCommand(undefined, undefined, { ...options, all: true });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('rm [project] [branch]')
  .description(
    'Remove a worktree, prune repository, and archive Obsidian note\nRun without args to pick from list, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .action(async (project, branch, options) => {
    try {
      await rmCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('clone <repo-url> [branch]')
  .description(
    'Clone a repository and optionally create a worktree\nBranch format: branch name (e.g., cool-feature) or PR number (e.g., 1234)',
  )
  .option('--upstream <url>', 'Upstream repository URL (e.g., for a fork)')
  .option('--no-push', 'Disable push to origin (useful for forked repos)')
  .option('--no-fork-check', 'Skip automatic fork detection')
  .option('-v, --verbose', 'Verbose output')
  .action(async (repoUrl, branch, options) => {
    try {
      await cloneCommand(repoUrl, branch, {
        ...options,
        noPush: options.push === false,
        noForkCheck: options.forkCheck === false,
      });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('attach [project] [branch]')
  .description(
    'Attach to an existing worktree terminal session\nRun without args to pick from list, or with project to filter',
  )
  .option(
    '--existing-terminal',
    'Reuse existing terminal window instead of launching new wezterm process',
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Use current worktree (requires running from within worktree)')
  .action(async (project, branch, cmdOptions) => {
    try {
      await attachCmd(project, branch, {
        existingTerminal: cmdOptions.existingTerminal,
        verbose: cmdOptions.verbose,
        this: cmdOptions.this,
      });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('attach-pr [project] [branch]')
  .description(
    'Attach a pull request to an existing worktree\nRun without args to pick from list, or with project to filter',
  )
  .option('-n, --number <pr-number>', 'Pull request number (required)')
  .action(async (project, branch, options) => {
    try {
      await attachPrCommand(project, branch, options.number);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('code [project] [branch]')
  .description(
    'Open worktree in VS Code\nRun without args to pick from list, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Use current worktree (requires running from within worktree)')
  .action(async (project, branch, options) => {
    try {
      await codeCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('note [project] [branch]')
  .description(
    'Open worktree note in Obsidian\nRun without args to pick from list, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Use current worktree (requires running from within worktree)')
  .action(async (project, branch, options) => {
    try {
      await noteCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('gh [project] [branch]')
  .description(
    'Open branch/PR on GitHub\nRun without args to pick from list, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Use current worktree (requires running from within worktree)')
  .action(async (project, branch, options) => {
    try {
      await ghCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('claude [project] [branch] [prompt...]')
  .description(
    'Open Claude in worktree directory\nRun without args to pick from list, or with project to filter. Optional prompt or --continue flag',
  )
  .option('-c, --continue', 'Continue the most recent conversation')
  .option(
    '-r, --resume [session-id]',
    'Resume a specific session by ID (or pick from list if no ID)',
  )
  .option('-t, --teleport <session-id>', 'Resume a web session by teleporting it to local CLI')
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Use current worktree (requires running from within worktree)')
  .action(async (project, branch, prompt, options) => {
    try {
      const promptStr = prompt && prompt.length > 0 ? prompt.join(' ') : undefined;
      await claudeCommand(project, branch, promptStr, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('cursor [project] [branch]')
  .description(
    'Open worktree in Cursor IDE\nRun without args to pick from list, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Use current worktree (requires running from within worktree)')
  .action(async (project, branch, options) => {
    try {
      await cursorCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .description('Open Obsidian dashboard')
  .action(async () => {
    try {
      await dashboardCommand();
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('lint')
  .description('Validate ghwt configuration files')
  .option('--verbose', 'Show detailed validation messages')
  .option('--session-only', 'Only check session configs')
  .option('--config-only', 'Only check global config')
  .action(async (options) => {
    try {
      await lintCommand(options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('ci-artifacts-clean [project] [branch]')
  .description(
    'Clean downloaded CI artifacts and summaries for worktrees\nRun without args to clean all, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .action(async (project, branch, options) => {
    try {
      await ciCleanCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('clean-session [project] [branch]')
  .description('Kill a ghwt terminal session (or all with --all)')
  .option('--this', 'Clean session for current worktree')
  .option('--all', 'Clean all ghwt sessions')
  .option('--force', 'Skip confirmation prompt (only with --all)')
  .option('--verbose', 'Show which sessions are being killed')
  .action(async (project, branch, options) => {
    try {
      await cleanSessionCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Shortcut alias for clean-session --all
program
  .command('clean-session-all')
  .description('Clean all ghwt sessions (shortcut for "clean-session --all")')
  .option('--force', 'Skip confirmation prompt')
  .option('--verbose', 'Show which sessions are being killed')
  .action(async (options) => {
    try {
      await cleanSessionCommand(undefined, undefined, { ...options, all: true });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Backward compatibility alias
program
  .command('clean-sessions')
  .description('(Deprecated) Use "clean-session --all" instead')
  .option('--force', 'Skip confirmation prompt')
  .option('--verbose', 'Show which sessions are being killed')
  .action(async (options) => {
    console.warn('⚠️  clean-sessions is deprecated. Use "clean-session --all" instead.');
    try {
      await cleanSessionCommand(undefined, undefined, { ...options, all: true });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('ci-artifacts-download [project] [branch]')
  .description(
    'Download CI artifacts and summaries for PR worktrees\nRun without args to download all, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .action(async (project, branch, options) => {
    try {
      await ciDownloadCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('path-ci-artifacts [project] [branch]')
  .description(
    'Output path to CI artifacts for a worktree\nRun without args to pick from list, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Use current worktree (requires running from within worktree)')
  .action(async (project, branch, options) => {
    try {
      await pathCiArtifactsCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('path-note [project] [branch]')
  .description(
    'Output path to worktree note in Obsidian vault\nRun without args to pick from list, or with project to filter',
  )
  .option('-v, --verbose', 'Verbose output')
  .option('--this', 'Use current worktree (requires running from within worktree)')
  .action(async (project, branch, options) => {
    try {
      await pathNoteCommand(project, branch, options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('update-agent-commands')
  .description('Update Claude slash commands symlink/copy')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      await updateAgentCommandsCommand(options);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program.parse();
