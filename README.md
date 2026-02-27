# xcode-mcp

A friendly CLI for using Xcode MCP tools from the terminal.

`xcode-mcp` talks to Xcode through an HTTP MCP bridge (`xcode-mcp bridge`) backed by `xcrun mcpbridge`.

## Requirements

- macOS with Xcode installed
- Node.js 18+
- An open Xcode window/workspace when running project commands

## Quick Start

```bash
# from this repo
npm install

# terminal 1: start the local MCP bridge
xcode-mcp bridge

# terminal 2: inspect available Xcode windows/tabs
xcode-mcp windows

# run commands (use --tab if more than one Xcode tab is open)
xcode-mcp --tab <tabIdentifier> status
xcode-mcp --tab <tabIdentifier> build
```

If exactly one Xcode tab is open, `--tab` is auto-detected.

## Use With Codex / Claude

This repo includes a helper command to register the **HTTP bridge** as an MCP server (instead of registering `xcrun mcpbridge` directly):

```bash
# after bridge is running on localhost:8080/mcp
xcode-mcp agent-setup --client codex
xcode-mcp agent-setup --client claude
```

## Most Common Commands

```bash
xcode-mcp status
xcode-mcp build
xcode-mcp build-log --severity warning
xcode-mcp test all
xcode-mcp test list
xcode-mcp issues --severity error
xcode-mcp windows
```

## Project/File Commands

```bash
xcode-mcp ls /
xcode-mcp glob "**/*.swift"
xcode-mcp read "MyApp/Sources/View.swift"
xcode-mcp grep "TODO|FIXME"

xcode-mcp write "MyApp/Sources/NewFile.swift" "import SwiftUI"
xcode-mcp update "MyApp/Sources/View.swift" "OldText" "NewText" --replace-all
xcode-mcp mv "Old.swift" "New.swift"
xcode-mcp mkdir "MyApp/Sources/Feature"
xcode-mcp rm "MyApp/Sources/Unused.swift"
```

## Preview / Snippet / Docs

```bash
xcode-mcp preview "MyApp/Sources/MyView.swift" --out ./preview-out
xcode-mcp snippet "MyApp/Sources/MyView.swift" "print(\"hello\")"
xcode-mcp doc "NavigationStack" --frameworks SwiftUI
```

## Output Modes

Use text output by default, or JSON for automation/scripts:

```bash
xcode-mcp status --json
xcode-mcp build-log --output json
```

## Help

```bash
xcode-mcp --help
xcode-mcp <command> --help
```

## Credits

The generated MCP client/tool bindings in this project are produced with **MCPorter**:

- [MCPorter](https://github.com/steipete/mcporter)

