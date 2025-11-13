# Implement

Start implementing work from the current worktree's plan.

## What This Does

1. Reads the worktree note from the current directory
2. Extracts a TODO list or PLAN section from the note body
3. Enters implementation mode to execute the tasks

## How It Works

This command will:

- Extract the plan/TODO list from your worktree note body (ignoring frontmatter, quicklinks, and links sections)
- Parse tasks and their status
- Guide you through implementing each task
- Help debug issues as they arise
- Update the note with progress as you work

## Note Structure

Your note will contain metadata and sections. The command extracts the plan from your note body and stops at the "Quick Actions" section (everything after is ignored).

The command ignores:

- **Frontmatter** - YAML at the top between `---` markers
- **Quick Actions section** - Anything at or after `## Quick Actions`
- **Obsidian quicklinks** - Links to related notes like `[[other-note]]`

Focus your plan in the main body, before Quick Actions:

```markdown
---
project: galaxy
branch: branch/my-feature
status: in-progress
---

# Feature: Add User Authentication

## Plan

- [ ] Design authentication schema
- [ ] Implement login endpoint
- [ ] Add JWT token validation
- [ ] Write integration tests
- [ ] Update API docs

## Notes

Some implementation details and context...

[[related-issue]]
[[architecture-notes]]
```

Or use a simple TODO list:

```markdown
---
project: myproject
branch: feature/refactor
---

# Refactor Database Layer

## TODO

1. Extract query builder
2. Add connection pooling
3. Migrate existing calls
4. Performance testing

## Notes

References: [[db-design]], [[migration-guide]]
```

## Usage

When you run `/ghwt:implement` from within a worktree:

1. The command reads your note
2. Extracts and shows the TODO/PLAN
3. Asks which task to work on first
4. Provides implementation assistance
5. Tracks progress as you work

## Tips

- Keep your TODO list in the note body (not in frontmatter)
- Use checkboxes (`- [ ]`) for clearer task tracking
- Add implementation notes in sections below the plan
- Put related links at the bottom of the note

## Related Commands

- `/ghwt:plan` - Create or refine a plan before implementing
