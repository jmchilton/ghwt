# Agent Integration Plan

## Goal

Provide Claude Code users with pre-built slash commands for common ghwt operations, namespaced under `ghwt:`. These commands should automatically update when ghwt is upgraded via npm.

## Motivation

- Reduce friction for Claude Code users working with ghwt
- Provide consistent, tested prompts for common workflows
- Ensure commands stay up-to-date with ghwt features
- Enable powerful compound operations (e.g., create worktree + attach + sync)

## Directory Structure

```
ghwt/
├── agent-commands/           # New directory for Claude slash commands
│   ├── create.md            # /ghwt:create - Create new worktree
│   ├── sync.md              # /ghwt:sync - Sync worktree metadata
│   ├── lint.md              # /ghwt:lint - Validate ghwt configuration
│   ├── attach.md            # /ghwt:attach - Attach to existing worktree
│   ├── clean.md             # /ghwt:clean - Clean stale worktrees/sessions
│   └── debug.md             # /ghwt:debug - Diagnose common issues
├── src/
│   └── commands/
│       └── update-agent-commands.ts   # New command to refresh symlinks
├── package.json             # Add agent-commands to "files" array
└── ...
```

## Implementation Approach

### 1. Symlink with Fallback Strategy

**Primary: Symlink (macOS/Linux)**

- Create symlink: `~/.claude/commands/ghwt` → `{npm-package}/agent-commands`
- Automatically updates when npm package updates
- Zero maintenance for users

**Fallback: Copy (Windows, permission issues)**

- Copy directory contents to `~/.claude/commands/ghwt`
- Requires manual `ghwt update-agent-commands` after upgrades
- Warn user about manual update requirement

### 2. Package Location Resolution

```typescript
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get package root from current module location
const currentModuleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(currentModuleDir, '..'); // Adjust based on module depth
const agentCommandsDir = join(packageRoot, 'agent-commands');
```

### 3. Setup Logic in `init.ts`

```typescript
async function setupAgentCommands(): Promise<void> {
  const targetDir = join(homedir(), '.claude', 'commands', 'ghwt');

  // Create parent directory
  await mkdir(dirname(targetDir), { recursive: true });

  // Remove existing if present
  if (existsSync(targetDir)) {
    await rm(targetDir, { recursive: true, force: true });
  }

  try {
    // Try symlink first
    await symlink(agentCommandsDir, targetDir, 'dir');
    console.log('✅ Created symlink to Claude slash commands at ~/.claude/commands/ghwt');
    console.log('   Commands will auto-update when ghwt is upgraded');
  } catch (error) {
    // Fall back to copy
    await cp(agentCommandsDir, targetDir, { recursive: true });
    console.log('✅ Copied Claude slash commands to ~/.claude/commands/ghwt');
    console.log('   ⚠️  Run "ghwt update-agent-commands" after upgrading ghwt');
  }
}
```

### 4. New Command: `ghwt update-agent-commands`

```typescript
export async function updateAgentCommandsCommand(): Promise<void> {
  // Re-run the same setup logic
  await setupAgentCommands();
  console.log('✅ Claude slash commands updated');
}
```

## Initial Command Set

### Priority 1: Core Operations

**`/ghwt:create`**

```markdown
Create a new ghwt worktree using the `ghwt create` command.

Ask the user for:

- Project name
- Branch name (or PR number)

Then run: `ghwt create <project> <branch>`

After creation, offer to:

1. Attach to the worktree session
2. Open the note in Obsidian
3. Show the worktree path
```

**`/ghwt:sync`**

```markdown
Sync all ghwt worktree metadata using `ghwt sync`.

This updates:

- Git status for all worktrees
- PR metadata (if applicable)
- Note frontmatter
- Recreates missing terminal sessions

Run: `ghwt sync --verbose`
```

**`/ghwt:lint`**

```markdown
Validate ghwt configuration and detect issues using `ghwt lint`.

This checks for:

- Invalid configuration files
- Missing required directories
- Notes without worktrees
- Worktrees without notes
- Orphaned CI artifacts
- Orphaned zellij sessions
- Extra files in config directories

Run: `ghwt lint`

If errors are found, offer to help fix them.
```

### Priority 2: Navigation & Debugging

**`/ghwt:attach`**

```markdown
Attach to an existing ghwt worktree terminal session.

Show available worktrees using `ghwt attach` (interactive picker).

After attaching, show:

- Worktree path
- Note location
- Recent commits
```

**`/ghwt:debug`**

```markdown
Diagnose common ghwt issues.

Run diagnostics:

1. `ghwt lint` - Check for configuration issues
2. Check git worktree status in repositories
3. Verify terminal multiplexer (zellij/tmux) is installed
4. Check Obsidian vault structure
5. Verify note frontmatter consistency

Present findings and offer to fix issues.
```

**`/ghwt:clean`**

