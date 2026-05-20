# ghwt

Worktree-centered development task dashboard with Obsidian integration.

## Features

- **Worktree Management**: Create, track, and remove git worktrees for branches and PRs
- **Worktree Picker**: Interactive CLI menu for quick selection with fuzzy search and smart filtering
- **Convenience Commands**: Quick access to code editor, notes, GitHub, terminal sessions, and Claude
- **Terminal Sessions**: Auto-detects and configures zellij/tmux + ghostty/wezterm for per-repo session configs (dev server, testing, interactive shells)
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

# Clean sessions
ghwt clean-session                    # → Interactive picker
ghwt clean-session galaxy new-feature # Kill specific session
ghwt clean-session --this             # Kill current worktree's session
ghwt clean-session --all              # Kill all ghwt sessions
ghwt clean-session-all                # Shortcut for clean-session --all
```

**Features:**

- Multiple tabs/panes per worktree (dev server, tests, interactive shell)
- Auto-virtualenv activation (`.venv/bin/activate`)
- Persistent sessions (tmux or zellij, reattachable anytime)
- Configurable multiplexer (global default in `~/.ghwtrc.json`)
- UI options: WezTerm wrapper, direct zellij, or raw multiplexer
- Works locally and remotely (SSH, containers)
- Gracefully degrades if no config (sessions optional)
- Auto-recreate: `attach` recreates missing session if config exists

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
  "obsidianVaultName": "ghwt",
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

- `terminalMultiplexer`: `"tmux"` (default), `"zellij"`, `"cmux"`, or `"herdr"` - Which multiplexer to use for sessions
  - `"cmux"`: macOS-only, opt-in. cmux is a fused UI + multiplexer, so `terminalUI` is a **no-op** when this is selected (cmux _is_ the UI; ghwt never spawns wezterm/ghostty). Requires cmux >= 0.63.0 (tested against 0.64.x); ghwt probes `cmux ping` + `cmux version` at startup. **Also requires cmux's external CLI/socket access to be enabled** (see "External CLI access" below) - by default cmux refuses connections from processes it did not spawn. Not auto-selected by `ghwt init` - set it explicitly.
  - `"herdr"`: Linux/macOS, opt-in. herdr is a TUI multiplexer, so `terminalUI` **is** honored (ghwt launches herdr inside wezterm/ghostty, like tmux/zellij). Requires herdr >= 0.5.10 and its background server already running; ghwt probes `herdr --version` + `herdr session list --json` at startup and fails fast (it does **not** auto-spawn herdr's server - run `herdr` once yourself). Not auto-selected by `ghwt init` - set it explicitly.
- `terminalUI`: `"wezterm"` (default) or `"none"` - How to launch sessions (ignored when `terminalMultiplexer: "cmux"`; honored for `"herdr"`)
  - `"wezterm"`: Launch WezTerm with multiplexer inside (modern UI)
  - `"none"`: Launch multiplexer directly (native zellij UI or raw tmux)

> **Note:** `ci-artifacts-config/` and `terminal-session-config/` directories are automatically resolved relative to `projectsRoot` and do not need to be configured.

### cmux Integration (macOS, opt-in)

With `terminalMultiplexer: "cmux"`, ghwt manages cmux workspaces via the `cmux` CLI only (arms-length: no linking/embedding). ghwt remains the brain (worktree lifecycle, metadata, CI intelligence); cmux is one optional body (rendering, attention UI). Workspaces are keyed by a ghwt-stamped title (`ghwt:<session-name>`), resolved fresh each call (nothing persisted). Session config `tabs`/`windows`/`panes` are flattened to cmux **panes** - each ghwt pane becomes one cmux pane (a live terminal). cmux _surfaces_ are deliberately not used: `new-surface` stacks non-live views inside a single pane and only the active one accepts input, so panes (`new-split`) are the addressable terminal unit. `zellij_ui`/`start_suspended` have no cmux analog and are ignored, just as tmux ignores them.

> **External CLI access (required).** cmux's control socket only accepts connections from processes cmux itself spawned ("Access denied - only processes started inside cmux can connect"). ghwt drives cmux from _outside_ its terminals (it creates the workspace before any cmux terminal exists), so the cmux backend **requires cmux's external CLI/socket access setting to be enabled**. There is no password bypass ([manaflow-ai/cmux#1864](https://github.com/manaflow-ai/cmux/issues/1864) is an open, unimplemented request). If it is not enabled, ghwt fails fast with an actionable message naming the setting (it does **not** misreport this as "cmux not installed"). Without that setting the cmux backend cannot function; tmux/zellij are unaffected.

Two thin bridges:

- **Notify bridge** - `ghwt sync` rings the worktree's cmux workspace (`cmux notify`) only on a _transition_ into needs-attention (failing PR/CI checks, uncommitted changes, or stale > 7 days), never on every sync. No-op for tmux/zellij.
- **Sync hook bridge** - `ghwt install-sync-hook` idempotently installs a Claude Code `Stop` hook running `ghwt sync --this` (non-fatal). When Claude finishes a turn in a worktree, the worktree re-syncs and (with cmux selected) the workspace rings on a needs-attention transition. `ghwt install-sync-hook --uninstall` removes it. (cmux has no hook registry of its own - this is wired Claude-side.)

### herdr Integration (Linux/macOS, opt-in)

With `terminalMultiplexer: "herdr"`, ghwt manages [herdr](https://herdr.dev) workspaces via the `herdr` CLI only (arms-length: no linking; herdr is AGPL-3.0, but shelling out to a separate binary is not linking and does not affect ghwt's MIT license). ghwt remains the brain (worktree lifecycle, metadata, CI intelligence); herdr is one optional body. Each worktree maps to one herdr **workspace**, labelled `ghwt:<session-name>` and resolved by label each call (herdr ids are not stable across server restarts; nothing is persisted). Session config `tabs`/`windows`/`panes` are flattened to herdr **panes** - each ghwt pane becomes one pane via `pane split --cwd` + `pane run`. `zellij_ui`/`start_suspended` have no herdr analog and are ignored, just as tmux/cmux ignore them.

Unlike cmux, herdr is a far thinner adapter: `workspace create` returns the workspace + root pane ids directly (no title-resolve round-trip), `pane run` executes commands with no shell-not-ready race, `pane split --cwd` sets per-pane cwd and targets a specific pane (no focus/`cd` hacks), herdr exits non-zero with a structured `{"error":...}` on failure (no exit-0 output sniffing), and its socket is the documented interface for external drivers (no cmux-style external-access wall). herdr is a TUI multiplexer like tmux/zellij, so `terminalUI` is honored (ghwt launches `herdr` inside wezterm/ghostty/none with the workspace pre-focused).

> **No notify bridge.** herdr exposes no external notification trigger (no `herdr notify`); it detects per-pane agent state itself and self-notifies. So the herdr backend deliberately omits `notify` - the sync notify bridge no-ops for herdr exactly as it does for tmux/zellij. herdr's own agent-state detection (idle/working/blocked) is the intended attention signal; wiring it into ghwt's needs-attention model is a planned follow-up, not part of this backend.

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
│   ├── clean-session.ts          # Kill terminal sessions
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
  - `cmux` - **macOS-only**, opt-in fused UI + multiplexer (set `terminalMultiplexer: "cmux"`). Minimum supported **v0.63.0**, tested against **v0.64.x**. See https://cmux.com. Arms-length integration via the `cmux` CLI only. **Requires cmux's external CLI/socket access setting enabled** (cmux blocks externally-spawned callers by default; no password bypass - [manaflow-ai/cmux#1864](https://github.com/manaflow-ai/cmux/issues/1864)).
  - `herdr` - **Linux/macOS**, opt-in TUI multiplexer (set `terminalMultiplexer: "herdr"`). Minimum supported **v0.5.10** (validated against server protocol 6). See https://herdr.dev. Arms-length integration via the `herdr` CLI only; requires herdr's background server already running (ghwt does not auto-spawn it). `terminalUI` is honored (herdr runs inside wezterm/ghostty like tmux/zellij).

## Development

```bash
npm install
npm run build
npm run dev        # Watch mode
npm link          # Local development
```

## License

MIT
