import { execa } from 'execa';

export interface GitInfo {
  remoteUrl: string;
  currentBranch: string;
  baseBranch: string;
  commitsAhead: number;
  commitsBehind: number;
  hasUncommittedChanges: boolean;
  lastCommitDate: string;
  trackingBranch: string | null;
  currentSha: string;
}

export async function getRemoteUrl(repoPath: string): Promise<string> {
  const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], {
    cwd: repoPath,
  });
  return stdout.trim();
}

export async function getUpstreamUrl(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'upstream'], {
      cwd: repoPath,
    });
    const url = stdout.trim();
    // If upstream remote doesn't exist, git returns the remote name (e.g., "upstream")
    // We only return if it's a valid URL
    if (url && url !== 'upstream' && (url.startsWith('http') || url.startsWith('git@'))) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoPath,
  });
  return stdout.trim();
}

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await execa('git', ['show-ref', '--quiet', `refs/heads/${branch}`], {
      cwd: repoPath,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getLastCommitDate(repoPath: string): Promise<string> {
  const { stdout } = await execa('git', ['log', '-1', '--format=%ci', 'HEAD'], { cwd: repoPath });
  return stdout.trim();
}

export async function getCommitsAheadBehind(
  repoPath: string,
  branch: string,
  baseBranch: string = 'origin/dev',
): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout: aheadStr } = await execa(
      'git',
      ['rev-list', '--count', `${baseBranch}..${branch}`],
      { cwd: repoPath },
    );
    const { stdout: behindStr } = await execa(
      'git',
      ['rev-list', '--count', `${branch}..${baseBranch}`],
      { cwd: repoPath },
    );
    return {
      ahead: parseInt(aheadStr.trim(), 10),
      behind: parseInt(behindStr.trim(), 10),
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  const { stdout } = await execa('git', ['status', '--porcelain'], {
    cwd: repoPath,
  });
  return stdout.trim().length > 0;
}

export async function getTrackingBranch(repoPath: string, branch: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['config', `branch.${branch}.merge`], { cwd: repoPath });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getCurrentSha(repoPath: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
  });
  return stdout.trim();
}

export async function getGitInfo(repoPath: string, branch: string): Promise<GitInfo> {
  const [remoteUrl, lastCommitDate, trackingBranch, hasUncommitted, currentSha] = await Promise.all(
    [
      getRemoteUrl(repoPath),
      getLastCommitDate(repoPath),
      getTrackingBranch(repoPath, branch),
      hasUncommittedChanges(repoPath),
      getCurrentSha(repoPath),
    ],
  );

  const { ahead, behind } = await getCommitsAheadBehind(repoPath, branch, 'origin/dev');

  return {
    remoteUrl,
    currentBranch: branch,
    baseBranch: 'dev',
    commitsAhead: ahead,
    commitsBehind: behind,
    hasUncommittedChanges: hasUncommitted,
    lastCommitDate,
    trackingBranch,
    currentSha,
  };
}

export async function baseBranchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    // Check local branch
    await execa('git', ['show-ref', '--quiet', `refs/heads/${branch}`], {
      cwd: repoPath,
    });
    return true;
  } catch {
    // Check remote branch
    try {
      await execa('git', ['show-ref', '--quiet', `refs/remotes/${branch}`], {
        cwd: repoPath,
      });
      return true;
    } catch {
      return false;
    }
  }
}

export async function suggestBaseBranches(
  repoPath: string,
  targetBranch: string,
): Promise<string[]> {
  try {
    // Get all branches (local and remote)
    const { stdout } = await execa('git', ['branch', '-a', '--format=%(refname:short)'], {
      cwd: repoPath,
    });

    const allBranches = stdout
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    // Common base branches to prioritize
    const commonBranches = [
      'main',
      'master',
      'dev',
      'develop',
      'origin/main',
      'origin/master',
      'origin/dev',
      'origin/develop',
      'upstream/main',
      'upstream/master',
      'upstream/dev',
      'upstream/develop',
    ];

    // Filter common branches that exist
    const existingCommon = commonBranches.filter((b) => allBranches.includes(b));

    // If target looks like a remote branch, suggest similar remotes
    const targetLower = targetBranch.toLowerCase();
    const fuzzyMatches = allBranches.filter((b) => {
      const bLower = b.toLowerCase();
      return bLower.includes(targetLower) || targetLower.includes(bLower);
    });

    // Combine: prioritize common, then fuzzy matches, then limit to 5
    const suggestions = [...new Set([...existingCommon, ...fuzzyMatches])].slice(0, 5);

    return suggestions;
  } catch {
    return [];
  }
}

export async function getImplicitBaseBranch(
  repoPath: string,
  targetBranch: string,
): Promise<string | null> {
  // Import getCurrentUser here to avoid circular dependency
  const { getCurrentUser } = await import('./github.js');

  // 1. Check if target branch exists locally in source repo
  try {
    const localExists = await branchExists(repoPath, targetBranch);
    if (localExists) {
      return targetBranch;
    }
  } catch {
    // Continue to next check
  }

  // 2. Check if origin/target-branch exists
  try {
    const originExists = await baseBranchExists(repoPath, `origin/${targetBranch}`);
    if (originExists) {
      return `origin/${targetBranch}`;
    }
  } catch {
    // Continue to next check
  }

  // 3. Check if user has a remote with their name and the target branch exists there
  try {
    const user = await getCurrentUser();
    const userRemoteExists = await baseBranchExists(repoPath, `${user}/${targetBranch}`);
    if (userRemoteExists) {
      return `${user}/${targetBranch}`;
    }
  } catch {
    // User not available or remote doesn't exist, return null
  }

  return null;
}
