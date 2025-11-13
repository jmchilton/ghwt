# @jmchilton/ghwt

Worktree-centered development task dashboard with Obsidian integration.

## Features

- **Worktree Management**: Create, track, and remove git worktrees for branches and PRs
- **Worktree Picker**: Interactive CLI menu for quick selection with fuzzy search and smart filtering
- **Convenience Commands**: Quick access to code editor, notes, GitHub, terminal sessions, and Claude
- **Terminal Sessions**: WezTerm + tmux integration with per-repo session configs (dev server, testing, interactive shells)
- **Claude Sessions**: Per-worktree Claude Code conversations with independent history and resume support
- **CI Artifact Integration**: Auto-fetch GitHub Actions artifacts for failing PRs with smart resume mode
- **Obsidian Integration**: Auto-generate markdown notes with rich metadata for each worktree
- **Live Dashboard**: Dataview-powered dashboards showing active work, CI failures, needs attention, ready to merge
- **Automated Sync**: Continuously sync metadata from git, GitHub API, and CI artifacts
- **Multi-Project**: Manage worktrees across multiple repositories

## Installation

```bash
npm install -g @jmchilton/ghwt
# or link locally for development
npm link
```

## Quick Start

### Initialize workspace

```bash
ghwt init --vault-path ~/my-obsidian-vault
```

Creates:

- `~/projects/repositories/` - Bare git repos
- `~/projects/worktrees/` - Active development directories
- Dashboard template in Obsidian vault

### Clone a repository

```bash
# Clone only
ghwt clone https://github.com/galaxyproject/galaxy.git
ghwt clone git@github.com:galaxyproject/galaxy.git

# Clone with upstream (for forks)
ghwt clone git@github.com:jmchilton/galaxy.git \
  --upstream git@github.com:galaxyproject/galaxy.git

# Clone and create worktree
ghwt clone https://github.com/galaxyproject/gxformat2 test
ghwt clone https://github.com/galaxyproject/galaxy 1234
```

Clones repository as bare repository in `~/projects/repositories/<name>/`

**Options:**

- `[branch]` - Optional: creates worktree immediately (format: branch name or PR number)
- `--upstream <url>` - Optional: adds upstream remote (useful for forks with origin as your fork)

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
ghwt sync                    # Sync all projects
ghwt sync galaxy             # Sync specific project
ghwt sync --verbose          # See detailed output
```

Updates:

- Commits ahead/behind
- Uncommitted changes
- PR state, CI status, reviews
- Days since activity
- CI artifacts (for failing PRs)

**Recreates missing items:**

- **Notes**: If a worktree exists but its note was deleted, sync recreates it with fresh metadata
- **Terminal Sessions**: If a worktree's tmux session is missing (crashed, killed, etc.), sync recreates it from the session config

Example output:

```
📊 Sync complete: 3 updated, 1 note recreated, 2 sessions recreated, 0 errors
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
- Kills terminal session (if running)

### Terminal Sessions

Persistent, reconnectable development environments with tmux or zellij multiplexer:

```bash
ghwt create galaxy new-feature
# → Automatically launches session (if config exists)

ghwt attach galaxy new-feature
# → Reconnect to existing session (survives terminal crashes)
```

**Features:**

- Multiple tabs/panes per worktree (dev server, tests, interactive shell)
- Auto-virtualenv activation (`.venv/bin/activate`)
- Persistent sessions (tmux or zellij, reattachable anytime)
- Configurable multiplexer (global default in `~/.ghwtrc.json`)
- UI options: WezTerm wrapper, direct zellij, or raw multiplexer
- Works locally and remotely (SSH, containers)
- Gracefully degrades if no config (sessions optional)

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

# Attach to terminal session
ghwt attach                        # → Pick from all worktrees
ghwt attach galaxy                 # → Pick from galaxy sessions only
ghwt attach galaxy 21199           # → Attach directly
ghwt attach --this                 # → Attach to current worktree's session

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
  "obsidianVaultName": "projects",
  "shellCommandExecuteId": "YOUR_COMMAND_ID_HERE"
}
```

5. Done! Each new worktree note will have three action links at the top automatically:
   - 📝 Open Code
   - 📄 Open Note
   - ⌨️ Open Terminal

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
  "defaultBaseBranch": "dev",
  "terminalMultiplexer": "tmux",
  "terminalUI": "wezterm"
}
```

**Terminal Configuration Options:**

- `terminalMultiplexer`: `"tmux"` (default) or `"zellij"` - Which multiplexer to use for sessions
- `terminalUI`: `"wezterm"` (default) or `"none"` - How to launch sessions
  - `"wezterm"`: Launch WezTerm with multiplexer inside (modern UI)
  - `"none"`: Launch multiplexer directly (native zellij UI or raw tmux)

> **Note:** `ci-artifacts-config/` and `terminal-session-config/` directories are automatically resolved relative to `projectsRoot` and do not need to be configured.

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

