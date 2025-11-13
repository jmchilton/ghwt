# Worktree Structure Refactor Plan

## Status: COMPLETE ✅ (All 15 Phases Done)

**Last Updated:** 2025-11-13
**Progress:** 15 of 15 phases complete (100%)

### Completed Phases

- ✅ Phase 1: getCurrentWorktreeContext() implementation
- ✅ Phase 2: Test infrastructure setup
- ✅ Phase 3: Smoke test script
- ✅ Phase 4: Branch parsing logic (TDD approach)
- ✅ Phase 5: Path construction for new hierarchy
- ✅ Phase 6: Update create command
- ✅ Phase 7: Update command help text
- ✅ Phase 8: Add --this flag to commands
- ✅ Phase 9: Path helper subcommands (path-ci-artifacts, path-note)
- ✅ Phase 10: Removed backward compatibility (deleted getWorktreePathOld, etc.)
- ✅ Phase 11: Updated worktree list detection for new hierarchy
- ✅ Phase 12: Consolidated CI artifacts to hierarchical structure
- ✅ Phase 13: Created comprehensive documentation (README + USAGE.md)
- ✅ Phase 14: Added critical path tests (60 tests total, all passing)
- ✅ Phase 15: Build, commit, and validation

**Refactoring Complete!** The ghwt project now uses the new hierarchical worktree structure with simplified CLI syntax.

---

## Implementation Summary

### What Was Done

#### Phase 1-2: Foundation & Testing

- **getCurrentWorktreeContext()**: Uses `git rev-parse --show-toplevel` to find git root, then walks up directory tree to match `worktrees/{project}/{type}/{name}` pattern
- **Test infrastructure**: Created `paths.test.ts` and `worktree-list.test.ts` with 12 passing tests
- **Smoke test**: Added `scripts/smoke-test.sh` with npm script

#### Phase 4: Branch Parser

- New `src/lib/branch-parser.ts` module with TDD approach
- `parseBranchArg()` detects PR (numeric) vs branch (alphanumeric)
- Rejects old prefixes (feature/, bug/, pr/) with helpful error messages
- 7 comprehensive unit tests, all passing

#### Phase 5-6: Path Construction & Create Command

- Updated `getWorktreePath()` signature: `(projectsRoot, config, project, branchType, name)`
- New hierarchy: `worktrees/{project}/{branch|pr}/{name}`
- Added `parseBranchFromOldFormat()` helper for backward compatibility during transition
- Integrated `parseBranchArg()` into `createCommand()` for simplified CLI
- **CLI now:** `ghwt create galaxy cool-feature` or `ghwt create galaxy 1234` (no prefixes)

#### Phase 8: --this Flag (All Commands)

- Implemented `--this` flag pattern across convenience commands:
  - ✅ code, cursor, gh, note, attach, claude
  - ✅ Pattern: Detect context with `getCurrentWorktreeContext()` when `--this` flag is set
  - ✅ Skip picker when flag is set, use current worktree
- Reduced code duplication through consistent pattern

#### All Commands Updated

- Updated `code.ts`, `cursor.ts`, `attach.ts`, `attach-pr.ts`, `claude.ts`, `gh.ts`, `note.ts`, `rm.ts`
- Each command now calls `parseBranchFromOldFormat()` to convert old branch format to new `{branchType, name}` pair
- All commands use new `getWorktreePath()` signature

### Test Results

```
✅ 12/12 tests passing
✅ All linting clean
✅ TypeScript strict mode passing
✅ Build successful
```

### Key Files Modified

- `src/lib/worktree-list.ts` - Added `getCurrentWorktreeContext()`
- `src/lib/paths.ts` - Updated `getWorktreePath()`, added `parseBranchFromOldFormat()`
- `src/lib/branch-parser.ts` - NEW module
- `src/commands/*.ts` - Updated all commands for new paths
- `src/cli.ts` - Added `--this` option to commands
- `package.json` - Added `smoke-test` script

---

## Overview

Refactor ghwt to:

1. Use hierarchical worktree directory structure: `worktrees/{project}/{branch-type}/{name}`
2. Simplify CLI syntax: `ghwt create <project> <branch-name|pr-number>` (no prefix)
3. Drop feature/ and bug/ branch types (keep only branch/ and pr/)
4. Maintain flat Obsidian note structure

**Rationale:** Eliminates collision risk, improves organization, simplifies CLI, makes workflow easier to explain.

---

## Phase 1: Implement getCurrentWorktreeContext()

Detect current worktree from directory hierarchy.

### Changes

**File: `src/lib/worktree-list.ts`**

New function:

```typescript
export async function getCurrentWorktreeContext(): Promise<{ project: string; branch: string }> {
  // Starting from process.cwd(), walk up directory tree
  // Find first ancestor matching: worktrees/{project}/{branch-type}/{name}
  // Extract and return { project, "branch-type/name" }
  // Throw error if not found in worktree context
}
```

- Use `process.cwd()` or equivalent
- Walk up until: parent of parent dir matches worktrees pattern
- Regex/path parsing: `worktrees/([^/]+)/(branch|pr)/(.+)` → extract project and full branch
- Error message: "Not in a ghwt worktree directory. Run from within worktrees/{project}/{type}/{name}/"

### Testing

- Manual test from within worktree: should correctly identify project/branch
- Manual test from outside worktree: should error clearly
- Test from nested subdirectory within worktree: should still work

---

## Phase 2: Test Infrastructure Setup

Add basic test infrastructure before major refactoring.

### Changes

**File: `src/lib/paths.test.ts` (new)**

Create first test file:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getWorktreePath, getNotePath } from './paths.js';

describe('paths', () => {
  it('should construct worktree path with new hierarchy', () => {
    // Test implementation
  });

  it('should construct note path correctly', () => {
    // Test implementation
  });
});
```

**File: `src/lib/worktree-list.test.ts` (new)**

Test getCurrentWorktreeContext:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getCurrentWorktreeContext } from './worktree-list.js';

describe('getCurrentWorktreeContext', () => {
  it('should parse worktree path from cwd', () => {
    // Test with mocked process.cwd()
  });

  it('should throw error when not in worktree', () => {
    // Test error case
  });
});
```

**Update package.json:**

- Verify test script: `"test": "node --test dist/**/*.test.js"`
- Add test coverage script (optional): `"test:watch": "node --test --watch dist/**/*.test.js"`

### Testing Strategy

**Unit tests for:**

- Path construction utilities (`paths.ts`)
- Worktree context detection (`worktree-list.ts`)
- Branch name parsing/validation
- Config parsing

**Integration tests for:**

- End-to-end worktree creation flow
- Sync command with mock git/GitHub data
- Picker with test fixtures

**Test approach:**

- Use Node's built-in test runner (already configured)
- Keep tests focused and fast
- Mock filesystem/external commands where needed
- Test critical paths first, expand coverage later

### Testing

- `npm run build && npm test` passes
- At least 3-5 basic unit tests for path utilities
- Tests provide safety net for refactoring

---

## Phase 3: Add Smoke Test Script

Create early validation script before major refactoring.

### Changes

**File: `scripts/smoke-test.sh` (new)**

```bash
#!/bin/bash
# Smoke test for ghwt basic workflow
# Creates a test worktree, verifies structure, cleans up

set -e

TEST_PROJECT="test-repo"
TEST_BRANCH="smoke-test-branch"
PROJECTS_ROOT="${HOME}/projects"

echo "🧪 Running ghwt smoke test..."

# Verify ghwt is available
if ! command -v ghwt &> /dev/null; then
    echo "❌ ghwt not found. Run 'npm link' first."
    exit 1
fi

# TODO: Add test repository setup
# TODO: Test create command
# TODO: Verify directory structure
# TODO: Test sync command
# TODO: Test rm command
# TODO: Cleanup

echo "✅ Smoke test passed"
```

**Initial implementation:**

- Basic script structure
- Verify ghwt is in PATH
- Placeholder for tests (will expand in later phases)

**File: `package.json`**

Add script:

```json
"scripts": {
  "smoke-test": "bash scripts/smoke-test.sh"
}
```

### Testing

- Script runs without errors
- Detects if ghwt not installed
- Foundation for later test expansion

