import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execa } from 'execa';
import { expandPath, saveConfig, getConfigFilePath } from '../lib/config.js';
import { GhwtConfig } from '../types.js';
import { writeNote } from '../lib/obsidian.js';

async function detectTerminalMultiplexer(): Promise<'zellij' | 'tmux' | null> {
  const tools = ['zellij', 'tmux'];
  for (const tool of tools) {
    try {
      await execa(tool, ['--version']);
      return tool as 'zellij' | 'tmux';
    } catch {
      // Tool not found, continue to next
    }
  }
  return null;
}

async function detectTerminalUI(): Promise<'ghostty' | 'wezterm' | null> {
  const tools = ['ghostty', 'wezterm'];
  for (const tool of tools) {
    try {
      await execa(tool, ['--version']);
      return tool as 'ghostty' | 'wezterm';
    } catch {
      // Tool not found, continue to next
    }
  }
  return null;
}

export async function initCommand(options: {
  projectsRoot?: string;
  vaultPath?: string;
}): Promise<void> {
  // Check if config already exists
  const configFile = getConfigFilePath();
  if (existsSync(configFile)) {
    console.error(`❌ Config file already exists at ${configFile}`);
    console.error('Run "ghwt init" only once to initialize your workspace.');
    process.exit(1);
  }

  console.log('🚀 Initializing ghwt workspace...\n');

  const projectsRoot = expandPath(options.projectsRoot || '~/projects');
  const vaultPath = expandPath(
    options.vaultPath || '~/Library/Mobile Documents/iCloud~md~obsidian/Documents/projects',
  );

  // Create directory structure
  const dirs = [
    join(projectsRoot, 'repositories'),
    join(projectsRoot, 'worktrees'),
    join(projectsRoot, 'ci-artifacts-config'),
    join(projectsRoot, 'terminal-session-config'),
    join(vaultPath, 'templates'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`✅ Created: ${dir}`);
    } else {
      console.log(`📂 Already exists: ${dir}`);
    }
  }

  // Detect terminal tools
  console.log('\n🔍 Detecting terminal tools...');
  const terminalMultiplexer = await detectTerminalMultiplexer();
  if (terminalMultiplexer) {
    console.log(`✅ Found ${terminalMultiplexer}`);
  } else {
    console.warn(
      `⚠️  Neither tmux nor zellij found. Install one for full functionality.`,
    );
  }

  const terminalUI = await detectTerminalUI();
  if (terminalUI) {
    console.log(`✅ Found ${terminalUI}`);
  }

  // Create config file
  const config: GhwtConfig = {
    projectsRoot,
    repositoriesDir: 'repositories',
    worktreesDir: 'worktrees',
    vaultPath,
    syncInterval: null,
    ...(terminalMultiplexer && { terminalMultiplexer }),
    ...(terminalUI && { terminalUI }),
  };

  // Check dependencies
  console.log('\n🔍 Checking dependencies...');
  const deps = ['git', 'gh'];
  for (const dep of deps) {
    try {
      await execa(dep, ['--version']);
      console.log(`✅ ${dep} is installed`);
    } catch {
      console.log(`❌ ${dep} is NOT installed`);
    }
  }

  // Save config
  saveConfig(config);
  console.log(`\n✅ Config saved to ~/.ghwtrc.json`);

  // Create dashboard template
  const dashboardPath = join(vaultPath, 'dashboard.md');
  if (!existsSync(dashboardPath)) {
    const dashboardFrontmatter = {
      type: 'dashboard',
      created: new Date().toISOString().split('T')[0],
    };
    const dashboardBody = `# Development Dashboard

## Active Work

\`\`\`dataview
TABLE project, branch, status, commits_ahead, pr_checks, days_since_activity
FROM "projects"
WHERE status != "merged" AND status != "archived"
SORT created DESC
\`\`\`

## Needs Attention

\`\`\`dataview
TABLE project, branch, pr_checks, commits_ahead, days_since_activity
FROM "projects"
WHERE (pr_checks = "failing" OR days_since_activity > 7 OR has_uncommitted_changes = true)
SORT days_since_activity DESC
\`\`\`

## Ready to Merge

\`\`\`dataview
TABLE project, branch, status, pr_updated_at
FROM "projects"
WHERE status = "review" AND pr_state = "open"
SORT pr_updated_at DESC
\`\`\`
`;
    writeNote(dashboardPath, dashboardFrontmatter, dashboardBody);
    console.log(`✅ Dashboard template created at ${dashboardPath}`);
  }

  console.log('\n✨ Initialization complete!');
  console.log('\nNext steps:');
  console.log('  1. ghwt create <project> <branch-type>/<name>');
  console.log('  2. Open dashboard.md in Obsidian to see live updates');
  console.log('\n📦 Optional: Install Obsidian plugins for quick action links:');
  console.log("  - Install 'Shell commands' plugin");
  console.log('  - See README for setup instructions');
}
