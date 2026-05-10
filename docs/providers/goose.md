# Goose

Block's Goose CLI.

- **Source:** `src/providers/goose.ts`
- **Loading:** lazy (`src/providers/index.ts:29-42`)
- **Test:** none. Adding a fixture-based test is a known good first issue.

## Where it reads from

A SQLite database. Path resolution honors `XDG_DATA_HOME` and a `GOOSE_PATH_ROOT` override:

| Platform | Default path |
|---|---|
| macOS / Linux | `~/.local/share/goose/sessions/sessions.db` |
| Windows | `%APPDATA%/Block/goose/sessions/sessions.db` |

See `goose.ts:52-62`.

## Storage format

SQLite.

## Caching

None.

## Deduplication

Per `sessionId` (`goose.ts:174`).

## Quirks

- Source paths are encoded as `<dbPath>:<sessionId>` so a single db can yield many session sources. The discovery code splits on the last colon (`goose.ts:148-150`).
- Tool inventory comes from the `messages` table queried with `LIKE '%toolRequest%'` (`goose.ts:90`). This will miss tools whose payloads are encoded differently in a future Goose version.
- Tokens are read directly from `accumulated_input_tokens` and `accumulated_output_tokens`. No estimation.

## When fixing a bug here

1. Add a fixture-based test before changing logic. `tests/providers/goose.test.ts` does not exist yet; create it and use a small SQLite file under `tests/fixtures/goose/`.
2. If the bug is "no sessions", check `XDG_DATA_HOME` and `GOOSE_PATH_ROOT` first; users on non-default Linux setups will not match the default path.
3. The `LIKE '%toolRequest%'` query is fragile. If Goose changes the message envelope, this is where it will break.