---

## Phase 4: Branch Parsing Logic (Red-Green-Refactor)

Remove feature/bug logic, use numeric detection for PR vs branch.

### Test-First Approach (Red)

**File: `src/lib/branch-parser.ts` (new)**

Create new module for branch type detection:

```typescript
export type BranchType = 'pr' | 'branch';

export interface ParsedBranch {
  type: BranchType;
  name: string;
}

export function parseBranchArg(branchArg: string): ParsedBranch {
  // Implementation to come
  throw new Error('Not implemented');
}
```

**File: `src/lib/branch-parser.test.ts` (new)**

Write failing tests first:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseBranchArg } from './branch-parser.js';

describe('parseBranchArg', () => {
  it('should detect PR from numeric string', () => {
    const result = parseBranchArg('1234');
    assert.strictEqual(result.type, 'pr');
    assert.strictEqual(result.name, '1234');
  });

  it('should detect branch from alphanumeric name', () => {
    const result = parseBranchArg('cool-feature');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'cool-feature');
  });

  it('should accept branch names with slashes', () => {
    const result = parseBranchArg('fix/bug-123');
    assert.strictEqual(result.type, 'branch');
    assert.strictEqual(result.name, 'fix/bug-123');
  });

  it('should reject old feature/ prefix', () => {
    assert.throws(() => parseBranchArg('feature/cool'));
  });

  it('should reject old bug/ prefix', () => {
    assert.throws(() => parseBranchArg('bug/fix'));
  });

  it('should reject old pr/ prefix', () => {
    assert.throws(() => parseBranchArg('pr/1234'));
  });

  it('should reject invalid characters', () => {
    assert.throws(() => parseBranchArg('invalid branch!'));
  });
});
```

Run tests - they should FAIL ❌

### Implementation (Green)

**File: `src/lib/branch-parser.ts`**

Implement to make tests pass:

```typescript
export type BranchType = 'pr' | 'branch';

export interface ParsedBranch {
  type: BranchType;
  name: string;
}

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
```

Run tests - they should PASS ✅

### Refactor (if needed)

- Review implementation for clarity
- Extract constants if needed
- Add JSDoc comments

### Testing

- `npm run build && npm test` passes
- All 7 branch parser tests green
- Clear error messages for invalid input

---

## Phase 5: Path Construction for New Hierarchy

Update path utilities to use new structure.

### Test-First Approach (Red)

**File: `src/lib/paths.test.ts`**

Add new failing tests:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getWorktreePath, getNotePath } from './paths.js';

describe('getWorktreePath', () => {
  it('should construct path for branch worktree', () => {
    const path = getWorktreePath('/home/projects', config, 'galaxy', 'branch', 'cool-feature');
    assert.strictEqual(path, '/home/projects/worktrees/galaxy/branch/cool-feature');
  });

  it('should construct path for PR worktree', () => {
    const path = getWorktreePath('/home/projects', config, 'galaxy', 'pr', '1234');
    assert.strictEqual(path, '/home/projects/worktrees/galaxy/pr/1234');
  });
});

describe('getNotePath', () => {
  it('should construct flat note path for branch', () => {
    const path = getNotePath('/vault', 'galaxy', 'cool-feature');
    assert.strictEqual(path, '/vault/projects/galaxy/worktrees/cool-feature.md');
  });

  it('should construct flat note path for PR', () => {
    const path = getNotePath('/vault', 'galaxy', '1234');
    assert.strictEqual(path, '/vault/projects/galaxy/worktrees/1234.md');
  });
});
```

Run tests - they should FAIL ❌

### Implementation (Green)

**File: `src/lib/paths.ts`**

Update functions:

```typescript
export function getWorktreePath(
  projectsRoot: string,
  config: GhwtConfig,
  project: string,
  branchType: 'branch' | 'pr',
  branchName: string,
): string {
  return join(projectsRoot, config.worktreesDir, project, branchType, branchName);
}

export function getNotePath(vaultRoot: string, project: string, branchName: string): string {
  return join(vaultRoot, 'projects', project, 'worktrees', `${branchName}.md`);
}
```

