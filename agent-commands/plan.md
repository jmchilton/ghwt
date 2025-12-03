# Plan

Create or refine a plan for work in the current worktree.

## What This Does

1. Reads the worktree note using ghwt - this can be done by invoking the   
   command `ghwt path-note --this` from this current work tree.
2. Looks for existing TODO or PLAN sections
3. The note is for user input and user planning, any plans you create should
   be placed and tracked in the current worktree.
3. Enters planning mode to structure work and break it down into tasks

## How It Works

This command will:

- Read your current worktree note
- Extract any existing plan/TODO list
- Ask clarifying questions about the work
- Help you break down the feature/task into actionable steps
- Generate a structured plan with clear tasks
- Write the plan to a worktree file with an all caps name like PLAN_FEATURE_A.md.

## Note Structure

The user TODOs go in the main body of the note (not in frontmatter). The command extracts TODOS and stops at the "Quick Actions" section (everything after is ignored).

The command ignores:

- **Frontmatter** - YAML at the top between `---` markers
- **Quick Actions section** - Anything at or after `## Quick Actions`
- **Obsidian quicklinks** - Links to related notes like `[[other-note]]`

## Usage

When you run `/ghwt:plan` from within a worktree:

1. The command reads your note
2. Shows any existing plan
3. Asks about the work: scope, requirements, constraints
4. Helps break down work into manageable tasks
5. Generates a clear TODO list
6. Writes the plan to the current worktree.

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
