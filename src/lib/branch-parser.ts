export type BranchType = 'pr' | 'branch';

export interface ParsedBranch {
  type: BranchType;
  name: string;
}

/**
 * Parse branch argument to detect type (PR vs branch) and validate format
 *
 * Rules:
 * - All-digit strings are treated as PR numbers
 * - Alphanumeric strings (with hyphens, underscores, slashes) are branch names
 * - Old prefixes (feature/, bug/, pr/) are rejected with helpful errors
 * - Invalid characters are rejected
 *
 * @param branchArg The branch argument to parse
 * @returns ParsedBranch with type and name
 * @throws Error if format is invalid
 */
export function parseBranchArg(branchArg: string): ParsedBranch {
  // Reject old prefixes explicitly
  if (
    branchArg.startsWith('feature/') ||
    branchArg.startsWith('bug/') ||
    branchArg.startsWith('pr/')
  ) {
    throw new Error(
      `Invalid branch format: "${branchArg}". ` +
        `Use branch name directly (e.g., "cool-feature") or PR number (e.g., "1234").`,
    );
  }

  // Check if it's a PR (all digits)
  if (/^\d+$/.test(branchArg)) {
    return { type: 'pr', name: branchArg };
  }

  // Validate branch name characters
  if (/^[a-zA-Z0-9\-_/]+$/.test(branchArg)) {
    return { type: 'branch', name: branchArg };
  }

  throw new Error(
    `Invalid branch name: "${branchArg}". ` +
      `Use only letters, numbers, hyphens, underscores, and slashes.`,
  );
}
