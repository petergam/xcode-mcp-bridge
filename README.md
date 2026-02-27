# xcode-mcp-bridge
Human and agent friendly CLI for using Xcode MCP tools from the terminal and from agent (using cli or MCP)

`xcode-mcp bridge` talks to Xcode through an HTTP MCP bridge backed by `xcrun mcpbridge`.

## Quick Start

## Requirements

- Xcode 26.3 or later

```bash
# install globally from npm
npm install -g xcode-mcp-bridge
```

```bash
# or run without installing globally
npx xcode-mcp-bridge --help
```

```bash
# terminal 1: start the local MCP bridge
xcode-mcp bridge

# terminal 2: inspect available Xcode windows/tabs
xcode-mcp windows

# check overall workspace status
xcode-mcp --tab <tabIdentifier> status

# build the active scheme
xcode-mcp --tab <tabIdentifier> build
```

If exactly one Xcode tab is open, `--tab` is auto-detected.

## Use With Codex / Claude

This repo includes a helper command to register the **HTTP bridge** as an MCP server with your agent.

```bash
# after bridge is running on localhost:49321/mcp
# configure Codex to use the bridge MCP server
xcode-mcp agent-setup --client codex

# configure Claude to use the bridge MCP server
xcode-mcp agent-setup --client claude
```

## Most Common Commands

```bash
# quick health check (windows + issues)
xcode-mcp status

# build the current project
xcode-mcp build

# inspect recent build log with warnings
xcode-mcp build-log --severity warning

# run all tests from active test plan
xcode-mcp test all

# list available tests
xcode-mcp test list

# list current errors from Issue Navigator
xcode-mcp issues --severity error

# list open Xcode tabs/workspaces
xcode-mcp windows
```

## Project/File Commands

```bash
# list project structure
xcode-mcp ls /

# find files by glob
xcode-mcp glob "**/*.swift"

# read file contents
xcode-mcp read "MyApp/Sources/View.swift"

# regex search across project files
xcode-mcp grep "TODO|FIXME"

# create/overwrite file content
xcode-mcp write "MyApp/Sources/NewFile.swift" "import SwiftUI"

# replace text in a file
xcode-mcp update "MyApp/Sources/View.swift" "OldText" "NewText" --replace-all

# move or rename a file
xcode-mcp mv "Old.swift" "New.swift"

# create a directory/group
xcode-mcp mkdir "MyApp/Sources/Feature"

# remove a file/directory from project
xcode-mcp rm "MyApp/Sources/Unused.swift"
```

## Preview / Snippet / Docs

```bash
# render a SwiftUI preview image
xcode-mcp preview "MyApp/Sources/MyView.swift" --out ./preview-out

# execute a Swift snippet in file context
xcode-mcp snippet "MyApp/Sources/MyView.swift" "print(\"hello\")"

# search Apple documentation
xcode-mcp doc "NavigationStack" --frameworks SwiftUI
```

## Output Modes

Use text output by default, or JSON for automation/scripts:

```bash
# emit status as JSON
xcode-mcp status --json

# emit build log as JSON
xcode-mcp build-log --output json
```

## Help

```bash
# show top-level CLI help
xcode-mcp --help

# show help for a specific command
xcode-mcp <command> --help
```

## Credits

The generated MCP client/tool bindings in this project are produced with **MCPorter**:

- [MCPorter](https://github.com/steipete/mcporter)
