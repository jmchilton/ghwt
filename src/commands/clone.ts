import { join } from 'path';
import { existsSync } from 'fs';
import { execa } from 'execa';
import { loadConfig, expandPath } from '../lib/config.js';
import { checkUserFork } from '../lib/github.js';
import { createCommand } from './create.js';

/**
 * Add a git remote and fetch from it
 * @param repoPath Path to the git repository
 * @param remoteName Name of the remote to add
 * @param remoteUrl URL of the remote
 * @param verbose Whether to output verbose logging
 */
async function addRemoteAndFetch(
  repoPath: string,
  remoteName: string,
  remoteUrl: string,
  verbose?: boolean,
): Promise<void> {
  try {
    if (verbose) {
      console.log(`🔗 Adding ${remoteName} remote: ${remoteUrl}`);
    }
    await execa('git', ['remote', 'add', remoteName, remoteUrl], {
      cwd: repoPath,
    });
    console.log(`✅ Added ${remoteName} remote: ${remoteUrl}`);

    // Fetch from remote
    if (verbose) {
      console.log(`📥 Fetching from ${remoteName}...`);
    }
    await execa('git', ['fetch', remoteName], {
      cwd: repoPath,
    });
    console.log(`✅ Fetched from ${remoteName}`);
  } catch (error) {
    console.error(`❌ Failed to add ${remoteName} remote: ${error}`);
    process.exit(1);
  }
}

export async function cloneCommand(
  repoUrl: string,
  branchArg?: string,
  options?: { upstream?: string; verbose?: boolean; noPush?: boolean; noForkCheck?: boolean },
): Promise<void> {
  let upstreamUrl = options?.upstream;
  const cloneUrl = repoUrl;
  let forkUrl: string | undefined = undefined;
  let forkRemoteName: string | undefined = undefined;
  const noPush = options?.noPush;
  const noForkCheck = options?.noForkCheck;
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const reposRoot = join(projectsRoot, config.repositoriesDir);

  // Check if user has a fork of this repository (unless disabled)
  if (!noForkCheck) {
    try {
      const userFork = await checkUserFork(repoUrl, options?.verbose);
      if (userFork) {
        const forkRepoPath = `${userFork.user}/${userFork.repo}`;
        console.log(`✨ Found your fork: ${forkRepoPath}`);
        // Preserve the original URL format (SSH vs HTTPS)
        forkRemoteName = userFork.user;
        if (repoUrl.startsWith('git@')) {
          forkUrl = `git@github.com:${forkRepoPath}.git`;
        } else {
          forkUrl = `https://github.com/${forkRepoPath}.git`;
        }
        if (!upstreamUrl) {
          upstreamUrl = repoUrl;
        }
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
    // Clone a bare repository (using cloneUrl which may be user's fork)
    await execa('git', ['clone', cloneUrl, targetPath]);
    console.log(`✅ Repository cloned successfully`);
    console.log(`📂 Path: ${targetPath}`);
  } catch (error) {
    console.error(`❌ Failed to clone repository: ${error}`);
    process.exit(1);
  }

  // Add upstream remote if provided
  if (upstreamUrl) {
    await addRemoteAndFetch(targetPath, 'upstream', upstreamUrl, options?.verbose);
  }

  // Add fork remote if fork was detected
  if (forkUrl && forkRemoteName) {
    await addRemoteAndFetch(targetPath, forkRemoteName, forkUrl, options?.verbose);
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
