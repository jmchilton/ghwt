import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { execa } from 'execa';
import { loadConfig, expandPath } from '../lib/config.js';
import {
  getGitInfo,
  branchExists,
  baseBranchExists,
  suggestBaseBranches,
  getImplicitBaseBranch,
} from '../lib/git.js';
import { getPRInfo, getPRRepoUrl } from '../lib/github.js';
import { createWorktreeNote, getObsidianNoteUrl } from '../lib/obsidian.js';
import {
  shouldFetchArtifacts,
  fetchCIArtifacts,
  getCIMetadata,
  getCIArtifactsPath,
} from '../lib/ci-artifacts.js';
import { launchSession } from '../lib/terminal-session.js';
import { getWorktreePath, getNotePath } from '../lib/paths.js';
import { parseBranchArg } from '../lib/branch-parser.js';
import { assertRepoExists } from '../lib/errors.js';
import { WorktreeMetadata } from '../types.js';

export async function createCommand(
  project: string,
  branchArg: string,
  options?: { verbose?: boolean; from?: string; noFetch?: boolean },
): Promise<void> {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const reposRoot = join(projectsRoot, config.repositoriesDir);
  const vaultRoot = expandPath(config.vaultPath);

  // Parse branch argument to determine type (PR vs branch)
  let parsed;
  try {
    parsed = parseBranchArg(branchArg);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const { type: branchType, name: parsedName } = parsed;
  const repoPath = join(reposRoot, project);
  const worktreePath = getWorktreePath(projectsRoot, config, project, branchType, parsedName);
  const noteDir = join(vaultRoot, 'projects', project, 'worktrees');
  const notePath = getNotePath(vaultRoot, project, parsedName);

  // Check repo exists
  assertRepoExists(repoPath);

  console.log(`🔹 Repository: ${repoPath}`);

  // Fetch remote refs unless --no-fetch is provided
  if (!options?.noFetch) {
    console.log('🔄 Fetching remote refs...');
    try {
      await execa('git', ['fetch', '--all'], { cwd: repoPath });
    } catch (error) {
      console.log(`⚠️  Warning: Failed to fetch remote refs: ${error}`);
    }
  }

  // Determine base branch - either explicit or implicit
  let baseBranch: string | null = null;

  if (options?.from) {
    // Explicit base branch provided
    const baseExists = await baseBranchExists(repoPath, options.from);
    if (!baseExists) {
      const suggestions = await suggestBaseBranches(repoPath, options.from);
      console.error(`❌ Base branch '${options.from}' not found.`);
      if (suggestions.length > 0) {
        console.error(
          `\nDid you mean one of these?\n${suggestions.map((s) => `  - ${s}`).join('\n')}`,
        );
      }
      process.exit(1);
    }
    baseBranch = options.from;
  } else if (branchType === 'branch') {
    // Try to detect implicit base branch for branch type only (not PRs)
    baseBranch = await getImplicitBaseBranch(repoPath, parsedName);
    if (baseBranch && baseBranch !== parsedName) {
      console.log(`📍 Branching from: ${baseBranch} (detected)`);
    }
  }

  // Determine actual git branch
  let branch = '';
  let prUrl = '';
  let prInfo: { headRefName: string; url: string; checks?: string; baseRefName?: string } | null =
    null;

  if (branchType === 'pr') {
    // PR number is in parsedName
    try {
      // Get the appropriate repo URL for PR operations (upstream if available, else origin)
      const ghRepo = await getPRRepoUrl(repoPath);

      prInfo = await getPRInfo(parsedName, ghRepo);
      branch = prInfo.headRefName;
      prUrl = prInfo.url;

      // Set base branch from PR if not explicitly provided
      if (!options?.from && prInfo.baseRefName) {
        baseBranch = prInfo.baseRefName;
        console.log(`📍 PR targets: ${baseBranch} (from PR metadata)`);
      }

      console.log(`🔗 PR: ${prUrl}`);
    } catch (error) {
      console.error(`❌ Failed to fetch PR info: ${error}`);
      process.exit(1);
    }
  } else {
    // branchType === 'branch'
    branch = parsedName;
  }

  // Validate base branch exists if set from PR, fallback to origin/base if needed
  if (baseBranch && branchType === 'pr' && !options?.from) {
    const baseExists = await baseBranchExists(repoPath, baseBranch);
    if (!baseExists) {
      const originBaseExists = await baseBranchExists(repoPath, `origin/${baseBranch}`);
      if (originBaseExists) {
        baseBranch = `origin/${baseBranch}`;
        console.log(`📍 Using remote: ${baseBranch}`);
      } else {
        console.log(`⚠️  Warning: PR base branch '${baseBranch}' not found locally or on origin`);
        baseBranch = null;
      }
    }
  }

  // Create worktree
  if (existsSync(worktreePath)) {
    console.log(`🌿 Worktree already exists: ${worktreePath}`);
  } else {
    console.log(`🌱 Creating worktree for branch '${branch}'...`);

    const branchExists_ = await branchExists(repoPath, branch);
    if (branchExists_) {
      if (baseBranch && baseBranch !== branch) {
        console.log(`⚠️  Branch '${branch}' already exists, ignoring base branch option`);
      }
      await execa('git', ['worktree', 'add', worktreePath, branch], {
        cwd: repoPath,
      });
    } else {
      const args = ['worktree', 'add', '-b', branch, worktreePath];
      if (baseBranch && baseBranch !== branch) {
        args.push(baseBranch);
      }
      await execa('git', args, {
        cwd: repoPath,
      });
    }
  }

  // Get git info
  const gitInfo = await getGitInfo(worktreePath, branch);

  // Create note
  mkdirSync(noteDir, { recursive: true });

  const metadata: Partial<WorktreeMetadata> = {
    project,
    branch,
    pr: prUrl || undefined,
    status: 'in-progress',
    created: new Date().toISOString().split('T')[0],
    repo_url: gitInfo.remoteUrl,
    worktree_path: worktreePath,
    base_branch: gitInfo.baseBranch,
    commits_ahead: gitInfo.commitsAhead,
    commits_behind: gitInfo.commitsBehind,
    has_uncommitted_changes: gitInfo.hasUncommittedChanges,
    last_commit_date: gitInfo.lastCommitDate,
    tracking_branch: gitInfo.trackingBranch || undefined,
  };

  // Fetch CI artifacts if PR is failing
  if (prInfo && shouldFetchArtifacts(metadata, prInfo.checks)) {
    try {
      const repoUrl = gitInfo.remoteUrl;
      const repoMatch = repoUrl.match(/[:/]([^/]+)\/(.+?)(?:\.git)?$/);
      const ghRepo = repoMatch ? `${repoMatch[1]}/${repoMatch[2].replace(/\.git$/, '')}` : project;
      const repoName = repoMatch ? repoMatch[2].replace(/\.git$/, '') : project;

      const artifactsPath = getCIArtifactsPath(projectsRoot, project, branchType, parsedName);

      mkdirSync(artifactsPath, { recursive: true });

      console.log('📦 Fetching CI artifacts for failing PR...');
      await fetchCIArtifacts(parsedName, ghRepo, artifactsPath, false, repoName);

      const ciMeta = await getCIMetadata(artifactsPath, gitInfo.currentSha);
      Object.assign(metadata, ciMeta);

      console.log(
        `✅ CI artifacts: ${ciMeta.ci_status} (${ciMeta.ci_failed_tests} test failures, ${ciMeta.ci_linter_errors} lint errors)`,
      );
    } catch (error) {
      console.log(`⚠️  Failed to fetch CI artifacts: ${error}`);
    }
  }

  createWorktreeNote(notePath, metadata);
  console.log(`🪶 Note created: ${notePath}`);

  // Open tools
  const codeAvailable = await commandExists('code');
  const obsidianAvailable = await commandExists('open');

  if (codeAvailable) {
    try {
      await execa('code', [worktreePath]);
      console.log('💻 Opened in VS Code');
    } catch {
      // Silently fail if opening fails
    }
  }

  if (obsidianAvailable) {
    const obsidianUrl = getObsidianNoteUrl(project, parsedName, config.obsidianVaultName);
    try {
      await execa('open', [obsidianUrl]);
      console.log('📖 Opened in Obsidian');
    } catch {
      // Silently fail if opening fails
    }
  }

  // Launch terminal session if config exists
  try {
    await launchSession(project, branch, worktreePath, config, options?.verbose, notePath);
    console.log('🖥️  Terminal session launched');
  } catch {
    console.log(`⚠️  Terminal session not configured`);
  }

  console.log('\n✅ Done!');
  console.log(`📂 Worktree: ${worktreePath}`);
  console.log(`🪶 Note: ${notePath}`);
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execa(cmd, ['--version']);
    return true;
  } catch {
    return false;
  }
}
