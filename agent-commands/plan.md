# Plan

Create or refine a plan for work in the current worktree.

## What This Does

1. Reads the worktree note from the current directory
2. Looks for existing TODO or PLAN sections
3. Enters planning mode to structure work and break it down into tasks

## How It Works

This command will:

- Read your current worktree note
- Extract any existing plan/TODO list
- Ask clarifying questions about the work
- Help you break down the feature/task into actionable steps
- Generate a structured plan with clear tasks
- Update your note with the plan

## Note Structure

Your plan goes in the main body of the note (not in frontmatter). The command extracts your plan and stops at the "Quick Actions" section (everything after is ignored).

The command ignores:

- **Frontmatter** - YAML at the top between `---` markers
- **Quick Actions section** - Anything at or after `## Quick Actions`
- **Obsidian quicklinks** - Links to related notes like `[[other-note]]`

A good plan structure looks like:

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

## Implementation Notes

Schema design considerations:

- Store hashed passwords using bcrypt
- Add rate limiting on login attempts
- Consider JWT expiration strategy

[[security-guidelines]]
[[user-management-module]]
```

## Usage

When you run `/ghwt:plan` from within a worktree:

1. The command reads your note
2. Shows any existing plan
3. Asks about the work: scope, requirements, constraints
4. Helps break down work into manageable tasks
5. Generates a clear TODO list
6. Offers to update your note with the plan

## When to Use This

- **Starting new work** - Before you write any code
- **Refining scope** - When requirements are unclear
- **Unblocking** - When you're stuck on what to do next
- **Planning** - Before tackling complex features

## Tips

- Be specific about requirements and constraints
- Ask for help breaking down ambiguous tasks
- Include "Update documentation" as a task
- Plan incrementally - you can refine as you implement
- Use checkboxes (`- [ ]`) for easy progress tracking

## Related Commands

- `/ghwt:implement` - Execute the plan and implement tasks
