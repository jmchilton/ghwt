# ghwt

Worktree-centered development task dashboard with Obsidian integration.

## Features

- **Worktree Management**: Create, track, and remove git worktrees for branches and PRs
- **Worktree Picker**: Interactive CLI menu for quick selection with fuzzy search and smart filtering
- **Convenience Commands**: Quick access to code editor, notes, GitHub, and Claude
- **Claude Sessions**: Per-worktree Claude Code conversations with independent history and resume support
- **CI Artifact Integration**: Auto-fetch GitHub Actions artifacts for failing PRs with smart resume mode
- **Obsidian Integration**: Auto-generate markdown notes with rich metadata for each worktree
- **Live Dashboard**: Dataview-powered dashboards showing active work, CI failures, needs attention, ready to merge
- **Automated Sync**: Continuously sync metadata from git, GitHub API, and CI artifacts
- **Multi-Project**: Manage worktrees across multiple repositories

## Installation

```bash
npm install -g ghwt
# or link locally for development
npm link
```

## Quick Start

### Initialize workspace

```bash
ghwt init --vaults-path ~/my-obsidian-vaults --vault-name ghwt
```

**Options:**

- `--vaults-path <path>` - Directory containing Obsidian vaults (default: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents`)
- `--vault-name <name>` - Name of the Obsidian vault to create (default: `ghwt`)

Creates:

- `~/projects/repositories/` - Base git repos
- `~/projects/worktrees/` - Active development directories
- Dashboard template in Obsidian vault

### Clone a repository

```bash
# Clone only
ghwt clone https://github.com/galaxyproject/galaxy.git
ghwt clone git@github.com:galaxyproject/galaxy.git

# Clone - auto-detects your fork if it exists!
ghwt clone https://github.com/galaxyproject/galaxy.git
# → If you have a fork, automatically uses your fork as origin + original as upstream

# Clone with explicit upstream (skips auto-detection)
ghwt clone git@github.com:jmchilton/galaxy.git \
  --upstream git@github.com:galaxyproject/galaxy.git

# Clone with upstream and disable origin push (for safe fork workflow)
ghwt clone git@github.com:jmchilton/galaxy.git \
  --upstream git@github.com:galaxyproject/galaxy.git \
  --no-push

# Clone and create worktree
ghwt clone https://github.com/galaxyproject/gxformat2 test
ghwt clone https://github.com/galaxyproject/galaxy 1234

# Skip fork detection (useful if gh auth is not configured)
ghwt clone https://github.com/galaxyproject/galaxy.git --no-fork-check
```

Clones repository in `~/projects/repositories/<name>/`

**Options:**

- `[branch]` - Optional: creates worktree immediately (format: branch name or PR number)
- `--upstream <url>` - Optional: adds upstream remote (useful for forks); skips fork detection
- `--no-push` - Optional: disables push to origin (git remote set-url --push origin no-push), forcing pushes to go to upstream instead
- `--no-fork-check` - Optional: skips automatic fork detection (useful if gh CLI is not authenticated)

### Create a worktree

```bash
ghwt create galaxy cool-feature
ghwt create galaxy fix-login
ghwt create galaxy 1234
```

Automatically:

- Creates/checks out branch
- Generates Obsidian note with metadata
- Opens VS Code + Obsidian

### Sync metadata

```bash
ghwt sync                         # → Interactive picker
ghwt sync galaxy cool-feature     # Sync specific worktree
ghwt sync --this                  # Sync current worktree
ghwt sync --all                   # Sync all worktrees
ghwt sync-all                     # Shortcut for sync --all
ghwt sync galaxy --all            # Sync all worktrees for project
ghwt sync --all --verbose         # See detailed output
```

Updates:

- Commits ahead/behind
- Uncommitted changes
- PR state, CI status, reviews
- Days since activity
- CI artifacts (for failing PRs)

**Recreates missing notes:** if a worktree exists but its note was deleted, sync recreates it with fresh metadata.

Example output:

```
📊 Sync complete: 3 updated, 1 notes recreated, 0 errors
```

### Remove a worktree

```bash
ghwt rm galaxy cool-feature
ghwt rm galaxy 1234
```

Automatically:

- Deletes worktree directory
- Prunes git worktree registry
- Archives Obsidian note to `~/projects/old/`

### Claude Sessions

Per-worktree Claude Code sessions - automatically scoped to each worktree directory:

```bash
ghwt claude galaxy new-feature
# → Opens Claude in the worktree directory

ghwt claude galaxy new-feature --continue
# → Resumes last conversation in that worktree

ghwt claude galaxy new-feature "help me fix this bug"
# → Opens Claude with a prompt in that worktree
```

**Features:**

- Independent conversation history per worktree (automatic via directory scoping)
- Resume previous conversations with `--continue` flag
- Optional prompt on startup
- Works with worktree picker (all three convenience modes)
- Claude has full context of worktree files and git state

### Worktree Convenience Commands

Quick shortcuts to open worktree in different contexts, with interactive picker when args are optional:

```bash
# Open in VS Code
ghwt code                          # → Pick from all worktrees
ghwt code galaxy                   # → Pick from galaxy worktrees only
ghwt code galaxy 21199             # → Open directly (no picker)
ghwt code --this                   # → Open current worktree

# Open Obsidian note
ghwt note                          # → Pick from all worktrees
ghwt note training-material        # → Pick from training-material only
ghwt note gxformat2 test           # → Open directly
ghwt note --this                   # → Open current worktree's note

# Open on GitHub (branch or PR)
ghwt gh                            # → Pick from all worktrees
ghwt gh artifact-detective         # → Pick from artifact-detective only
ghwt gh galaxy 21199               # → Open directly (reads PR URL from note or constructs branch URL)
ghwt gh --this                     # → Open current worktree on GitHub

# Open Claude in worktree
ghwt claude                        # → Pick from all worktrees
ghwt claude galaxy                 # → Pick from galaxy worktrees only
ghwt claude galaxy 21199           # → Open directly
ghwt claude galaxy fix --continue  # → Resume last session
ghwt claude galaxy fix "help me understand this code"  # → Open with prompt
ghwt claude --this                 # → Open Claude in current worktree

# Get paths for scripting
ghwt path-note --this              # → Output path to current worktree's note
ghwt path-ci-artifacts --this      # → Output path to current worktree's CI artifacts

# Open dashboard
ghwt dashboard                     # → Opens Obsidian dashboard
```

**Worktree Picker:**

- Interactive menu with arrow key navigation
- Type to search/filter options
- Smart prefiltering when project provided
- Auto-select if only one option exists
- Beautiful colored UI

### Obsidian Quick Action Links

Each worktree note includes clickable links for instant access to common actions (when configured).

**Setup (optional):**

1. Install the **Shell commands** Obsidian community plugin

2. Create a shell command in the plugin with three variables:
   - Variable 1: `_subcommand`
   - Variable 2: `_project`
   - Variable 3: `_worktree`

   Shell command: `ghwt {{_subcommand}} {{_project}} {{_worktree}}`

3. Copy the command ID from the plugin (shown in the list of commands)

4. Configure ghwt with your Obsidian vault name and command ID:

```json
{
  "obsidianVaultName": "ghwt",
  "shellCommandExecuteId": "YOUR_COMMAND_ID_HERE"
}
```

5. Done! Each new worktree note will have two action links at the top automatically:
   - 📝 Open Code
   - 📄 Open Note

The links automatically use the `project` and `branch` from the note's YAML frontmatter and pass them as variables to the shell command.

## Configuration

Edit `~/.ghwtrc.json`:

```json
{
  "projectsRoot": "~/projects",
  "repositoriesDir": "repositories",
  "worktreesDir": "worktrees",
  "vaultPath": "~/my-obsidian-vault",
  "obsidianVaultName": "projects",
  "shellCommandExecuteId": "abc123def456",
  "syncInterval": null,
  "editor": "none"
}
```

**Editor Configuration Options:**

- `editor`: `"none"` (default), `"code"`, or `"cursor"` - Which editor `ghwt create` opens on
  the new worktree
  - `"none"`: Don't open an editor; run `ghwt code` or `ghwt cursor` when you want one
  - `"code"`: Open VS Code
  - `"cursor"`: Open Cursor
  - Ignored if the chosen editor's CLI isn't on `PATH`

> **Note:** the `ci-artifacts-config/` directory is resolved relative to `projectsRoot` and does not need to be configured.

### CI Artifacts Configuration

Place `.gh-ci-artifacts.yaml`, `.gh-ci-artifacts.yml`, or `.gh-ci-artifacts.json` config files in:

```
~/projects/ci-artifacts-config/<repo-name>/
```

Example for Galaxy:

```
~/projects/ci-artifacts-config/galaxy/.gh-ci-artifacts.yaml
```

When ghwt syncs or creates worktrees with failing PRs, it will automatically detect and use the config file for that repository. See [gh-ci-artifacts docs](https://github.com/jmchilton/gh-ci-artifacts) for config options.

## Metadata Fields

Each worktree note tracks:

**Git Info**

- `repo_url` - GitHub repository URL
- `commits_ahead` / `commits_behind` - Relative to base branch
- `has_uncommitted_changes` - Boolean flag
- `last_commit_date` - Most recent commit timestamp

**GitHub Info** (when linked to PR)

- `pr_state` - open/closed/merged/draft
- `pr_checks` - passing/failing/pending
- `pr_reviews` - Number of reviews
- `pr_labels` - GitHub labels

**CI Artifacts** (auto-fetched for failing PRs)

- `ci_status` - complete/partial/incomplete (workflow status)
- `ci_failed_tests` - Count of test failures
- `ci_linter_errors` - Count of linter errors
- `ci_artifacts_path` - Local directory path
- `ci_viewer_url` - File URL to interactive HTML viewer
- `ci_head_sha` - Commit SHA (for smart incremental fetching)
- `ci_last_synced` - Last CI artifacts sync timestamp

**Activity Tracking**

- `days_since_activity` - Auto-calculated staleness
- `last_synced` - Last metadata sync timestamp

## Obsidian Dashboard

**Required Plugins:** The interactive dashboard requires the following Obsidian community plugins to be installed:

- **Dataview** - Powers the dashboard queries
- **Templater** - Used for template processing

Install these from Settings → Community plugins → Browse.

The init command creates `dashboard.md` with Dataview queries:

**Active Work**

```dataview
TABLE project, branch, status, commits_ahead, pr_checks
FROM "projects"
WHERE status != "merged"
SORT created DESC
```

**Needs Attention**

```dataview
TABLE project, branch, pr_checks, commits_ahead, days_since_activity
FROM "projects"
WHERE (pr_checks = "failing" OR days_since_activity > 7 OR has_uncommitted_changes = true)
SORT days_since_activity DESC
```

**CI Failures**

```dataview
TABLE project, branch, ci_status, ci_failed_tests, ci_linter_errors
FROM "projects"
WHERE ci_status != null AND ci_status != "complete"
SORT ci_failed_tests DESC
```

Customize queries for your workflow - all metadata is available.

## Architecture

```
src/
├── cli.ts                 # Command router
├── commands/
│   ├── init.ts            # Workspace initialization
│   ├── clone.ts           # Repository cloning
│   ├── create.ts          # Worktree creation
│   ├── sync.ts            # Metadata sync
│   ├── rm.ts              # Worktree removal
│   ├── code.ts            # Open worktree in VS Code
│   ├── note.ts            # Open Obsidian note
│   ├── gh.ts              # Open GitHub branch/PR
│   ├── claude.ts          # Open Claude in worktree
│   ├── cursor.ts          # Open worktree in Cursor IDE
│   ├── ci-artifacts-download.ts  # Download CI artifacts
│   ├── ci-artifacts-clean.ts     # Clean CI artifacts
│   ├── path-ci-artifacts.ts      # Output CI artifacts path
│   ├── path-note.ts              # Output note path
│   ├── lint.ts                   # Validate configs
│   └── dashboard.ts       # Open Obsidian dashboard
└── lib/
    ├── git.ts                      # Git operations
    ├── github.ts                   # GitHub API (via gh CLI)
    ├── ci-artifacts.ts             # gh-ci-artifacts integration
    ├── worktree-picker.ts          # Interactive worktree selector
    ├── worktree-list.ts            # Worktree enumeration
    ├── obsidian.ts                 # Note management
    ├── paths.ts                    # Path construction utilities
    └── config.ts                   # Configuration handling
```

### CI Artifacts Integration

- **Smart fetching**: Only downloads for failing PRs
- **Incremental mode**: Uses `--resume` when no new commits detected
- **Hierarchical storage**: All artifacts in `~/projects/ci-artifacts/<project>/<branch|pr>/<name>/`
- **Metadata extraction**: Parses summary.json for test/lint counts
- **Partial success handling**: Accepts exit codes 1 & 2 (partial/incomplete downloads)
- **Path helpers**: `ghwt path-ci-artifacts --this` outputs artifact path for scripting

### Worktree Picker

- **Interactive selection**: Beautiful CLI menu with arrow key navigation
- **Fuzzy search**: Type to filter worktrees by name
- **Smart filtering**: When project arg provided, picker shows only that project's worktrees
- **Fast path**: Full args provided bypasses picker (direct execution)
- **Auto-select**: Single option automatically selected
- **`--this` flag**: Skip picker and use current worktree (requires running from within a worktree)
- **Integrated**: Used by `code`, `note`, `gh`, `claude`, `path-note`, and `path-ci-artifacts` commands
- **Enumeration**: Scans worktrees directory and sorts by project then branch

### Claude Sessions Integration

- **Per-worktree sessions**: Each worktree maintains independent Claude conversation history
- **Directory scoping**: Claude automatically saves session state relative to working directory
- **Resume conversations**: `--continue` flag reopens last conversation in that worktree
- **Optional prompts**: Start with a prompt for immediate context
- **Full file access**: Claude can read/edit files in the worktree directory
- **Git integration**: Claude has access to git history and current state
- **Unified interface**: Works with same picker and argument patterns as other commands

## Dependencies

**NPM packages:**

- `commander` - CLI framework
- `js-yaml` - YAML/JSON config parsing
- `execa` - Shell command execution
- `enquirer` - Interactive CLI prompts (worktree picker)

**External tools (must be installed):**

- `git` and `gh` CLI - Git and GitHub operations
- `claude` - Claude Code CLI (for opening Claude sessions)
- `gh-ci-artifacts` - CI artifact downloads (installed on demand via npx)

## Development

```bash
npm install
npm run build
npm run dev        # Watch mode
npm link          # Local development
```

## License

MIT
