---
name: xcode-mcp
version: 1.0.0
description: >-
  Xcode IDE interaction skill. Uses the xcode-mcp CLI to build, diagnose,
  test, preview, and edit Xcode projects via MCP. Use when the user asks to
  build an Xcode project, view build errors, run diagnostics, run tests,
  render SwiftUI previews, search Apple documentation, or manage project files.
---

# xcode-mcp Skill

Interact with Xcode through the `xcode-mcp` CLI backed by the Xcode MCP bridge.

## Prerequisites

- Xcode 26.3 or later is installed and open with the target project
- `xcode-mcp-bridge` is installed: `npm install -g xcode-mcp-bridge`
- The bridge is running via one of:
  - Background service: `xcode-mcp service install`
  - Foreground (in a separate terminal): `xcode-mcp bridge`
- The bridge listens on `http://127.0.0.1:49321/mcp`

## Workflow

### 1. Discover tab identifier
```bash
xcode-mcp windows
```
Returns the `tabIdentifier` (e.g. `windowtab1`) and corresponding workspace path.
If exactly one Xcode tab is open, `--tab` is auto-detected for all commands.

### 2. Build
```bash
xcode-mcp build
```

### 3. View build errors
```bash
xcode-mcp build-log --severity error
```

### 4. Single-file diagnostics (no full build required)
```bash
xcode-mcp file-issues "MyApp/Sources/Controllers/MyFile.swift"
```

### 5. View all Navigator issues
```bash
xcode-mcp issues --severity error
```

### 6. Quick project status (windows + issues)
```bash
xcode-mcp status
```

### 7. SwiftUI preview (requires #Preview macro)
```bash
xcode-mcp preview "MyApp/Sources/Views/MyView.swift" --out ./preview-out
```

### 8. Execute code snippet
```bash
xcode-mcp snippet "MyApp/Sources/SomeFile.swift" "print(someExpression)"
```

### 9. Testing
```bash
xcode-mcp test all
xcode-mcp test some "TargetName/testMethod()"
xcode-mcp test list
```

### 10. Search Apple documentation
```bash
xcode-mcp doc "SwiftUI NavigationStack" --frameworks SwiftUI
```

### 11. File operations (within Xcode project structure)
```bash
xcode-mcp read "path/to/file"
xcode-mcp ls /
xcode-mcp ls -r /
xcode-mcp grep "TODO|FIXME"
xcode-mcp glob "**/*.swift"
xcode-mcp write "path/to/file" "content"
xcode-mcp update "path/to/file" "oldText" "newText" --replace-all
xcode-mcp mv "Old.swift" "New.swift"
xcode-mcp mkdir "MyApp/Sources/Feature"
xcode-mcp rm "MyApp/Sources/Unused.swift"
```

### 12. Service management
```bash
xcode-mcp service install     # Install and start as background service (launchd)
xcode-mcp service status      # Check if bridge is running
xcode-mcp service logs -f     # Follow bridge logs
xcode-mcp service uninstall   # Stop and remove service
```

## Notes
- File paths are relative to the Xcode project structure, not absolute filesystem paths.
- Use `--tab <tabIdentifier>` if multiple Xcode tabs are open.
- If the bridge is not responding: `xcode-mcp service status` then `xcode-mcp service uninstall && xcode-mcp service install`.
- For JSON output, add `--json` to any command.
- Use `xcode-mcp run <toolName> --args '{"key":"value"}'` to invoke any MCP tool directly.