### Terminal Session Configuration

Place `.ghwt-session.yaml`, `.ghwt-session.yml`, or `.ghwt-session.json` config files in:

```
~/projects/terminal-session-config/
```

**Per-repository config:**

```yaml
# ~/projects/terminal-session-config/galaxy.ghwt-session.yaml
name: galaxy
root: '{{worktree_path}}'

pre:
  - '[ -f .venv/bin/activate ] && source .venv/bin/activate'

windows:
  - name: client
    root: client
    panes:
      - npm run dev

  - name: server
    panes:
      - make run

  - name: test
    # Empty pane for interactive testing
```

**Default fallback config (optional):**
If a repository doesn't have a specific config, ghwt will look for `_default.ghwt-session.yaml`:

```yaml
# ~/projects/terminal-session-config/_default.ghwt-session.yaml
# Used for any repository without its own config file
```

**Template variables** (substituted automatically):

- `{{worktree_path}}` - Full path to worktree
- `{{project}}` - Project name (e.g., "galaxy")
- `{{branch}}` - Branch name (without slashes)

**Sections:**

- `name` - Session name (prefixed with project-branch)
- `root` - Session root directory (default: worktree_path)
- `pre` - Commands to run before each pane (useful for venv activation)
- `windows` - List of windows/tabs with panes and startup commands

**Format & Multiplexer Support:**

- Single unified format works with both tmux and zellij
- Windows and panes are automatically compiled to the appropriate multiplexer syntax
- Pre-commands run before each pane (for virtualenv activation, etc.)
- When `ghwt create` runs, it automatically detects the config and launches a session using the configured multiplexer and UI

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
│   ├── attach.ts          # Terminal session attachment
│   ├── code.ts            # Open worktree in VS Code
│   ├── note.ts            # Open Obsidian note
│   ├── gh.ts              # Open GitHub branch/PR
│   ├── claude.ts          # Open Claude in worktree
│   ├── cursor.ts          # Open worktree in Cursor IDE
│   ├── ci-artifacts-download.ts  # Download CI artifacts
│   ├── ci-artifacts-clean.ts     # Clean CI artifacts
│   ├── path-ci-artifacts.ts      # Output CI artifacts path
│   ├── path-note.ts              # Output note path
│   ├── clean-sessions.ts         # Kill all sessions
│   ├── lint.ts                   # Validate configs
│   └── dashboard.ts       # Open Obsidian dashboard
└── lib/
    ├── git.ts                      # Git operations
    ├── github.ts                   # GitHub API (via gh CLI)
    ├── ci-artifacts.ts             # gh-ci-artifacts integration
    ├── terminal-session.ts         # Session manager dispatcher
    ├── terminal-session-base.ts    # Base interfaces
    ├── terminal-session-tmux.ts    # Tmux backend implementation
    ├── terminal-session-zellij.ts  # Zellij backend implementation
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

### Terminal Session Integration

- **Multiplexer abstraction**: Unified interface for tmux and zellij
- **Multiple backends**: Tmux (default) or zellij via pluggable managers
- **Per-repo configs**: YAML-based session templates in `terminal-session-config/<repo>.ghwt-session.yaml`
- **Default fallback**: If no repo config exists, uses `terminal-session-config/_default.ghwt-session.yaml`
- **Unified config format**: Single YAML format compiles to appropriate multiplexer syntax
- **Auto-virtualenv**: Pre-commands like `. .venv/bin/activate` run before pane startup
- **Multiple windows**: Configure tabs for dev servers, testing, interactive shells
- **Template variables**: Substitute `{{worktree_path}}`, `{{project}}`, `{{branch}}` in configs
- **UI options**: WezTerm wrapper, direct multiplexer, or configurable per-project
- **Graceful degradation**: No config = no session, everything else works
- **Session cleanup**: `ghwt rm` kills session before removing worktree

### Worktree Picker

- **Interactive selection**: Beautiful CLI menu with arrow key navigation
- **Fuzzy search**: Type to filter worktrees by name
- **Smart filtering**: When project arg provided, picker shows only that project's worktrees
- **Fast path**: Full args provided bypasses picker (direct execution)
- **Auto-select**: Single option automatically selected
- **`--this` flag**: Skip picker and use current worktree (requires running from within a worktree)
- **Integrated**: Used by `code`, `note`, `gh`, `attach`, `claude`, `path-note`, and `path-ci-artifacts` commands
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
- `wezterm` - Terminal emulator (optional, for sessions with `terminalUI: "wezterm"`)
- **Terminal Multiplexer** (one of):
  - `tmux` - Terminal multiplexer (default, for session persistence)
  - `zellij` - Terminal multiplexer (alternative, set `terminalMultiplexer: "zellij"` in config)

## Development

```bash
npm install
npm run build
npm run dev        # Watch mode
npm link          # Local development
```

## License

MIT
