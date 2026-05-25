# CodeBurn — Windows System Tray

Native Windows system tray app built with Electron. Equivalent of the macOS menubar app.

![Windows Tray](../assets/logo.png)

## Features

- System tray icon with live cost tooltip
- Click to open popup dashboard (cost · calls · cache hit · sessions · one-shot rate)
- Provider breakdown with cost bars (Claude, Codex, Cursor, etc.)
- Top projects list
- Optimization findings with savings estimate
- Period switcher: Today / Week / Month / All
- Auto-refresh every 30 seconds
- Right-click context menu with period switching and Quit

## Requirements

- Windows 10/11
- Node.js 20+
- CodeBurn CLI installed (`npm install -g codeburn` or local install)

## Install & Run

```cmd
cd windows
npm install
start-tray.bat
```

Or run directly:

```cmd
.\node_modules\electron\dist\electron.exe .
```

## How it works

Calls `codeburn status --format menubar-json --period <period>` every 30 seconds and renders the JSON into an Electron BrowserWindow popup anchored near the tray icon.
