# Roo Code

Roo Code VS Code extension.

- **Source:** `src/providers/roo-code.ts`
- **Loading:** eager (`src/providers/index.ts:11`)
- **Test:** `tests/providers/roo-code.test.ts` (247 lines)

## Where it reads from

VS Code extension globalStorage for `rooveterinaryinc.roo-cline` (extension ID set at `roo-code.ts:4`). The actual walk is delegated to `discoverClineTasks` in `src/providers/vscode-cline-parser.ts`.

## Storage format

Per-task directories with `ui_messages.json` and `api_conversation_history.json`. See [`vscode-cline-parser`](vscode-cline-parser.md) for the schema.

## Caching

None at the provider level; delegates to the shared helper.

## Deduplication

Delegated. Per `<providerName>:<taskId>:<index>` (in `vscode-cline-parser.ts:109`).

## Quirks

- Thin wrapper. Almost every Roo Code bug actually lives in `vscode-cline-parser.ts`.
- The two providers using the cline parser (KiloCode and Roo Code) differ **only** by extension ID.

## When fixing a bug here

1. If the bug also reproduces against KiloCode, fix it in `vscode-cline-parser.ts`.
2. If the bug is Roo Code-specific, the difference is upstream JSON shape. Reproduce with a fixture and consider whether the cline parser needs to branch on extension ID.
3. Read [`vscode-cline-parser.md`](vscode-cline-parser.md) before editing.
