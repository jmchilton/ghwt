# Zellij Backend Guide

ghwt supports both tmux and zellij as terminal multiplexer backends for session management.

## Quick Start: Switch to Zellij

Edit `~/.ghwtrc.json`:

```json
{
  "terminalMultiplexer": "zellij",
  "terminalUI": "none"
}
```

Then use ghwt normally:

```bash
ghwt create galaxy feature/new-feature
# → Creates zellij session with native UI
```

## Configuration Options

### `terminalMultiplexer`

- `"tmux"` (default) - Use tmux as session backend
- `"zellij"` - Use zellij as session backend

### `terminalUI`

- `"wezterm"` (default) - Wrap multiplexer in WezTerm window
- `"none"` - Launch multiplexer directly with native UI

## Example Configurations

### Direct Zellij (Native UI)

```json
{
  "terminalMultiplexer": "zellij",
  "terminalUI": "none"
}
```

### Zellij in WezTerm

```json
{
  "terminalMultiplexer": "zellij",
  "terminalUI": "wezterm"
}
```

### Tmux in WezTerm (Default)

```json
{
  "terminalMultiplexer": "tmux",
  "terminalUI": "wezterm"
}
```

### Raw Tmux

```json
{
  "terminalMultiplexer": "tmux",
  "terminalUI": "none"
}
```

## Session Configuration

The session config format works with both tmux and zellij. Same YAML file automatically compiles to appropriate multiplexer syntax.

Example: `~/projects/terminal-session-config/galaxy/.ghwt-session.yaml`

```yaml
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
    # Empty pane
```

## Features

- **Unified Config Format**: Single YAML format works with both multiplexers
- **Pre-Commands**: Run virtualenv activation, etc. before pane startup
- **Multiple Windows**: Configure tabs for dev server, tests, etc.
- **Template Variables**: Use `{{worktree_path}}`, `{{project}}`, `{{branch}}` in configs
- **Window/Pane Structure**: Automatically compiled to multiplexer-specific syntax
- **UI Flexibility**: Choose between WezTerm wrapper or native UI

## Keybindings

### Zellij (Native UI)

Default zellij keybindings apply:

- `Ctrl+g` - Toggle compact mode / default mode
- `Ctrl+p` - Enter command mode
- `Ctrl+[` - Enter scroll mode
- `Ctrl+s` - Toggle synchronized input

See [zellij docs](https://zellij.dev) for full keybinding guide.

### Tmux (via WezTerm)

WezTerm and tmux keybindings both work. Tmux leader key is `Ctrl+b` by default.

## Architecture

### Multiplexer Abstraction Layer

All multiplexer-specific code is isolated in backend implementations:

- `TerminalSessionManager` - Abstract interface
- `TmuxSessionManager` - Tmux implementation
- `ZellijSessionManager` - Zellij implementation
- `terminal-session.ts` - Dispatcher selects appropriate backend

### Session Creation Flow

1. Load session config (YAML format)
2. Get manager based on `terminalMultiplexer` setting
3. Manager translates YAML to multiplexer-specific commands
4. Session created and UI launched based on `terminalUI` setting

## Troubleshooting

### "Session not found" errors

- Confirm zellij is installed: `zellij --version`
- Check config: `cat ~/.ghwtrc.json`
- List sessions: `zellij list-sessions`

### Panes not running commands

- Check pre-command syntax in session config
- Verify virtualenv path exists
- Test commands manually in shell first

### UI not launching

- If `terminalUI: "wezterm"`, confirm wezterm is installed
- If `terminalUI: "none"`, zellij/tmux UI should launch directly
- Check terminal output for error messages

## Switching Back to Tmux

Simply change config back:

```json
{
  "terminalMultiplexer": "tmux",
  "terminalUI": "wezterm"
}
```

Existing zellij sessions are unaffected. New `ghwt create` commands will use tmux.