```markdown
Clean stale ghwt resources.

Offer to clean:

1. Terminal sessions without worktrees (`ghwt clean-sessions`)
2. CI artifacts (`ghwt ci-artifacts-clean`)
3. Notes for deleted worktrees (manual intervention)
4. Orphaned zellij sessions (detected by lint)

Run appropriate commands based on user selection.
```

### Priority 3: Advanced Operations

**`/ghwt:setup-pr`** (compound operation)

```markdown
Set up a complete PR worktree workflow.

Steps:

1. Create worktree from PR number
2. Attach PR metadata
3. Download CI artifacts
4. Open note in Obsidian
5. Attach to terminal session

Ask for:

- Project name
- PR number

Execute:

1. `ghwt create <project> <pr-number>`
2. `ghwt attach-pr <project> <pr-number>`
3. `ghwt ci-artifacts-download <project> <pr-number>`
4. `ghwt note <project> <pr-number>`
5. `ghwt attach <project> <pr-number>`
```

## Implementation Steps

### Phase 1: Basic Setup (1-2 hours)

1. Create `agent-commands/` directory
2. Write initial command files (create, sync, lint)
3. Update `package.json` to include agent-commands in `files` array
4. Add package location resolution utility
5. Add symlink setup logic to `init.ts`
6. Test on macOS/Linux

### Phase 2: Update Command (30 min)

1. Create `src/commands/update-agent-commands.ts`
2. Add CLI integration in `src/cli.ts`
3. Test manual updates

### Phase 3: Advanced Commands (1-2 hours)

1. Write attach, debug, clean commands
2. Write compound operation commands (setup-pr)
3. Document all commands in README

### Phase 4: Cross-Platform Testing (1 hour)

1. Test symlink on macOS/Linux
2. Test fallback copy on Windows
3. Test upgrade workflow (symlink auto-updates vs. manual update)
4. Test command execution in Claude Code

## Testing Considerations

### Manual Testing

1. **Fresh install**: Run `ghwt init` and verify commands appear in `~/.claude/commands/ghwt`
2. **Symlink verification**: Check if symlink was created or files were copied
3. **Command execution**: Try running `/ghwt:lint` in Claude Code
4. **Upgrade workflow**:
   - Upgrade ghwt package
   - Verify symlink still works (or need to run update command)
5. **Cross-platform**: Test on macOS, Linux, Windows

### Automated Testing

- Unit test package location resolution
- Unit test symlink creation logic
- Integration test for `update-agent-commands` command

## User Experience

### First-time Setup (during `ghwt init`)

```
✅ Created symlink to Claude slash commands at ~/.claude/commands/ghwt
   Commands will auto-update when ghwt is upgraded

   Available commands:
   - /ghwt:create    Create new worktree
   - /ghwt:sync      Sync worktree metadata
   - /ghwt:lint      Validate configuration
   - /ghwt:attach    Attach to worktree session
   - /ghwt:clean     Clean stale resources
   - /ghwt:debug     Diagnose issues
```

### Copy Fallback (Windows or permission issues)

```
✅ Copied Claude slash commands to ~/.claude/commands/ghwt
   ⚠️  Symlink unavailable - commands won't auto-update
   Run "ghwt update-agent-commands" after upgrading ghwt
```

### After Upgrade (symlink case)

- No action needed - commands automatically updated

### After Upgrade (copy case)

```bash
$ ghwt update-agent-commands
✅ Claude slash commands updated
```

## Open Questions

1. **Command naming convention**: Use `ghwt:` prefix or just namespace in directory?
   - Recommendation: Use `ghwt:` prefix in filenames (e.g., `create.md` → `/ghwt:create`)

2. **Version compatibility**: How to handle commands from newer ghwt with older CLI?
   - Recommendation: Commands should gracefully handle missing features

3. **Documentation location**: Document commands in README or separate CLAUDE_COMMANDS.md?
   - Recommendation: Brief mention in README, full docs in CLAUDE_COMMANDS.md

4. **Permission to modify ~/.claude**: Should we ask user permission first?
   - Recommendation: Yes, add optional flag `--skip-agent-commands` to init

5. **Existing ~/.claude/commands/ghwt**: What if user already has custom commands there?
   - Recommendation: Warn and ask before overwriting

## Future Enhancements

1. **Interactive command builder**: Commands that prompt for arguments
2. **Context-aware commands**: Commands that auto-detect current worktree
3. **Batch operations**: Commands that operate on multiple worktrees
4. **Custom templates**: Allow users to extend with their own commands
5. **Command versioning**: Track which ghwt version commands are compatible with
6. **Integration with MCP**: Expose ghwt operations as MCP tools

## Success Metrics

- Commands successfully installed during `ghwt init`
- Symlinks work correctly on macOS/Linux (auto-update)
- Copy fallback works on Windows
- Commands execute successfully in Claude Code
- User feedback indicates reduced friction in common workflows

## References

- [Claude Code Slash Commands Documentation](https://docs.claude.com/en/docs/claude-code/slash-commands)
- [Node.js fs.symlink API](https://nodejs.org/api/fs.html#fssymlinkpath-target-type-callback)
- [npm package.json files field](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files)
