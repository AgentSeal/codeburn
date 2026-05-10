# Antigravity

Google Antigravity. The only provider that does not read files off disk: it speaks to a local language-server RPC endpoint instead.

- **Source:** `src/providers/antigravity.ts`
- **Loading:** lazy (`src/providers/index.ts:14-27`). Lazy because the protobuf dependency is heavy.
- **Test:** none. Mocking the RPC endpoint cleanly is the open issue.

## Where it reads from

A local HTTPS RPC endpoint exposed by Antigravity's language server. The parser:

1. Locates the running language-server process via `ps`.
2. Reads its port and CSRF token from process metadata.
3. Calls `GetCascadeTrajectoryGeneratorMetadata` over HTTPS.
4. Validates the response (capped at 5-15 MB depending on cascade size).

If the language server is not running, the parser falls back to the cached results file (`antigravity.ts:262-272`).

## Storage format

Protobuf. Cascade and response objects map to `ParsedProviderCall` directly; see `antigravity.ts:299-323`.

## Caching

Custom file cache at `$CODEBURN_CACHE_DIR/antigravity-results.json` (defaults to `~/.cache/codeburn/`). The version constant is at `antigravity.ts:12`; the cache machinery (`loadCache`, `flushCache`) lives in `antigravity.ts:75-125`. The cache is also used as the data source when the RPC endpoint is unavailable, not just as an optimization. Bumping the cache version forces a recompute.

## Deduplication

Per `<cascadeId>:<responseId>` (`antigravity.ts:308`).

## Quirks

- **Antigravity is the only provider that requires a live process.** A user who closes Antigravity loses the most-recent data until next launch (the cache covers older runs).
- The 5-15 MB cap on RPC responses is necessary because individual cascades can balloon. Raising it risks OOM on the user's machine.
- Token types are split across `inputTokens`, `responseOutputTokens`, and `thinkingOutputTokens` (`antigravity.ts:313-323`). Thinking is billed at output rate.

## When fixing a bug here

1. Reproducing requires Antigravity running locally. There is no fixture for the RPC, which is a real testing gap.
2. Before any change, capture a sample protobuf response (anonymized) so future regressions can be tested against a recording.
3. If the bug is "no data after Antigravity update", the protobuf schema may have shifted. The parser's response handling at `antigravity.ts:299-323` is the place to look.
4. If the bug is "stale data", check whether the RPC is reachable; the cache fallback can mask connectivity issues.
