# vscode-cline-parser (Shared Helper)

Shared discovery and parsing for VS Code extensions descended from Cline.

- **Source:** `src/providers/vscode-cline-parser.ts`
- **Loading:** not a provider; imported by `kilo-code.ts` and `roo-code.ts`.
- **Test:** none directly. Coverage comes from `tests/providers/kilo-code.test.ts` and `tests/providers/roo-code.test.ts`.

## What it does

Two responsibilities:

1. `discoverClineTasks(extensionId)` walks VS Code's `globalStorage/<extensionId>/tasks/` directories and returns one source per task that has a `ui_messages.json` file (`vscode-cline-parser.ts:25-50`).
2. `createClineParser` reads each task's `ui_messages.json` and `api_conversation_history.json`, extracts model, tools, and token counts, and yields `ParsedProviderCall` objects.

## Storage layout

Per task directory:

```
<globalStorage>/<extensionId>/tasks/<taskId>/
  ui_messages.json                # event stream
  api_conversation_history.json   # full prompt history with model tags
```

## Model resolution

The model is extracted from `api_conversation_history.json` by searching user message content blocks for a `<model>...</model>` tag (`vscode-cline-parser.ts:54-72`). Falls back to `cline-auto` if no tag is found.

## Token extraction

From `api_req_started` entries inside `ui_messages.json`. Each such entry's `text` field is JSON-parsed; the parsed object holds `tokensIn`, `tokensOut`, `cacheReads`, `cacheWrites`, and (optionally) `cost` (`vscode-cline-parser.ts:119-134`).

If `cost` is present, it is used directly. If not, `calculateCost` from `src/models.ts` computes it from tokens (`vscode-cline-parser.ts:139`).

## Deduplication

Per `<providerName>:<taskId>:<index>` where `index` is the position of the `api_req_started` entry within `ui_messages.json` (`vscode-cline-parser.ts:109`).

## Quirks

- Only the **first** user message is emitted as `userMessage` in the `ParsedProviderCall` (`vscode-cline-parser.ts:157`). Subsequent user turns are accounted but not surfaced.
- The model regex looks inside content blocks, not at top-level fields. Some Cline-derivative extensions emit the model elsewhere; if you add support for one, branch on extension ID rather than rewriting the regex.

## When fixing a bug here

1. A change here ripples to **both** KiloCode and Roo Code. Run both test files (`tests/providers/kilo-code.test.ts` and `tests/providers/roo-code.test.ts`) before opening a PR.
2. If you find that one of the two extensions emits a different shape, branch on the extension ID parameter that the discovery function already takes; do not duplicate the parser.
3. If you add support for a third Cline-derivative extension, register it as a thin wrapper file in the same shape as `kilo-code.ts` and `roo-code.ts`.
