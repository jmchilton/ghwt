# Analyze CI Failures

Analyze the CI failures for the current worktree's PR and provide recommendations.

## Finding CI Artifacts

Run these commands to locate or fetch previously downloaded CI artifacts:

- **Find artifacts**: `ghwt path-ci-artifacts --this` - Shows where artifacts are stored locally for analysis
- **Fetch if missing**: `ghwt sync --this` - Downloads latest CI artifacts for the current worktree's PR

Once artifacts are available, use the analysis guide below.

## gh-ci-artifacts Output Guide

The artifacts are organized with the following directory structure (run `ghwt path-ci-artifacts --this` to find the root directory):

### Key Files (in priority order)

1. **`summary.json`** - Master overview with all metadata, download status, validation results, and statistics
2. **`catalog.json`** - Type detection results for all artifacts with `artifact.parsingGuide` containing AI-optimized parsing instructions for each artifact type
3. **`artifacts.json`** - Download inventory with artifact metadata

### Directory Structure

- **`converted/`** - Normalized artifacts (HTML/NDJSON/TXT → JSON) (PREFER THESE over originals)
  - Playwright HTML → JSON with test results, failures, traces
  - pytest-html → JSON with test outcomes, errors, durations
  - NDJSON formats normalized to JSON arrays
  - Text formats parsed and converted to JSON
- **`raw/`** - Original downloaded artifacts organized by `<run-id>/artifact-<id>/`
- **`linting/`** - Extracted linter outputs (ESLint, Prettier, Ruff, flake8, mypy, tsc, etc.) organized by `<run-id>/<job-name>-<linter>.txt`

### Important Context

- **By default, ONLY FAILURES are included** - all artifacts/logs represent failed or cancelled runs
- **Always check `converted/` first** - more structured and easier to parse than HTML/raw formats
- **Artifact IDs in paths** - `artifact-<id>` directories handle duplicate names from matrix builds
- **Latest retry only** - if workflows were retried, only the most recent attempt is included
- **Check `summary.json` for download status** - expired/failed artifacts noted in `downloadStatus` field

### Analyzing Failures

1. Start with `summary.json` to understand which workflows/jobs failed
2. Check `catalog.json` to find detected test framework types and **read the `artifact.parsingGuide` for AI-optimized instructions on how to consume each artifact type**
3. Look in `converted/` for structured JSON reports (preferred)
4. Check `linting/` for linter/compiler errors
5. Validate artifact integrity using `artifact.validation` status in `catalog.json`
6. Fall back to `raw/` only if converted versions unavailable

**Pro Tip:** When analyzing an artifact, include the `parsingGuide` from `catalog.json` in your Claude prompt. The parsing guide is specifically written for AI agents and contains:
- How to interpret the artifact structure
- Key fields to focus on for failure analysis
- Caveats and edge cases
- Best practices for consumption

### Common Patterns

- Test failures: Check `converted/*.json` for test names, error messages, stack traces
- Linter errors: Check `linting/<run-id>/<job>-eslint.txt`, etc.
- Type errors: Check `linting/<run-id>/<job>-tsc.txt` or `<job>-mypy.txt`
- Build failures: Look in `raw/` for build logs if no linter output extracted