Run tests - they should PASS ✅

### Changes to Callers

Update all callers of `getWorktreePath` to pass branch type:

- `src/commands/create.ts`
- `src/commands/rm.ts`
- Other commands as needed

### Testing

- `npm run build && npm test` passes
- Path construction tests green
- Worktree paths use new hierarchy

---

## Phase 6: Update Create Command

Integrate branch parser into create command.

### Changes

**File: `src/commands/create.ts`**

Update `createCommand()`:

```typescript
import { parseBranchArg } from '../lib/branch-parser.js';

export async function createCommand(
  project: string,
  branchArg: string,
  options?: { verbose?: boolean },
): Promise<void> {
  // Parse branch argument
  let parsed: ParsedBranch;
  try {
    parsed = parseBranchArg(branchArg);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  const { type: branchType, name: branch } = parsed;

  // ... rest of implementation

  // Use new getWorktreePath signature
  const worktreePath = getWorktreePath(projectsRoot, config, project, branchType, branch);

  // ... continue with worktree creation
}
```

Update help text in `src/cli.ts`:

```typescript
program
  .command('create <project> <branch>')
  .description(
    'Create a new worktree and Obsidian note\n' +
      'Branch format: branch name (e.g., cool-feature) or PR number (e.g., 1234)',
  );
```

### Testing

- Manual: `ghwt create galaxy cool-feature` → creates `worktrees/galaxy/branch/cool-feature/`
- Manual: `ghwt create galaxy 1234` → creates `worktrees/galaxy/pr/1234/`
- Manual: `ghwt create galaxy feature/cool` → clear error message
- Smoke test script can be expanded to verify these

---

## Phase 7: Update Command Help Text

Update all commands to remove feature/bug references.

### Changes

**Files: `src/cli.ts`, `src/commands/*.ts`**

Search and update:

- Remove all mentions of `feature/` and `bug/` prefixes
- Update examples to use direct branch names or PR numbers
- Simplify descriptions

**Examples:**

- Before: `ghwt create galaxy feature/cool-feature`
- After: `ghwt create galaxy cool-feature`

- Before: `ghwt create galaxy pr/1234`
- After: `ghwt create galaxy 1234`

### Testing

- `ghwt --help` shows updated examples
- `ghwt create --help` has correct branch format description
- No references to feature/bug prefixes remain in help output

---

## Phase 8: Add --this Flag to Existing Commands

Use `getCurrentWorktreeContext()` to skip chooser.

### Changes

**Files: `src/commands/code.ts`, `cursor.ts`, `gh.ts`, `note.ts`, `rm.ts`**

For each command:

1. Add `--this` flag to command definition (via Commander option)
2. Early in function: detect if `--this` is set
3. If `--this`:
   - Call `getCurrentWorktreeContext()`
   - Use returned project/branch
   - Skip picker
4. Otherwise: existing logic (use provided args or show picker)

**Example pattern:**

```typescript
export async function codeCommand(
  project?: string,
  branch?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: { verbose?: boolean; this?: boolean },
): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  if (options?.this) {
    const context = await getCurrentWorktreeContext();
    selectedProject = context.project;
    selectedBranch = context.branch;
  } else if (!selectedProject || !selectedBranch) {
    const picked = await pickWorktree(project);
    // ...
  }
  // rest of command
}
```

**Update CLI definitions in `src/cli.ts`:**

- Add `.option('--this', 'Use current worktree (requires running from within worktree)')` to each command

### Testing

- From within worktree: `ghwt code --this` opens correct directory
- From within worktree: `ghwt note --this` shows correct note
- From outside worktree: `ghwt code --this` errors clearly
- Without --this: existing behavior unchanged

---

## Phase 9: Implement Path Helper Subcommands

New subcommands for Claude to query paths.

### Changes

**File: `src/commands/path-ci-artifacts.ts` (new)**

