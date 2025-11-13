import { join } from 'path';
import { existsSync } from 'fs';
import { execa } from 'execa';
import { loadConfig, expandPath } from '../lib/config.js';
import { checkUserFork } from '../lib/github.js';
import { createCommand } from './create.js';

export async function cloneCommand(
  repoUrl: string,
  branchArg?: string,
  options?: { upstream?: string; verbose?: boolean; noPush?: boolean; noForkCheck?: boolean },
): Promise<void> {
  let upstreamUrl = options?.upstream;
  let cloneUrl = repoUrl;
  const noPush = options?.noPush;
  const noForkCheck = options?.noForkCheck;
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const reposRoot = join(projectsRoot, config.repositoriesDir);

  // Check if user has a fork of this repository (unless disabled)
  if (!noForkCheck && !upstreamUrl) {
    try {
      const userFork = await checkUserFork(repoUrl);
      if (userFork) {
        console.log(`✨ Found your fork: ${userFork}`);
        cloneUrl = userFork;
        upstreamUrl = repoUrl;
        console.log(`📌 Using your fork as origin, original as upstream`);
      }
    } catch (error) {
      if (options?.verbose) {
        console.log(`ℹ️  Could not check for fork: ${error}`);
      }
      // Continue with original URL if fork check fails
    }
  }

  // Extract repo name from URL
  // Handles: git@github.com:owner/repo.git or https://github.com/owner/repo.git or https://github.com/owner/repo
  const repoMatch = repoUrl.match(/(?:^|\/|:)([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!repoMatch) {
    console.error(`❌ Invalid repository URL: ${repoUrl}`);
    process.exit(1);
  }

  const repoName = repoMatch[2];
  const targetPath = join(reposRoot, repoName);

  // Check if repo already exists
  if (existsSync(targetPath)) {
    console.error(`❌ Repository already exists: ${targetPath}`);
    process.exit(1);
  }

  console.log(`📦 Cloning repository: ${repoUrl}`);
  console.log(`📍 Target: ${targetPath}`);

  try {
    // Clone as bare repository (using cloneUrl which may be user's fork)
    await execa('git', ['clone', '--bare', cloneUrl, targetPath]);
    console.log(`✅ Repository cloned successfully`);
    console.log(`📂 Path: ${targetPath}`);
  } catch (error) {
    console.error(`❌ Failed to clone repository: ${error}`);
    process.exit(1);
  }

  // Add upstream remote if provided
  if (upstreamUrl) {
    try {
      await execa('git', ['remote', 'add', 'upstream', upstreamUrl], {
        cwd: targetPath,
      });
      console.log(`✅ Added upstream remote: ${upstreamUrl}`);

      // Fetch from upstream
      await execa('git', ['fetch', 'upstream'], {
        cwd: targetPath,
      });
      console.log(`✅ Fetched from upstream`);
    } catch (error) {
      console.error(`❌ Failed to add upstream remote: ${error}`);
      process.exit(1);
    }
  }

  // Disable push to origin if requested (useful for forked repos)
  if (noPush) {
    try {
      await execa('git', ['remote', 'set-url', '--push', 'origin', 'no-push'], {
        cwd: targetPath,
      });
      console.log(`✅ Disabled push to origin (use upstream to push)`);
    } catch (error) {
      console.error(`❌ Failed to disable push to origin: ${error}`);
      process.exit(1);
    }
  }

  // If branch argument provided, create worktree
  if (branchArg) {
    console.log();
    await createCommand(repoName, branchArg);
  }
}
