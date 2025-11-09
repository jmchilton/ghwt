import { join } from 'path';
import { existsSync } from 'fs';
import { execa } from 'execa';
import { loadConfig, expandPath } from '../lib/config.js';

export async function dashboardCommand(): Promise<void> {
  const config = loadConfig();
  const vaultRoot = expandPath(config.vaultPath);

  const dashboardPath = join(vaultRoot, 'dashboard.md');

  // Check if dashboard exists
  if (!existsSync(dashboardPath)) {
    console.error(`❌ Dashboard not found: ${dashboardPath}`);
    console.error(`Run 'ghwt init' to create it.`);
    process.exit(1);
  }

  try {
    // Open dashboard in Obsidian
    const obsidianUrl = `obsidian://open?vault=projects&file=dashboard`;
    await execa('open', [obsidianUrl]);
    console.log(`📊 Opened dashboard in Obsidian`);
  } catch (error) {
    console.error(`❌ Failed to open Obsidian: ${error}`);
    process.exit(1);
  }
}
