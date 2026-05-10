# Qwen

Qwen Code CLI.

- **Source:** `src/providers/qwen.ts`
- **Loading:** eager (`src/providers/index.ts:10`)
- **Test:** none. Adding a fixture-based test is a known good first issue.

## Where it reads from

`$QWEN_DATA_DIR` if set, otherwise `~/.qwen/projects/<project>/chats/*.jsonl` (`qwen.ts:52-54`).

## Storage format

JSONL.

## Caching

None.

## Deduplication

Per `<sessionId>:<uuid>` (`qwen.ts:110`).

## Quirks

- **Project name comes from the last path component** (`qwen.ts:56-59`), not from any in-file field. If a user puts the same project under two different paths, they will appear as two projects.
- **Thought parts are filtered out** before token accounting (`qwen.ts:97`). Qwen reports `thoughtsTokenCount` separately from `candidatesTokenCount`; this parser counts both as output but does not double-count thoughts in the main message.
- **Tool calls** are extracted from a fixed envelope shape (`qwen.ts:61-76`). If Qwen restructures its tool-call format in a future release, this is where it will break first.
- Tokens come from `usageMetadata`: `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `cachedContentTokenCount`.

## When fixing a bug here

1. Add a fixture and a test before changing logic. The lack of `tests/providers/qwen.test.ts` makes regressions invisible.
2. If the bug is "tools missing", look at the function-call extraction loop at `qwen.ts:61-76`.
3. If the bug is "duplicate counts", confirm `<sessionId>:<uuid>` actually uniquely identifies a turn in your reproducer; some Qwen builds repeat UUIDs across resumed sessions.
