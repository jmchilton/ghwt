import { join } from 'path';
import { existsSync } from 'fs';
import { getCiArtifactsConfigDir } from './config.js';
import { WorktreeMetadata } from '../types.js';
import { loadConfig } from './config.js';
import { runAction, loadConfig as loadGhCiArtifactsConfig, Logger } from 'gh-ci-artifacts';

interface CISummary {
  status: 'complete' | 'partial' | 'incomplete';
  [key: string]: unknown;
}

export function findCIConfigFile(repoName: string): string | null {
  const config = loadConfig();
  const configDir = getCiArtifactsConfigDir(config);

  // Check for .gh-ci-artifacts.yaml, .gh-ci-artifacts.yml, or .gh-ci-artifacts.json
  const configFiles = [
    join(configDir, repoName, '.gh-ci-artifacts.yaml'),
    join(configDir, repoName, '.gh-ci-artifacts.yml'),
    join(configDir, repoName, '.gh-ci-artifacts.json'),
  ];

  for (const filePath of configFiles) {
    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

export function getCIArtifactsPath(
  ciArtifactsDir: string,
  repoName: string,
  ref: string | number,
): string {
  return join(ciArtifactsDir, repoName, `pr-${ref}`);
}

export function shouldFetchArtifacts(
  worktree: Partial<WorktreeMetadata>,
  prChecks: string | undefined,
): boolean {
  // Fetch if PR is failing OR no CI data exists yet OR artifact path doesn't exist
  const isFailing = prChecks === 'failing';
  const noCIData = !worktree.ci_last_synced;
  const artifactsMissing =
    worktree.ci_artifacts_path && !existsSync(worktree.ci_artifacts_path as string);
  return isFailing || noCIData || !!artifactsMissing;
}

export function needsFullFetch(worktree: Partial<WorktreeMetadata>, currentSha: string): boolean {
  // Return true if we need full fetch (SHA changed)
  // Return false if we can use --resume (same SHA)
  return worktree.ci_head_sha !== currentSha;
}

export async function fetchCIArtifacts(
  ref: string | number,
  repo: string,
  outputDir: string,
  resume: boolean = false,
  repoName?: string,
  options?: { verbose?: boolean },
): Promise<void> {
  // Load gh-ci-artifacts config
  let ghCiConfig = await loadGhCiArtifactsConfig();

  // Check for CI artifacts config file and merge if found
  if (repoName) {
    const configFile = findCIConfigFile(repoName);
    if (configFile) {
      const userConfig = await loadGhCiArtifactsConfig(configFile);
      ghCiConfig = { ...ghCiConfig, ...userConfig };
      if (options?.verbose) {
        console.log(`  📋 Using config: ${configFile}`);
      }
    }
  }

  if (options?.verbose) {
    console.log(`🔄 Fetching CI artifacts for ${repo}/${ref}...`);
    console.log(`  📂 Output directory: ${outputDir}`);
  }

  try {
    // Create logger that respects verbose mode
    const logger = new Logger(options?.verbose ?? false);

    // Parse ref to determine if it's PR or branch
    const prNumber = /^\d+$/.test(String(ref)) ? parseInt(String(ref), 10) : undefined;
    const branchName = prNumber ? undefined : String(ref);

    // Call runAction (programmatic API) - orchestrates complete workflow
    const { summary } = await runAction(
      repo,
      prNumber,
      branchName,
      'origin',
      outputDir,
      ghCiConfig,
      logger,
      {
        resume,
        dryRun: false,
        includeSuccesses: false,
        wait: false,
        repoExplicitlyProvided: true,
      },
    );

    if (options?.verbose) {
      console.log(`  ✅ CI artifacts processed - Status: ${summary?.status || 'complete'}`);
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (options?.verbose) {
      console.log(`  ⚠️  CI artifacts error: ${errorMsg}`);
    }
    throw error;
  }
}

export async function parseCISummary(summaryPath: string): Promise<{
  status: string;
  failedTests: number;
  linterErrors: number;
}> {
  try {
    const { readFileSync } = await import('fs');
    const summary: CISummary = JSON.parse(readFileSync(summaryPath, 'utf-8'));

    let failedTests = 0;
    let linterErrors = 0;

    // Count failed tests from runs
    if (summary.runs && Array.isArray(summary.runs)) {
      for (const run of summary.runs) {
        if (run.artifacts && Array.isArray(run.artifacts)) {
          for (const artifact of run.artifacts) {
            if (
              artifact.type &&
              (artifact.type.includes('jest') ||
                artifact.type.includes('pytest') ||
                artifact.type.includes('playwright'))
            ) {
              failedTests += artifact.failureCount || 0;
            }
          }
        }
      }
    }

    // Count linter errors from logs
    if (summary.linterOutputs && Array.isArray(summary.linterOutputs)) {
      for (const output of summary.linterOutputs) {
        if (output.errorCount) {
          linterErrors += output.errorCount;
        }
      }
    }

    return {
      status: summary.status || 'unknown',
      failedTests,
      linterErrors,
    };
  } catch {
    return {
      status: 'unknown',
      failedTests: 0,
      linterErrors: 0,
    };
  }
}

export async function getCIMetadata(
  artifactsPath: string,
  currentSha: string,
): Promise<Partial<WorktreeMetadata>> {
  const { readdirSync } = await import('fs');
  let actualSummaryPath = '';

  // Check for summary.json directly in artifactsPath first
  const directSummaryPath = join(artifactsPath, 'summary.json');
  if (existsSync(directSummaryPath)) {
    actualSummaryPath = directSummaryPath;
  } else {
    // Fall back to checking for pr-XXX or branch-XXX subdirs
    try {
      if (existsSync(artifactsPath)) {
        const dirs = readdirSync(artifactsPath);
        const resultDir = dirs.find((d) => d.startsWith('pr-') || d.startsWith('branch-'));
        if (resultDir) {
          actualSummaryPath = join(artifactsPath, resultDir, 'summary.json');
        }
      }
    } catch {
      // Continue with empty path
    }
  }

  if (!actualSummaryPath || !existsSync(actualSummaryPath)) {
    return {
      ci_last_synced: new Date().toISOString(),
      ci_head_sha: currentSha,
      ci_status: 'incomplete',
    };
  }

  const { status, failedTests, linterErrors } = await parseCISummary(actualSummaryPath);

  // HTML viewer is at artifactsPath/pr-XXX/index.html (parent of summary.json)
  const { dirname } = await import('path');
  const resultDir = dirname(actualSummaryPath);
  const htmlViewerPath = join(resultDir, 'index.html');
  const ci_viewer_url = existsSync(htmlViewerPath) ? `file://${htmlViewerPath}` : undefined;

  return {
    ci_status: status as 'complete' | 'partial' | 'incomplete',
    ci_failed_tests: failedTests,
    ci_linter_errors: linterErrors,
    ci_artifacts_path: artifactsPath,
    ci_viewer_url,
    ci_last_synced: new Date().toISOString(),
    ci_head_sha: currentSha,
  };
}

export async function fetchAndUpdateCIMetadata(
  ref: string | number,
  ghRepo: string,
  artifactsPath: string,
  currentSha: string,
  repoName?: string,
  options?: { verbose?: boolean },
): Promise<Partial<WorktreeMetadata>> {
  const { mkdirSync } = await import('fs');

  // Create directory if it doesn't exist
  mkdirSync(artifactsPath, { recursive: true });

  // Fetch artifacts (always do full fetch for this operation)
  if (options?.verbose) {
    console.log(`  📦 Fetching CI artifacts...`);
  }

  await fetchCIArtifacts(ref, ghRepo, artifactsPath, false, repoName, options);

  // Parse CI metadata
  const ciMeta = await getCIMetadata(artifactsPath, currentSha);

  if (options?.verbose) {
    console.log(
      `  ✅ CI artifacts: ${ciMeta.ci_status} (${ciMeta.ci_failed_tests} test failures, ${ciMeta.ci_linter_errors} lint errors)`,
    );
  }

  return ciMeta;
}
