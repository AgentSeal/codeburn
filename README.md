<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/AgentSeal/codeburn@main/assets/logo.png" alt="CodeBurn" width="120" />
</p>

<h1 align="center">CodeBurn</h1>

<p align="center">See where your AI coding tokens go.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/codeburn"><img src="https://img.shields.io/npm/v/codeburn.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/codeburn"><img src="https://img.shields.io/npm/dm/codeburn.svg" alt="npm downloads" /></a>
  <a href="https://github.com/agentseal/codeburn/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/codeburn.svg" alt="license" /></a>
  <a href="https://github.com/agentseal/codeburn"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="node version" /></a>
</p>

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/AgentSeal/codeburn@main/assets/dashboard.jpg" alt="CodeBurn TUI dashboard" width="620" />
</p>

By task type, tool, model, MCP server, and project. Interactive TUI dashboard with gradient charts, responsive panels, and keyboard navigation. macOS menu bar widget via SwiftBar. CSV/JSON export.

Works by reading Claude Code session transcripts directly from disk. No wrapper, no proxy, no API keys. Pricing from LiteLLM (auto-cached, all models supported).

## Install

```bash
npm install -g codeburn
```

Or run without installing:

```bash
npx codeburn
```

### Requirements

- Node.js 18+
- Claude Code (reads `~/.claude/projects/` session data)

## Usage

```bash
codeburn                    # interactive dashboard (default: 7 days)
codeburn today              # today's usage
codeburn month              # this month's usage
codeburn report -p month    # same as above
codeburn status             # compact one-liner (today + month)
codeburn status --format json
codeburn export             # CSV with today, 7 days, 30 days
codeburn export -f json     # JSON export
```

Arrow keys switch between Today / 7 Days / Month. Press `q` to quit, `1` `2` `3` as shortcuts.

## Menu Bar

<img src="https://cdn.jsdelivr.net/gh/AgentSeal/codeburn@main/assets/menubar.png" alt="CodeBurn SwiftBar menu bar widget" width="260" />

```bash
codeburn install-menubar    # install SwiftBar/xbar plugin
codeburn uninstall-menubar  # remove it
```

Requires [SwiftBar](https://github.com/swiftbar/SwiftBar) (`brew install --cask swiftbar`). Shows today's cost in the menu bar with a flame icon. Dropdown shows activity breakdown, model costs, and token stats for today, 7 days, and month. Refreshes every 5 minutes.

## What it tracks

**13 task categories** classified from tool usage patterns and user message keywords. No LLM calls, fully deterministic.

| Category | What triggers it |
|---|---|
| Coding | Edit, Write tools |
| Debugging | Error/fix keywords + tool usage |
| Feature Dev | "add", "create", "implement" keywords |
| Refactoring | "refactor", "rename", "simplify" |
| Testing | pytest, vitest, jest in Bash |
| Exploration | Read, Grep, WebSearch without edits |
| Planning | EnterPlanMode, TaskCreate tools |
| Delegation | Agent tool spawns |
| Git Ops | git push/commit/merge in Bash |
| Build/Deploy | npm build, docker, pm2 |
| Brainstorming | "brainstorm", "what if", "design" |
| Conversation | No tools, pure text exchange |
| General | Skill tool, uncategorized |

**Breakdowns**: daily cost chart, per-project, per-model (Opus/Sonnet/Haiku/GPT-4o/Gemini), per-activity, core tools, MCP servers.

**Pricing**: Fetched from [LiteLLM](https://github.com/BerriAI/litellm) model prices (auto-cached 24h at `~/.cache/codeburn/`). Handles input, output, cache write, cache read, and web search costs. Fast mode multiplier for Claude. Fallback to hardcoded prices if fetch fails.

## How it reads data

Claude Code stores session transcripts as JSONL at `~/.claude/projects/<sanitized-path>/<session-id>.jsonl`. Each assistant entry contains model name, token usage (input, output, cache read, cache write), tool_use blocks, and timestamps.

CodeBurn reads these files, deduplicates messages by API message ID (prevents double-counting across sessions), filters by date range per entry (not per session), and classifies each turn.

## Project structure

```
src/
  cli.ts          Commander.js entry point
  dashboard.tsx   Ink TUI (React for terminals)
  parser.ts       JSONL reader, dedup, date filter
  models.ts       LiteLLM pricing, cost calculation
  classifier.ts   13-category task classifier
  types.ts        Type definitions
  format.ts       Text rendering (status bar)
  menubar.ts      SwiftBar plugin generator
  export.ts       CSV/JSON multi-period export
```

## License

MIT

## Credits

Inspired by [ccusage](https://github.com/ryoppippi/ccusage). Pricing data from [LiteLLM](https://github.com/BerriAI/litellm).

Built by [AgentSeal](https://agentseal.org).
