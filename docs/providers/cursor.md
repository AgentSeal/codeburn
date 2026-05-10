# Cursor

Cursor IDE chat history.

- **Source:** `src/providers/cursor.ts`
- **Loading:** lazy (`src/providers/index.ts:44-57`). The `node:sqlite` import is the heavy dependency that justifies lazy loading.
- **Test:** `tests/providers/cursor.test.ts` (77 lines), `tests/providers/cursor-bubble-dedup.test.ts` (176 lines)

## Where it reads from

A single SQLite database per platform:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Windows | `%APPDATA%/Cursor/User/globalStorage/state.vscdb` |
| Linux | `~/.config/Cursor/User/globalStorage/state.vscdb` |

## Storage format

SQLite. Two parallel sources within the same db:

1. **Bubbles** (`cursor.ts:201-331`): per-message rows. The richer source.
2. **agentKv** (`cursor.ts:350-460`): per-conversation key-value blobs. The fallback for older sessions.

The parser tries both and dedupes via `seenKeys`.

## Caching

`src/cursor-cache.ts` writes `~/.cache/codeburn/cursor-results.json` (override with `$CODEBURN_CACHE_DIR`). The fingerprint is `dbMtimeMs + dbSizeBytes` of `state.vscdb`. Atomic write via temp + rename.

## Deduplication

- Bubbles: per `bubbleId` (`cursor.ts:282`).
- agentKv: per `requestId` (`cursor.ts:429`).

## Quirks

- **180-day lookback.** The bubbles query bounds itself to the trailing 180 days (`cursor.ts:205`). Older history is ignored. If a user reports "Cursor data missing", confirm the date range first.
- **250 000 bubble cap.** Power users with massive history are capped to prevent unbounded memory. If you need to raise this, also raise the cache size budget.
- **Per-conversation user-message queue.** The parser caches the user-message stream per conversation to avoid an O(n) shift on every turn (`cursor.ts:171-191`).
- **agentKv has no per-message timestamp.** The DB file's mtime is used as the timestamp for every agentKv-derived call (`cursor.ts:358-363`). This is wrong but consistent.
- **Cursor v3 reports zero token counts.** The parser falls back to char-counting (`CHARS_PER_TOKEN = 4`) for those rows (`cursor.ts:265-272`).

## When fixing a bug here

1. **Always reproduce against a fixture, not a real db.** SQLite over the live db is racy; the user might be using Cursor while you read.
2. If the bug is "tokens are zero", check whether the row is a v3 zero-token bubble, in which case the char-fallback should kick in.
3. If the bug is "duplicate counts", check both `bubbleId` dedup and the cross-provider `seenKeys` dedup.
4. Cache poisoning is the most common failure mode after a Cursor schema change. Bump `CURSOR_CACHE_VERSION` in `src/cursor-cache.ts` so old caches are invalidated.
