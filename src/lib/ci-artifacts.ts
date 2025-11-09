import { join } from 'path';
import { existsSync } from 'fs';
import { execa } from 'execa';
import { expandPath } from './config.js';
import { WorktreeMetadata } from '../types.js';
import { loadConfig } from './config.js';

interface CISummary {
  status: 'complete' | 'partial' | 'incomplete';
  [key: string]: unknown;
}

export function findCIConfigFile(repoName: string): string | null {
  const config = loadConfig();
  const projectsRoot = expandPath(config.projectsRoot);
  const configDir = join(projectsRoot, 'ci-artifacts-config');

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
  // Fetch if PR is failing OR no CI data exists yet
  const isFailing = prChecks === 'failing';
  const noCIData = !worktree.ci_last_synced;
  return isFailing || noCIData;
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
  const args = ['gh-ci-artifacts', String(ref), '--output-dir', outputDir, '--repo', repo];

  // Check for CI artifacts config file
  if (repoName) {
    const configFile = findCIConfigFile(repoName);
    if (configFile) {
      args.push('--config', configFile);
      if (options?.verbose) {
        console.log(`  📋 Using config: ${configFile}`);
      }
    }
  }

  if (resume) {
    args.push('--resume');
  }

  if (options?.verbose) {
    console.log(`🔄 Fetching CI artifacts for ${repo}/${ref}...`);
  }

  try {
    await execa('npx', args);
  } catch (error: unknown) {
    // Exit code 2 = incomplete (workflows still in progress), which is OK
    // Exit code 1 = partial success (some artifacts failed)
    // Exit code 0 = complete success
    const exitCode = (error as { exitCode?: number }).exitCode;
    if (exitCode !== 1 && exitCode !== 2) {
      if (options?.verbose) {
        console.log(`⚠️  CI artifact fetch failed: ${error}`);
      }
      throw error;
    }
    // For codes 1 and 2, continue - we have partial data
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

  // gh-ci-artifacts creates pr-XXX or branch-XXX subdirs
  // artifactsPath = ~/ci-artifacts/galaxy/pr-21250
  // actualSummaryPath = ~/ci-artifacts/galaxy/pr-21250/pr-21250/summary.json
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
