import { execa } from "execa";
import { join } from "path";

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
  const { stdout } = await execa("git", ["remote", "get-url", "origin"], {
    cwd: repoPath,
  });
  return stdout.trim();
}

export async function isBareRepository(repoPath: string): Promise<boolean> {
  const { stdout } = await execa("git", ["rev-parse", "--is-bare-repository"], {
    cwd: repoPath,
  });
  return stdout.trim() === "true";
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
  });
  return stdout.trim();
}

export async function branchExists(
  repoPath: string,
  branch: string
): Promise<boolean> {
  try {
    await execa("git", ["show-ref", "--quiet", `refs/heads/${branch}`], {
      cwd: repoPath,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getLastCommitDate(repoPath: string): Promise<string> {
  const { stdout } = await execa(
    "git",
    ["log", "-1", "--format=%ci", "HEAD"],
    { cwd: repoPath }
  );
  return stdout.trim();
}

export async function getCommitsAheadBehind(
  repoPath: string,
  branch: string,
  baseBranch: string = "origin/dev"
): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout: aheadStr } = await execa(
      "git",
      ["rev-list", "--count", `${baseBranch}..${branch}`],
      { cwd: repoPath }
    );
    const { stdout: behindStr } = await execa(
      "git",
      ["rev-list", "--count", `${branch}..${baseBranch}`],
      { cwd: repoPath }
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
  const { stdout } = await execa("git", ["status", "--porcelain"], {
    cwd: repoPath,
  });
  return stdout.trim().length > 0;
}

export async function getTrackingBranch(
  repoPath: string,
  branch: string
): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "git",
      ["config", `branch.${branch}.merge`],
      { cwd: repoPath }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getCurrentSha(repoPath: string): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", "HEAD"], {
    cwd: repoPath,
  });
  return stdout.trim();
}

export async function getGitInfo(
  repoPath: string,
  branch: string
): Promise<GitInfo> {
  const [remoteUrl, lastCommitDate, trackingBranch, hasUncommitted, currentSha] =
    await Promise.all([
      getRemoteUrl(repoPath),
      getLastCommitDate(repoPath),
      getTrackingBranch(repoPath, branch),
      hasUncommittedChanges(repoPath),
      getCurrentSha(repoPath),
    ]);

  const { ahead, behind } = await getCommitsAheadBehind(
    repoPath,
    branch,
    "origin/dev"
  );

  return {
    remoteUrl,
    currentBranch: branch,
    baseBranch: "dev",
    commitsAhead: ahead,
    commitsBehind: behind,
    hasUncommittedChanges: hasUncommitted,
    lastCommitDate,
    trackingBranch,
    currentSha,
  };
}
