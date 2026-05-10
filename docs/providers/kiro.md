# Kiro

Kiro IDE chat history.

- **Source:** `src/providers/kiro.ts`
- **Loading:** eager (`src/providers/index.ts:7`)
- **Test:** `tests/providers/kiro.test.ts` (328 lines)

## Where it reads from

VS Code-style globalStorage at `kiro.kiroagent`:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent` |
| Windows | `%APPDATA%/Kiro/User/globalStorage/kiro.kiroagent` |
| Linux | `~/.config/Kiro/User/globalStorage/kiro.kiroagent` |

Sessions are `.chat` files under hash-named subdirectories. Discovery is in `kiro.ts:215-247`; the path-resolution helpers it uses start at `kiro.ts:164`.

## Storage format

JSON `.chat` files (`kiro.ts:153`).

## Caching

None.

## Deduplication

Per `executionId` (`kiro.ts:104`).

## Quirks

- **Workspace hash resolution** is non-trivial. The parser tries `workspace.json` first; if that fails, it base64-decodes the directory name to recover the workspace path (`kiro.ts:198-213`).
- **Model ID normalization.** Kiro stores models like `claude-1.2`; the parser rewrites the dot to a hyphen so they match `claude-1-2` in the pricing snapshot (`kiro.ts:65-67`). Add new versions here when Kiro ships them.
- **Tool name extraction is regex-driven.** Kiro embeds tool calls inside the message text as `<tool_use><name>...</name>` (`kiro.ts:69-78`). Brittle but unavoidable until Kiro emits structured tool data.
- Token counts are estimated via char count (`CHARS_PER_TOKEN = 4`, `kiro.ts:9`, `:108-109`).

## When fixing a bug here

1. If the bug is "wrong workspace", check the base64 fallback path. Some users name their workspaces with characters that are not valid base64.
2. If the bug is "missing model in pricing", add the model to the normalization map at `kiro.ts:65-67` and verify against `tests/providers/kiro.test.ts`.
3. If the bug is "tools missing", look at the regex at `kiro.ts:69-78`. Kiro changes its envelope occasionally.