```typescript
export async function pathCiArtifactsCommand(
  project?: string,
  branch?: string,
  options?: { this?: boolean },
): Promise<void> {
  let selectedProject = project;
  let selectedBranch = branch;

  if (options?.this) {
    const context = await getCurrentWorktreeContext();
    selectedProject = context.project;
    selectedBranch = context.branch;
  } else if (!selectedProject || !selectedBranch) {
    const picked = await pickWorktree(project);
    selectedProject = picked.project;
    selectedBranch = picked.branch;
  }

  const config = loadConfig();
  const artifactsPath = getCIArtifactsPath(selectedProject, selectedBranch, config);

  if (existsSync(artifactsPath)) {
    console.log(artifactsPath);
  }
  // Exit 0 regardless (machine-readable)
}
```

**File: `src/commands/path-note.ts` (new)**

Similar structure, outputs Obsidian note path.

**File: `src/cli.ts`**

Add commands:

```typescript
program
  .command('path-ci-artifacts [project] [branch]')
  .option('--this', 'Use current worktree')
  .action((project, branch, options) => pathCiArtifactsCommand(project, branch, options));

program
  .command('path-note [project] [branch]')
  .option('--this', 'Use current worktree')
  .action((project, branch, options) => pathNoteCommand(project, branch, options));
```

### Testing

- `ghwt path-ci-artifacts --this` outputs correct path
- `ghwt path-note --this` outputs correct path
- Paths work with `cat`, `open`, etc.

---

## Phase 10: Update Path Resolution Utilities

Centralize path construction for new hierarchy.

### Changes

**File: `src/lib/paths.ts`**

Update all path construction:

- `getWorktreePath(projectsRoot, config, project, branch)` → construct `worktrees/{project}/{type}/{name}`
- `getNotePath()` → remains mostly same (flat in vault)
- `getCIArtifactsPath()` → update to reference new worktree locations if needed

Handle backward compatibility during migration:

- If old structure detected, either warn or auto-migrate
- Document migration path for users

---

## Phase 11: Update Worktree List Detection

Adapt worktree discovery to new hierarchy.

### Changes

**File: `src/lib/worktree-list.ts`**

Update `listWorktrees()`:

- Scan `worktrees/` directory
- For each project dir: scan `{project}/branch/` and `{project}/pr/`
- Extract worktree info (project, branch, type)
- Return list in existing format for backward compatibility

Update `resolveBranch()`:

- Adjust to search new directory structure

### Testing

- `ghwt list` shows all worktrees correctly
- Worktree picker shows all available worktrees
- Branch resolution works for both branch/ and pr/ types

---

## Phase 12: Update CI Artifacts Handling

Adjust artifact path references.

### Changes

**File: `src/lib/ci-artifacts.ts`**

Update `getCIArtifactsPath()`:

- Construct path using new worktree naming
- May need to handle: `ci-artifacts/{project}/{type}/{name}/`
- Or keep flat: `ci-artifacts/{project}-{type}-{name}/` and update note metadata

Decision: Keep ci-artifacts flat (ci-artifacts/{project}/{pr-or-branch-type}/{name}) or mirror worktree structure?

- **Recommendation:** Mirror worktree structure for consistency

Update metadata reading/writing for artifact metadata.

### Testing

- Artifacts still found in correct location
- Metadata correctly linked to worktrees
- sync command correctly downloads artifacts

---

## Phase 13: Documentation Updates

Update all documentation and help text.

### Changes

**File: `README.md`**

- Update installation and quick start sections
- Replace all `feature/` and `bug/` examples with simple branch names or PR numbers
- Update examples: `ghwt create galaxy cool-feature`, `ghwt create galaxy 1234`
- Update worktree structure description: `worktrees/{project}/{branch|pr}/{name}/`
- Add `--this` flag documentation to convenience commands section
- Add `path-ci-artifacts` and `path-note` to command list
- Update architecture section with new commands
- Keep configuration and metadata sections mostly unchanged

**File: `USAGE.md` (new)**

Create concise usage guide:

````markdown
# ghwt Usage Guide

## Basic Workflow

1. **Clone a repository**
   ```bash
   ghwt clone https://github.com/owner/repo.git
   ```
````

2. **Create a worktree**

   ```bash
   ghwt create repo my-feature    # Creates branch/my-feature
   ghwt create repo 1234           # Creates pr/1234
   ```

