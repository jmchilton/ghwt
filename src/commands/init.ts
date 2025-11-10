import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execa } from 'execa';
import { expandPath, saveConfig } from '../lib/config.js';
import { GhwtConfig } from '../types.js';
import { writeNote } from '../lib/obsidian.js';

export async function initCommand(options: {
  projectsRoot?: string;
  vaultPath?: string;
}): Promise<void> {
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

  // Create config file
  const config: GhwtConfig = {
    projectsRoot,
    repositoriesDir: 'repositories',
    worktreesDir: 'worktrees',
    vaultPath,
    syncInterval: null,
    defaultBaseBranch: 'dev',
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
