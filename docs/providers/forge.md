# Forge

Forge agent CLI.

- **Source:** `src/providers/forge.ts`
- **Loading:** lazy (`src/providers/index.ts:48`)
- **Test:** `tests/providers/forge.test.ts`

## Where it reads from

`~/.forge/.forge.db` (`forge.ts:31`).

## Storage format

SQLite (`forge.ts:225-252`). CodeBurn reads the `conversations` table and parses JSON from `context.messages` (`forge.ts:154-171`).

## Caching

None.

## Deduplication

Per `<provider>:<conversation_id>:<tool_call_id-or-message-index>` (`forge.ts:193`).

## Quirks

- `workspace_id` is cast to text in SQL because Forge can store values larger than JavaScript's safe integer range (`forge.ts:35`, `forge.ts:155`, `forge.ts:238`).
- Forge reports prompt tokens inclusive of cached tokens. CodeBurn subtracts cached tokens from prompt tokens before pricing (`forge.ts:185-188`).
- One CodeBurn call is emitted per assistant message with usage; zero-token assistant messages are skipped (`forge.ts:183-190`).
- Project names come from the conversation title, falling back to `workspace_id` (`forge.ts:244`).

## When fixing a bug here

1. If discovery returns no sessions, confirm the SQLite schema still has `conversations` with `conversation_id`, `workspace_id`, `context`, `created_at`, and `updated_at`.
2. If Node SQLite throws on real data, check whether a numeric field needs `CAST(... AS TEXT)` like `workspace_id`.
3. If costs look too high, verify cached tokens are still subtracted from prompt tokens before calling `calculateCost`.
4. If duplicate rows appear, inspect whether `tool_calls[].call_id` is missing and the parser is falling back to message index.
