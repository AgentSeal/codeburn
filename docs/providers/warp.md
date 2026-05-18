# Warp

Warp Oz agent sessions from Warp's local SQLite database.

- **Source:** `src/providers/warp.ts`
- **Loading:** lazy (`src/providers/index.ts`)
- **Test:** `tests/providers/warp.test.ts`

## Where it reads from

A SQLite database in Warp's group container.

| Channel | Default path |
|---|---|
| Stable | `~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Stable/warp.sqlite` |
| Preview | `~/Library/Group Containers/2BBY89MBSN.dev.warp/Library/Application Support/dev.warp.Warp-Preview/warp.sqlite` |

Override with `WARP_DB_PATH` when needed.

## Storage format

SQLite. The parser requires these tables:

- `agent_conversations`
- `ai_queries`
- `blocks`

## Caching

No provider-specific cache. Standard CodeBurn session cache applies.

## Deduplication

Per exchange: `warp:<conversationId>:<exchangeId>`.

## What we extract

| codeburn field | Warp source |
|---|---|
| `sessionId` | `agent_conversations.conversation_id` |
| `timestamp` | `ai_queries.start_ts` |
| `userMessage` | `ai_queries.input[0].Query.text` (when present) |
| `project` / `projectPath` | `ai_queries.working_directory` |
| `model` | `ai_queries.model_id` with fallback to dominant `conversation_data.token_usage[*].model_id` |
| `tools` / `bashCommands` | `blocks.stylized_command` grouped onto nearest preceding exchange |
| `inputTokens` | Estimated from prompt-size weighting, normalized to conversation token totals |

`outputTokens` are set to `0` because Warp does not expose a reliable per-exchange input/output split in these tables.

## Quirks

- `ai_queries.output_status` may be stored as a JSON-quoted string (for example `"Completed"`). The parser normalizes this before filtering.
- Warp auto model IDs (`auto-efficient`, `auto-powerful`) are resolved using dominant conversation model information when available.
- Token and cost attribution is estimated. Calls are emitted with `costIsEstimated: true`.
- Command blocks are attached to the closest preceding exchange in the same conversation based on `start_ts`.

## When fixing a bug here

1. Reproduce with a fixture SQLite in `tests/providers/warp.test.ts` before changing parser logic.
2. Verify schema compatibility first (`agent_conversations`, `ai_queries`, `blocks`) before debugging parse behavior.
3. If model/cost looks wrong, inspect both `ai_queries.model_id` and `conversation_data.conversation_usage_metadata.token_usage`.
4. If command attribution is wrong, compare `blocks.start_ts` ordering against `ai_queries.start_ts`; attribution is timestamp-based.
