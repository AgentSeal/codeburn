# Claude

Anthropic Claude Code CLI and Claude Desktop's local agent mode.

- **Source:** `src/providers/claude.ts`
- **Loading:** eager (`src/providers/index.ts:1`)
- **Test:** none directly. Coverage comes from `tests/parser-claude-cwd.test.ts`, `tests/parser-filter.test.ts`, and `tests/parser-mcp-inventory.test.ts`, which exercise `src/parser.ts` end-to-end against fixture session files.

## Where it reads from

| Source | Path |
|---|---|
| Claude Code CLI | `$CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude/projects/` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/local-agent-mode-sessions/` |
| Claude Desktop (Windows) | `%APPDATA%/Claude/local-agent-mode-sessions/` |
| Claude Desktop (Linux) | `~/.config/Claude/local-agent-mode-sessions/` |

For Desktop, `findDesktopProjectDirs` walks up to 8 levels deep looking for `projects/` subdirectories, skipping `node_modules` and `.git`.

## Storage format

JSONL, one event per line, per session file. Sessions live under `<project>/<sessionId>.jsonl`.

## Parser

`createSessionParser` returns an empty async generator (`claude.ts:101-105`). Claude is a special case: `src/parser.ts` reads Claude JSONL files directly with full turn grouping, dedup of streaming message IDs, and MCP tool inventory extraction. The provider object exists only so `discoverSessions` can return Claude session sources alongside the others.

## Caching

None at the provider level. The daily aggregation cache (`src/daily-cache.ts`) reuses prior computed days.

## Quirks

- The parser is in `src/parser.ts`, not in `src/providers/claude.ts`. Anything that changes Claude parsing belongs in `parser.ts`.
- Streaming responses produce duplicate message IDs across resumed sessions; `parser.ts` strips them via the global `seenMsgIds` Set.
- Model display names are mapped in `claude.ts:7-20`; add new versions there when Anthropic releases them.

## When fixing a bug here

1. Confirm whether the bug is in **discovery** (sessions not picked up) or **parsing** (sessions found but data wrong).
2. Discovery bugs live in `claude.ts:78-99`. Verify the directory layout you expect actually matches what Claude writes today.
3. Parsing bugs live in `src/parser.ts`. Look for `parseSessionFile`, `groupIntoTurns`, and `dedupeStreamingMessageIds`.
4. Add a fixture under `tests/fixtures/` and a test under `tests/parser-claude-cwd.test.ts` (or a new file). Do not mock the filesystem.
