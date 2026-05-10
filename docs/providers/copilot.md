# Copilot

GitHub Copilot Chat (CLI and VS Code extension transcripts).

- **Source:** `src/providers/copilot.ts`
- **Loading:** eager (`src/providers/index.ts:3`)
- **Test:** `tests/providers/copilot.test.ts` (401 lines)

## Where it reads from

Two locations. Both are walked on every run; results merge.

1. **Legacy CLI sessions:** `~/.copilot/session-state/`
2. **VS Code transcripts:** `~/Library/Application Support/Code/User/workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/` and equivalents on Windows / Linux

## Storage format

JSONL in both locations, but the schemas differ. The parser switches by detecting which schema the first event uses (`copilot.ts:83-159` for legacy, `copilot.ts:215-293` for transcripts).

## Caching

None at the provider level.

## Deduplication

Per `messageId` in both formats (`copilot.ts:118` for legacy, `copilot.ts:245` for transcripts).

## Model inference

Copilot does not always tag the model on each message. The parser infers it from the tool-call ID prefix:

| Prefix | Inferred model family |
|---|---|
| `toolu_bdrk_`, `toolu_vrtx_`, `tooluse_`, `toolu_` | Anthropic |
| `call_` | OpenAI |

See `copilot.ts:176-213`.

## Quirks

- `toolRequests` can be missing or non-array on older sessions; the parser guards against that (`copilot.ts:126`, `:260`).
- When `outputTokens` is missing the parser falls back to char-counting (`CHARS_PER_TOKEN = 4`, `copilot.ts:252-254`).
- A single chat may be mirrored across both legacy and transcript paths if the user upgraded; the dedup `messageId` collision handles this.

## When fixing a bug here

1. Determine which schema reproduces the bug. The two parsers share little code on purpose; do not unify them unless you understand both formats.
2. If the model is misidentified, look at the tool-call ID prefix list and consider whether a new prefix should be added.
3. New fixtures go under `tests/fixtures/copilot/` and are referenced from `tests/providers/copilot.test.ts`.
