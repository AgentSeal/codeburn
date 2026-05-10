# Droid

Factory's Droid CLI.

- **Source:** `src/providers/droid.ts`
- **Loading:** eager (`src/providers/index.ts:4`)
- **Test:** `tests/providers/droid.test.ts` (148 lines)

## Where it reads from

`$FACTORY_DIR` if set, otherwise `~/.factory/sessions/<subdir>/*.jsonl`.

The parser ignores the `.factory/` directory itself (`droid.ts:293-296`); some installs nest it accidentally.

## Storage format

JSONL.

## Caching

None.

## Deduplication

Per `messageId` within a session (`droid.ts:253`).

## Quirks

- **Token totals are session-level only.** Droid does not report per-message tokens. The parser reads `settings.tokenUsage` once per session and **splits it evenly** across all assistant calls, with the remainder added to the last call (`droid.ts:223-251`). This is approximate but consistent.
- Project name is derived from the session's `cwd`. If the cwd contains `projects/<name>`, that name is preferred over the basename (`droid.ts:299-319`).

## When fixing a bug here

1. If the bug is "tokens unevenly attributed", that is by design. The session-level total is the only signal Droid emits.
2. If the bug is "no sessions found", confirm the user does not have `$FACTORY_DIR` pointing somewhere unexpected.
3. New fixtures go under `tests/fixtures/droid/`.