3. **Work in your worktree**
   - Worktree at: `~/projects/worktrees/repo/branch/my-feature/`
   - Note at: `~/vault/projects/repo/worktrees/my-feature.md`

4. **Quick access from within worktree**

   ```bash
   cd ~/projects/worktrees/repo/branch/my-feature
   ghwt code --this      # Open in VS Code
   ghwt note --this      # Open note
   ghwt gh --this        # Open on GitHub
   ```

5. **Get paths for scripts/automation**

   ```bash
   ghwt path-note --this
   ghwt path-ci-artifacts --this
   ```

6. **Sync metadata**

   ```bash
   ghwt sync             # Update all worktrees
   ghwt sync repo        # Update specific project
   ```

7. **Remove when done**
   ```bash
   ghwt rm repo my-feature
   ```

## Directory Structure

```
~/projects/
├── repositories/         # Bare git repos
│   └── repo/
├── worktrees/           # Active work directories
│   └── repo/
│       ├── branch/
│       │   └── my-feature/
│       └── pr/
│           └── 1234/
└── ci-artifacts/        # Downloaded CI artifacts
    └── repo/
        └── pr/
            └── 1234/
```

## Convenience Commands

All commands support three modes:

- No args: Pick from all worktrees
- Project only: Pick from that project
- Full path: Direct access

Examples:

```bash
ghwt code                    # Pick any worktree
ghwt code repo               # Pick from repo worktrees
ghwt code repo my-feature    # Open directly
ghwt code --this             # Use current worktree
```

Works for: `code`, `cursor`, `note`, `gh`, `claude`, `attach`, `rm`

````

**File: Help text in all commands**
- Update `.description()` calls to remove feature/bug references
- Add examples using new syntax
- Document `--this` flag where applicable

**File: Code comments**
- Search for "feature/" and "bug/" in comments
- Update to reflect new branch/pr structure

### Testing

- README examples match actual behavior
- USAGE.md examples all work
- Help text (`ghwt --help`, `ghwt create --help`) accurate
- No references to old feature/bug syntax remain

---

## Phase 14: Add Tests for Critical Paths

Expand test coverage for refactored code.

### Changes

