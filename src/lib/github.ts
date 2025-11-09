import { execa } from "execa";

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

export async function getPRInfo(
  prNumber: number | string,
  repo?: string
): Promise<PRInfo> {
  const prNum = String(prNumber);

  try {
    const args = [
      "pr",
      "view",
      prNum,
      "--json",
      "number,state,statusCheckRollup,reviews,labels,updatedAt,url,headRefName",
    ];

    if (repo) {
      args.push("--repo", repo);
    }

    const { stdout: prJson } = await execa("gh", args, {
      cwd: repo ? undefined : process.cwd(),
    });

    const prData = JSON.parse(prJson);

    // Determine checks status
    let checksStatus = "unknown";
    if (prData.statusCheckRollup && prData.statusCheckRollup.length > 0) {
      const statuses = prData.statusCheckRollup.map(
        (check: { conclusion: string }) => check.conclusion
      );
      if (statuses.includes("FAILURE")) checksStatus = "failing";
      else if (statuses.includes("PENDING")) checksStatus = "pending";
      else checksStatus = "passing";
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
  body?: string
): Promise<{ url: string; number: number }> {
  try {
    const args = ["pr", "create", "--head", branch];
    if (title) args.push("--title", title);
    if (body) args.push("--body", body);

    const { stdout: prJson } = await execa("gh", [
      ...args,
      "--json",
      "url,number",
    ]);

    const prData = JSON.parse(prJson);
    return { url: prData.url, number: prData.number };
  } catch (error) {
    throw new Error(`Failed to create PR: ${error}`);
  }
}
