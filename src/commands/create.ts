import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { execa } from 'execa';
import { loadConfig, expandPath, getCiArtifactsDir } from '../lib/config.js';
import { getGitInfo, isBareRepository, branchExists } from '../lib/git.js';
import { getPRInfo, getPRRepoUrl } from '../lib/github.js';
import { createWorktreeNote } from '../lib/obsidian.js';
import {
  shouldFetchArtifacts,
  fetchCIArtifacts,
  getCIMetadata,
  getCIArtifactsPath,
} from '../lib/ci-artifacts.js';
import { launchSession } from '../lib/terminal-session.js';
import { getWorktreePath, getNotePath, cleanBranchArg } from '../lib/paths.js';
import { assertRepoExists } from '../lib/errors.js';
import { WorktreeMetadata } from '../types.js';

export async function createCommand(
  project: string,
  branchArg: string,
  options?: { verbose?: boolean },
): Promise<void> {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const reposRoot = join(projectsRoot, config.repositoriesDir);
  const vaultRoot = expandPath(config.vaultPath);
  const ciArtifactsDir = getCiArtifactsDir(config);

  const repoPath = join(reposRoot, project);
  const worktreePath = getWorktreePath(projectsRoot, config, project, branchArg);
  const noteDir = join(vaultRoot, 'projects', project, 'worktrees');
  const notePath = getNotePath(vaultRoot, project, branchArg);

  // Check repo exists
  assertRepoExists(repoPath);

  console.log(`🔹 Repository: ${repoPath}`);

  // Determine branch
  let branch = '';
  let prUrl = '';
  let prInfo: { headRefName: string; url: string; checks?: string } | null = null;

  if (branchArg.startsWith('pr/')) {
    const prNumber = branchArg.slice(3);
    try {
      // Get the appropriate repo URL for PR operations (upstream if available, else origin)
      const ghRepo = await getPRRepoUrl(repoPath);

      prInfo = await getPRInfo(prNumber, ghRepo);
      branch = prInfo.headRefName;
      prUrl = prInfo.url;
      console.log(`🔗 PR: ${prUrl}`);
    } catch (error) {
      console.error(`❌ Failed to fetch PR info: ${error}`);
      process.exit(1);
    }
  } else if (
    branchArg.startsWith('feature/') ||
    branchArg.startsWith('bug/') ||
    branchArg.startsWith('branch/')
  ) {
    // Use shared logic to clean branch argument
    branch = cleanBranchArg(branchArg);
  } else {
    console.error('❌ Unknown branch prefix. Use feature/, bug/, branch/, or pr/');
    process.exit(1);
  }

  // Create worktree
  if (existsSync(worktreePath)) {
    console.log(`🌿 Worktree already exists: ${worktreePath}`);
  } else {
    console.log(`🌱 Creating worktree for branch '${branch}'...`);

    const isBare = await isBareRepository(repoPath);

    if (isBare) {
      await execa('git', ['clone', repoPath, worktreePath]);
      const branchExists_ = await branchExists(repoPath, branch);
      if (branchExists_) {
        await execa('git', ['checkout', branch], { cwd: worktreePath });
      } else {
        await execa('git', ['checkout', '-b', branch], {
          cwd: worktreePath,
        });
      }
    } else {
      const branchExists_ = await branchExists(repoPath, branch);
      if (branchExists_) {
        await execa('git', ['worktree', 'add', worktreePath, branch], {
          cwd: repoPath,
        });
      } else {
        await execa('git', ['worktree', 'add', '-b', branch, worktreePath], {
          cwd: repoPath,
        });
      }
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
      const prNumber = branchArg.slice(3); // Remove "pr/" prefix
      const repoUrl = gitInfo.remoteUrl;
      const repoMatch = repoUrl.match(/[:/]([^/]+)\/(.+?)(?:\.git)?$/);
      const ghRepo = repoMatch ? `${repoMatch[1]}/${repoMatch[2].replace(/\.git$/, '')}` : project;
      const repoName = repoMatch ? repoMatch[2].replace(/\.git$/, '') : project;

      const artifactsPath = getCIArtifactsPath(ciArtifactsDir, repoName, prNumber);

      mkdirSync(artifactsPath, { recursive: true });

      console.log('📦 Fetching CI artifacts for failing PR...');
      await fetchCIArtifacts(prNumber, ghRepo, artifactsPath, false, repoName);

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
    const obsidianUrl = `obsidian://open?vault=projects&file=projects/${project}/worktrees/${branchArg.replace(/\//g, '-')}.md`;
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
