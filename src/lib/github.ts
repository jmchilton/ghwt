import { execa } from 'execa';

/**
 * Parse a git repository URL and extract owner/repo
 * @example parseGitRepoUrl('git@github.com:owner/repo.git') => { owner: 'owner', repo: 'repo' }
 */
export function parseGitRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  const match = repoUrl.match(/[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
  };
}

/**
 * Format a git repository URL into owner/repo format
 */
export function formatGhRepo(repoUrl: string): string | undefined {
  const parsed = parseGitRepoUrl(repoUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : undefined;
}

/**
 * Get the appropriate repo for PR operations.
 * For forked repos, use upstream if available; otherwise use origin.
 */
export async function getPRRepoUrl(repoPath: string): Promise<string | undefined> {
  try {
    // Try to get upstream remote first (for forked repos)
    const { stdout: upstreamUrl } = await execa('git', ['remote', 'get-url', 'upstream'], {
      cwd: repoPath,
    }).catch(() => ({ stdout: '' }));

    if (upstreamUrl && upstreamUrl.trim()) {
      return formatGhRepo(upstreamUrl);
    }

    // Fall back to origin
    const { stdout: originUrl } = await execa('git', ['remote', 'get-url', 'origin'], {
      cwd: repoPath,
    });

    return formatGhRepo(originUrl);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    return undefined;
  }
}

export interface PRInfo {
  number: number;
  state: string;
  checks: string;
  reviews: number;
  labels: string[];
  updatedAt: string;
  url: string;
  headRefName: string;
}

export async function getPRInfo(prNumber: number | string, repo?: string): Promise<PRInfo> {
  const prNum = String(prNumber);

  try {
    const args = [
      'pr',
      'view',
      prNum,
      '--json',
      'number,state,statusCheckRollup,reviews,labels,updatedAt,url,headRefName',
    ];

    if (repo) {
      args.push('--repo', repo);
    }

    const { stdout: prJson } = await execa('gh', args, {
      cwd: repo ? undefined : process.cwd(),
    });

    const prData = JSON.parse(prJson);

    // Determine checks status
    let checksStatus = 'unknown';
    if (prData.statusCheckRollup && prData.statusCheckRollup.length > 0) {
      const statuses = prData.statusCheckRollup.map(
        (check: { conclusion: string }) => check.conclusion,
      );
      if (statuses.includes('FAILURE')) checksStatus = 'failing';
      else if (statuses.includes('PENDING')) checksStatus = 'pending';
      else checksStatus = 'passing';
    }

    return {
      number: prData.number,
      state: prData.state,
      checks: checksStatus,
      reviews: prData.reviews ? prData.reviews.length : 0,
      labels: prData.labels ? prData.labels.map((l: { name: string }) => l.name) : [],
      updatedAt: prData.updatedAt,
      url: prData.url,
      headRefName: prData.headRefName,
    };
  } catch (error) {
    throw new Error(`Failed to fetch PR info for #${prNum}: ${error}`);
  }
}

export async function createPRFromBranch(
  branch: string,
  title?: string,
  body?: string,
): Promise<{ url: string; number: number }> {
  try {
    const args = ['pr', 'create', '--head', branch];
    if (title) args.push('--title', title);
    if (body) args.push('--body', body);

    const { stdout: prJson } = await execa('gh', [...args, '--json', 'url,number']);

    const prData = JSON.parse(prJson);
    return { url: prData.url, number: prData.number };
  } catch (error) {
    throw new Error(`Failed to create PR: ${error}`);
  }
}

/**
 * Get the current GitHub user's login
 * @throws Error if not authenticated with gh CLI
 */
export async function getCurrentUser(): Promise<string> {
  try {
    const { stdout } = await execa('gh', ['api', 'user', '--jq', '.login']);
    return stdout.trim();
  } catch (error) {
    throw new Error(
      `Failed to get current GitHub user. Make sure you are authenticated with gh CLI. ${error}`,
    );
  }
}

/**
 * Check if current user has a fork of a repository
 * @param repoUrl The URL of the upstream repository
 * @param verbose Whether to output debug logging
 * @returns Object with user and repo if found, null if user doesn't have a fork
 */
export async function checkUserFork(
  repoUrl: string,
  verbose?: boolean,
): Promise<{ user: string; repo: string } | null> {
  try {
    if (verbose) {
      console.log(`🔍 Checking for user fork of: ${repoUrl}`);
    }

    const parsed = parseGitRepoUrl(repoUrl);
    if (!parsed) {
      if (verbose) {
        console.log(`⚠️  Could not parse repository URL: ${repoUrl}`);
      }
      return null;
    }

    const { owner, repo } = parsed;
    if (verbose) {
      console.log(`📋 Parsed repository: owner=${owner}, repo=${repo}`);
    }

    const user = await getCurrentUser();
    if (verbose) {
      console.log(`👤 Current GitHub user: ${user}`);
    }

    // Check if user has a repo with the same name
    const potentialFork = `${user}/${repo}`;
    if (verbose) {
      console.log(`🔎 Checking for repository: ${potentialFork}`);
    }

    const { stdout: repoJson } = await execa('gh', [
      'repo',
      'view',
      potentialFork,
      '--json',
      'nameWithOwner,isFork,parent',
    ]);

    const repoData = JSON.parse(repoJson);
    if (verbose) {
      console.log(`📊 Repository data:`, JSON.stringify(repoData, null, 2));
    }

    // Verify it's actually a fork of the target repo
    if (
      repoData.isFork &&
      repoData.parent &&
      repoData.parent.owner &&
      repoData.parent.owner.login === owner
    ) {
      if (verbose) {
        console.log(`✅ Found fork: ${potentialFork} (fork of ${owner}/${repo})`);
      }
      return { user, repo };
    }

    // Even if not a fork (maybe they own the original), return it
    if (repoData.nameWithOwner === potentialFork) {
      if (verbose) {
        console.log(`✅ Found repository: ${potentialFork} (user owns this repo)`);
      }
      return { user, repo };
    }

    if (verbose) {
      console.log(`❌ Repository ${potentialFork} is not a fork of ${owner}/${repo}`);
    }
    return null;
  } catch (error) {
    // User doesn't have a repo with this name, or gh api failed
    if (verbose) {
      console.log(`⚠️  Fork check failed: ${error}`);
    }
    return null;
  }
}
