# OpenCode

OpenCode (sst/opencode).

- **Source:** `src/providers/opencode.ts`
- **Loading:** lazy (`src/providers/index.ts:59-75`)
- **Test:** `tests/providers/opencode.test.ts` (558 lines, the largest provider test)

## Where it reads from

Default `~/.local/share/opencode/` or `$XDG_DATA_HOME/opencode/`. The discovery walk picks up `opencode*.db` files (`opencode.ts:71-88`).

## Storage format

SQLite.

## Caching

None.

## Deduplication

Per `<sessionId>:<messageId>` (`opencode.ts:242`).

## Quirks

- **Schema validation is loud.** When a required table is missing, the parser logs an actionable warning telling the user which table is gone and what version of OpenCode it expects (`opencode.ts:104-131`). This is the right behavior; do not silently swallow these.
- Source paths are encoded as `<dbPath>:<sessionId>` (`opencode.ts:147-150`).
- Each message's `parts` are indexed (`opencode.ts:177-191`); preserving the order matters for reasoning-token correctness.
- Tokens are reported across `input`, `output`, `reasoning`, `cache.read`, and `cache.write`. Anthropic semantics.

## When fixing a bug here

1. The 558-line test suite catches a lot. Run `npm test -- tests/providers/opencode.test.ts` before and after any change.
2. If the bug is "missing table" warning, do not catch and silence it. Either upgrade the version expectation in the parser or document the breaking schema change.
3. If the bug is "reasoning tokens off by one", check the parts index ordering.
