# ghwt Usage Guide

## Basic Workflow

### 1. Initialize workspace

```bash
ghwt init --vault-path ~/my-obsidian-vault
```

Creates:

- `~/projects/repositories/` - Bare git repos
- `~/projects/worktrees/` - Active development directories
- Dashboard in Obsidian vault

**Note:** To prevent accidental re-initialization, `ghwt init` will bail out with an error if a config file already exists. Use `GHWT_CONFIG` environment variable to point to a different config path if you want multiple workspace configurations.

### 2. Clone a repository

```bash
# Simple clone
ghwt clone https://github.com/owner/repo.git

# Auto-detects your fork (if you're authenticated with gh CLI)
# Uses your fork as origin, original repo as upstream
ghwt clone https://github.com/owner/repo.git

# Explicit upstream (skips auto-detection)
ghwt clone https://github.com/your-fork/repo.git \
  --upstream https://github.com/owner/repo.git

# Disable push to origin (extra safety for forks)
ghwt clone https://github.com/your-fork/repo.git \
  --upstream https://github.com/owner/repo.git \
  --no-push

# Clone and create worktree immediately
ghwt clone https://github.com/owner/repo.git cool-feature
ghwt clone https://github.com/owner/repo.git 1234

# Skip fork detection
ghwt clone https://github.com/owner/repo.git --no-fork-check
```

**Clone Options:**

- `--upstream <url>` - Add upstream remote (skips auto-fork detection)
- `--no-push` - Disable push to origin (force pushes to upstream instead)
- `--no-fork-check` - Skip automatic fork detection (if gh CLI is not authenticated)

### 3. Create a worktree

```bash
ghwt create galaxy cool-feature    # Branch worktree
ghwt create galaxy 1234             # PR worktree
ghwt create galaxy fix/bug-123      # Branch with slashes
```

Automatically:

- Creates or checks out the branch
- Generates Obsidian note with rich metadata
- Opens VS Code + Obsidian (if available)

### 4. Work in your worktree

```bash
cd ~/projects/worktrees/galaxy/branch/cool-feature
# Edit files, commit, push...

# Quick access commands from within worktree
ghwt code --this                    # Open in VS Code
ghwt note --this                    # Open Obsidian note
ghwt gh --this                      # Open on GitHub
ghwt claude --this                  # Open Claude
ghwt path-note --this               # Get note path
ghwt path-ci-artifacts --this       # Get artifacts path
```

### 5. Sync metadata

```bash
ghwt sync                           # Sync all projects
ghwt sync galaxy                    # Sync specific project
ghwt sync --verbose                 # See detailed output
```

Updates:

- Commits ahead/behind
- Uncommitted changes
- PR state, CI status, reviews
- Days since activity
- CI artifacts (for failing PRs)

Recreates missing notes (deleted but worktree still exists).

### 6. Remove when done

```bash
ghwt rm galaxy cool-feature         # Direct removal
ghwt rm galaxy                      # Pick worktree from list
ghwt rm                             # Pick any worktree
```

Automatically:

- Deletes worktree directory
- Prunes git registry
- Archives Obsidian note

## Directory Structure

```
~/projects/
├── repositories/              # Bare git repos (source of truth)
│   └── galaxy/
├── worktrees/                 # Active work directories
│   └── galaxy/
│       ├── branch/            # Branch worktrees
│       │   ├── cool-feature/
│       │   └── fix/bug-123/
│       └── pr/                # PR worktrees
│           ├── 1234/
│           └── 5678/
└── ci-artifacts/              # Downloaded CI artifacts
    └── galaxy/
        └── pr/
            ├── 1234/
            └── 5678/

~/my-obsidian-vault/
└── projects/
    ├── dashboard.md           # Dataview dashboards
    └── galaxy/
        └── worktrees/         # Flat note structure
            ├── cool-feature.md
            ├── 1234.md
            └── fix-bug-123.md
```

## Convenience Commands

All convenience commands support three modes:

**Mode 1: Pick from all worktrees**

```bash
ghwt code              # → Interactive picker
ghwt note
ghwt gh
ghwt claude
```

**Mode 2: Filter by project**

```bash
ghwt code galaxy       # → Pick only galaxy worktrees
ghwt note training-material
```

**Mode 3: Direct access**

```bash
ghwt code galaxy cool-feature  # → Open directly (no picker)
ghwt note gxformat2 1234
ghwt gh artifact-detective feature
```

**Mode 4: Use current worktree**

```bash
ghwt code --this       # → Use current worktree (must be inside one)
ghwt note --this
ghwt gh --this
ghwt claude --this
ghwt path-note --this
ghwt path-ci-artifacts --this
```

## Claude Sessions

Per-worktree Claude Code conversations:

```bash
ghwt claude galaxy new-feature
# → Opens Claude in the worktree directory

ghwt claude galaxy new-feature --continue
# → Resumes last conversation

ghwt claude galaxy new-feature "fix this bug"
# → Opens Claude with a prompt
```

## CI Artifacts

Automatic artifact handling for failing PRs:

```bash
ghwt create galaxy 1234
# → Auto-detects failing PR and downloads artifacts

ghwt ci-artifacts-download
# → Download artifacts for all PR worktrees

ghwt ci-artifacts-download galaxy
# → Download for galaxy project only

ghwt ci-artifacts-clean
# → Clean all artifacts (save disk space)

# Get paths for scripting
ghwt path-ci-artifacts --this
# → Outputs path to current worktree's artifacts
```

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
  "syncInterval": null
}
```

## Common Workflows

### Start a new feature branch

```bash
cd ~/projects
ghwt create galaxy cool-feature
# → Creates worktree, opens VS Code + Obsidian
```

### Work on a PR

```bash
ghwt create galaxy 1234
# → Creates PR worktree, downloads CI artifacts if failing
ghwt note galaxy 1234
# → Open note to see PR status, CI results
ghwt code galaxy 1234
# → Open code editor
```

### Check all active work

```bash
ghwt dashboard
# → Opens Obsidian dashboard with filtered views
```

### Sync everything

```bash
ghwt sync
# → Updates all worktrees with latest git/GitHub/CI info
```

### Quick context jump

```bash
# Jump to any worktree
ghwt code
# → Pick from list, opens in VS Code

# From within worktree, jump to sibling
ghwt code --this
# → Opens current worktree
```

## Troubleshooting

### "Not in a ghwt worktree directory"

The `--this` flag only works when you're inside a worktree. Make sure you're in:

```
~/projects/worktrees/{project}/{branch-or-pr}/{name}/
```

### CI artifacts not downloading

Check if PR is actually failing:

```bash
ghwt sync --verbose galaxy
# → Shows detailed CI status
```

Manually trigger download:

```bash
ghwt ci-artifacts-download galaxy 1234
# → Force download specific PR
```