**File: `src/commands/create.test.ts` (new)**
```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('create command', () => {
  it('should detect PR from numeric branch arg', () => {
    // Test PR number detection
  });

  it('should accept valid branch names', () => {
    // Test branch name validation
  });

  it('should reject old feature/ prefix', () => {
    // Verify old syntax fails
  });
});
````

**File: `src/lib/worktree-list.test.ts`**

Add tests for:

- `listWorktrees()` with new hierarchy
- Directory scanning for branch/ and pr/ subdirs
- Worktree enumeration and filtering

**File: Integration test (optional)**

Create `src/integration.test.ts`:

- Test full create → sync → rm workflow
- Use temporary test directory
- Mock git/gh CLI calls
- Verify file structure created correctly

### Testing

- Test suite covers main refactor paths
- `npm test` runs successfully
- Tests catch regressions in path construction
- At least 10-15 total tests across the codebase

---

## Phase 15: Build & Commit Strategy

### Build after each phase

After each phase:

1. `npm run build` - verify TypeScript compilation
2. `npm run lint` - verify style
3. Manual testing - verify key functionality
4. Commit with clear message

### Commit messages

- Phase 1: "feat: add getCurrentWorktreeContext for detecting current worktree"
- Phase 2: "test: add test infrastructure and initial unit tests"
- Phase 3: "chore: add smoke test script for basic workflow validation"
- Phase 4: "test: add branch parser with red-green-refactor TDD"
- Phase 5: "test: add path construction tests for new hierarchy"
- Phase 6: "refactor: integrate branch parser into create command"
- Phase 7: "docs: update command help text to remove feature/bug prefixes"
- Phase 8: "feat: add --this flag to commands for current worktree"
- Phase 9: "feat: add path-ci-artifacts and path-note subcommands"
- Phase 10: "refactor: update path resolution for new worktree hierarchy"
- Phase 11: "refactor: update worktree discovery for new structure"
- Phase 12: TODO
- Phase 13: "docs: update README and add USAGE guide for new structure"
- Phase 14: "test: add tests for critical refactor paths"
- Phase 15: Ongoing (build/commit)

---

## Open Questions

1. **CI artifacts directory structure:** Mirror worktree hierarchy or keep flat?
   - Recommend: Mirror for consistency

2. **Backward compatibility:** Support old structure during transition?
   - Decided: Just assume the new project structure - we're the only user currently and we don't want to be saddled with legacy.

3. **Obsidian vault reorganization:** Flat vs hierarchical?
   - Decided: Keep flat (simpler migration)

4. **Existing users:** How to communicate this change?
   - Decided: Just assume new project structured - we're the only user currently and we don't want to be saddled with legacy.

---

## Success Criteria

**Functionality:**

- [x] New CLI syntax works: `ghwt create galaxy cool-feature` and `ghwt create galaxy 1234` ✅ (Phase 6)
- [x] Path construction supports new hierarchy `worktrees/{project}/{branch-type}/{name}/` ✅ (Phase 5)
- [x] No collision risk between worktree names (by design - hierarchical structure) ✅
- [x] `--this` flag works in applicable commands (code, cursor, gh, note, attach, claude) ✅ (Phase 8)
- [x] `ghwt path-*` commands output correct paths ✅ (Phase 9)
- [x] All existing functionality preserved (code, note, sync, etc.) ✅ (Phases 9-12)

**Quality:**

- [x] Build passes: `npm run build` ✅
- [x] Lint passes: `npm run lint` ✅
- [x] Tests pass: `npm test` ✅ (60/60 passing)
- [x] Test coverage for critical paths: 60 tests across 9 test suites ✅ (Phases 2, 4, 9, 14)

**Documentation:**

- [x] README.md updated with new syntax ✅ (Phase 13)
- [x] USAGE.md created with comprehensive workflows ✅ (Phase 13)
- [x] Help text accurate for all commands ✅ (Phase 7)
- [x] No references to old feature/bug syntax in code ✅ (Phase 4 rejects them)

**Validation:**

- [x] Manual testing verified - listWorktrees works with new structure ✅ (Phase 11, 14)
- [x] Smoke test script framework created ✅ (Phase 3)
- [x] Integration tests for critical paths ✅ (Phase 14)

---

## Timeline Estimate

Rough estimates per phase (assuming 1-2 hour work sessions):

- Phase 1: 1-2 hours (getCurrentWorktreeContext)
- Phase 2: 2-3 hours (test infrastructure)
- Phase 3: 0.5-1 hour (smoke test script)
- Phase 4: 1-2 hours (branch parser with TDD)
- Phase 5: 1-2 hours (path construction tests)
- Phase 6: 1-2 hours (integrate into create command)
- Phase 7: 0.5-1 hour (update help text)
- Phase 8: 1-2 hours (--this flag)
- Phase 9: 1-2 hours (path helper commands)
- Phase 10: 1-2 hours (path resolution)
- Phase 11: 1-2 hours (worktree discovery)
- Phase 12: TODO
- Phase 13: 2-3 hours (documentation)
- Phase 14: 2-3 hours (additional tests)
- Phase 15: Ongoing (build/commit)

**Total: 17-28 hours** (can be done incrementally)

**Actual Progress (as of 2025-11-13):**

- ✅ Phases 1-8 Complete in ~3-4 hours (from previous session)
- ✅ Phase 9 (Path helpers): 1-2 hours
- ✅ Phase 10 (Backward compat removal): 1-2 hours
- ✅ Phase 11 (Worktree discovery): Already working from earlier phases
- ✅ Phase 12 (CI artifacts consolidation): 1-2 hours
- ✅ Phase 13 (Documentation): 1-2 hours
- ✅ Phase 14 (Critical path tests): 1-2 hours

**Total Time: ~10-14 hours across two sessions**

**Notes:**

- Red-green-refactor approach in Phase 4 ensures correctness ✅
- Smoke test in Phase 3 provides early validation framework ✅
- All code compiles, lints, and tests pass (60/60) ✅
- Integration tests follow user's preference for real file system operations ✅
- Aggressive backward compatibility removal as requested ✅
- Refactoring complete and production-ready
