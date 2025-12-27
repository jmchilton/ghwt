import { existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { execa } from 'execa';

export interface PreCommitSetupResult {
  sampleFound: boolean;
  configCopied: boolean;
  preCommitInstalled: boolean;
  errors: string[];
}

/**
 * Check if pre-commit tool is available on system
 */
async function isPreCommitAvailable(): Promise<boolean> {
  try {
    await execa('pre-commit', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Setup pre-commit hooks in a newly created worktree
 *
 * Flow:
 * 1. Look for .pre-commit-config.yaml.sample
 * 2. If found and .pre-commit-config.yaml doesn't exist:
 *    - Copy sample to .pre-commit-config.yaml
 *    - Check if pre-commit command is available
 *    - Run `pre-commit install` if available
 * 3. Return detailed result with errors for logging
 *
 * @param worktreePath - Path to the newly created worktree
 * @returns Setup result with status flags and any errors encountered
 */
export async function setupPreCommitHooks(worktreePath: string): Promise<PreCommitSetupResult> {
  const result: PreCommitSetupResult = {
    sampleFound: false,
    configCopied: false,
    preCommitInstalled: false,
    errors: [],
  };

  try {
    const samplePath = join(worktreePath, '.pre-commit-config.yaml.sample');
    const configPath = join(worktreePath, '.pre-commit-config.yaml');

    // Check if sample exists
    if (!existsSync(samplePath)) {
      return result; // No sample, nothing to do
    }
    result.sampleFound = true;

    // Check if config already exists
    if (existsSync(configPath)) {
      // Config already exists, don't overwrite
      return result;
    }

    // Copy sample to config
    try {
      copyFileSync(samplePath, configPath);
      result.configCopied = true;
    } catch (error) {
      result.errors.push(
        `Failed to copy .pre-commit-config.yaml.sample: ${error instanceof Error ? error.message : String(error)}`,
      );
      return result;
    }

    // Check if pre-commit is available
    const preCommitAvailable = await isPreCommitAvailable();
    if (!preCommitAvailable) {
      // pre-commit tool not installed, config is in place for manual setup
      return result;
    }

    // Run pre-commit install
    try {
      await execa('pre-commit', ['install'], { cwd: worktreePath });
      result.preCommitInstalled = true;
    } catch (error) {
      result.errors.push(
        `Failed to run 'pre-commit install': ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't fail if pre-commit install fails - config is already in place
    }
  } catch (error) {
    result.errors.push(
      `Unexpected error during pre-commit setup: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return result;
}
