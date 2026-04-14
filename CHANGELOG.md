# Changelog

## 0.4.0 - 2026-04-14

### Added
- Codex (OpenAI) support. Parses sessions from ~/.codex/sessions/ with full
  token tracking, cost calculation, task classification, and tool breakdown.
- Provider plugin system. Adding a new provider (Pi, OpenCode, Amp) is a
  single file in src/providers/.
- TUI provider toggle. Press p to cycle All / Claude / Codex. Auto-detects
  which providers have session data on disk. Hidden when only one is present.
- --provider flag on all CLI commands: report, today, month, status, export.
  Values: all (default), claude, codex.
- Codex tool normalization: exec_command -> Bash, read_file -> Read,
  write_file/apply_diff/apply_patch -> Edit, spawn_agent -> Agent.
- Codex model pricing: gpt-5, gpt-5.3-codex, gpt-5.4, gpt-5.4-mini with
  hardcoded fallbacks to prevent LiteLLM fuzzy matching mispricing.
- CODEX_HOME environment variable support for custom Codex data directories.
- Menubar per-provider cost breakdown when multiple providers have data.
- 1-minute in-memory cache with LRU eviction for instant provider switching.
- 10 new tests (Codex parser, provider registry, tool/model mapping).

### Fixed
- Model name fuzzy matching: gpt-5.4-mini no longer mispriced as gpt-5
  (more specific prefixes checked first).

## 0.3.1 - 2026-04-14

### Added
- Shell Commands breakdown panel showing which CLI binaries are used most
  (git, npm, docker, etc.). Parses compound commands (&&, ;, |) and handles
  quoted strings. Contributed by @rafaelcalleja.

### Changed
- Activity panel is now full-width so the 1-shot column renders cleanly
  on all terminal sizes.

### Fixed
- Crash on unreadable session files (ENOENT). Skips gracefully instead.

## 0.3.0 - 2026-04-14

### Added
- One-shot success rate per activity category. Detects edit/test/fix retry
  cycles (Edit -> Bash -> Edit) within each turn. Shows 1-shot percentage
  in the By Activity panel for categories that involve code edits.

### Fixed
- Turn grouping: tool-result entries (type "user" with no text) no longer
  split turns. Previously inflated Conversation category by 3-5x at the
  expense of Coding, Debugging, and other edit-heavy categories.

## 0.2.0 - 2026-04-14

### Added
- Claude Desktop (code tab) session support. Scans local-agent-mode-sessions
  in addition to ~/.claude/projects/. Same JSONL format, deduplication across
  both sources. macOS, Windows, and Linux paths.
- CLAUDE_CONFIG_DIR environment variable support. Falls back to ~/.claude if
  not set.

### Fixed
- npm package trimmed from 1.1MB to 41KB by adding files field (ships dist/
  only).
- Image URLs switched to jsDelivr CDN for npm readme rendering.

## 0.1.1 - 2026-04-13

### Fixed
- Readme image URLs for npm rendering.

## 0.1.0 - 2026-04-13

### Added
- Interactive TUI dashboard built with Ink (React for terminals).
- 13-category task classifier (coding, debugging, exploration, brainstorming,
  etc.) using tool usage patterns and keyword matching. No LLM calls.
- Breakdowns by daily activity, project, model, task type, core tools, and
  MCP servers.
- Gradient bar charts (blue to amber to orange) inspired by btop.
- Responsive layout: side-by-side panels at 90+ cols, stacked below.
- Keyboard navigation: arrow keys switch Today/7 Days/Month, q to quit.
- Column headers on all panels.
- Bottom status bar with key hints (interactive mode only).
- Per-panel accent border colors with rounded corners.
- SwiftBar/xbar menu bar widget with flame icon, activity breakdown, model
  costs, and token stats. Refreshes every 5 minutes.
- CSV and JSON export with Today, 7 Days, and 30 Days periods.
- LiteLLM pricing integration with 24h cache and hardcoded fallback.
  Supports input, output, cache write, cache read, web search, and fast
  mode multiplier.
- Message deduplication by API message ID across all session files.
- Date-range filtering per entry (not per session) to prevent session bleed.
- Compact status command with terminal, menubar, and JSON output formats.
