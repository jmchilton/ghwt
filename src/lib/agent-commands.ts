import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { symlink, cp, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';

/**
 * Get the path to the agent-commands directory in the ghwt package
 */
export function getAgentCommandsDir(): string {
  const currentModuleDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = join(currentModuleDir, '..', '..');
  return join(packageRoot, 'agent-commands');
}

/**
 * Get the target directory for agent slash commands in user's home
 */
export function getAgentCommandsTargetDir(): string {
  return join(homedir(), '.claude', 'commands', 'ghwt');
}

/**
 * Set up Claude agent slash commands with symlink or copy fallback
 */
export async function setupAgentCommands(options?: { verbose?: boolean }): Promise<void> {
  const sourceDir = getAgentCommandsDir();
  const targetDir = getAgentCommandsTargetDir();

  // Create parent directory
  await mkdir(dirname(targetDir), { recursive: true });

  // Remove existing if present
  if (existsSync(targetDir)) {
    await rm(targetDir, { recursive: true, force: true });
  }

  try {
    // Try symlink first
    await symlink(sourceDir, targetDir, 'dir');
    if (options?.verbose) {
      console.log(`✅ Created symlink to Claude slash commands`);
      console.log(`   Source: ${sourceDir}`);
      console.log(`   Target: ${targetDir}`);
      console.log(`   Commands will auto-update when ghwt is upgraded`);
    } else {
      console.log(`✅ Created symlink to Claude slash commands at ~/.claude/commands/ghwt`);
      console.log(`   Commands will auto-update when ghwt is upgraded`);
    }
  } catch {
    // Fall back to copy
    await cp(sourceDir, targetDir, { recursive: true });
    if (options?.verbose) {
      console.log(`⚠️  Symlink unavailable - copied commands instead`);
      console.log(`   Source: ${sourceDir}`);
      console.log(`   Target: ${targetDir}`);
      console.log(`   Run "ghwt update-agent-commands" after upgrading ghwt`);
    } else {
      console.log(`✅ Copied Claude slash commands to ~/.claude/commands/ghwt`);
      console.log(`   ⚠️  Symlink unavailable - commands won't auto-update`);
      console.log(`   Run "ghwt update-agent-commands" after upgrading ghwt`);
    }
  }
}
