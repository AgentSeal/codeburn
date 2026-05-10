# OpenClaw

OpenClaw, plus the older Clawdbot / Moltbot / Moldbot lineage.

- **Source:** `src/providers/openclaw.ts`
- **Loading:** eager (`src/providers/index.ts:8`)
- **Test:** `tests/providers/openclaw.test.ts` (192 lines)

## Where it reads from

Four directories, all checked on every run (`openclaw.ts:62-70`):

- `~/.openclaw/agents`
- `~/.clawdbot/agents`
- `~/.moltbot/agents`
- `~/.moldbot/agents`

The legacy directories are kept for users who upgraded from older builds.

## Storage format

JSONL (`openclaw.ts:242`). Each agents directory has a `sessions.json` index file plus per-session `.jsonl` files. The parser reads the index when present and falls back to a directory scan if it is missing or stale (`openclaw.ts:220-247`).

## Caching

None.

## Deduplication

Per `<sessionId>:<dedupId>` (`openclaw.ts:169`).

## Quirks

- **Cost is preferred from the provider when reported.** OpenClaw emits `costUSD` in `message.usage`; the parser uses it directly when present (`openclaw.ts:174-177`) and only computes from tokens when it is missing.
- Tokens are reported across `input`, `output`, `cacheRead`, and `cacheWrite`. Anthropic semantics throughout, no normalization needed.

## When fixing a bug here

1. If the bug is "session not found", check the four legacy dirs. A user might have a stray `~/.moltbot/` that the parser is reading instead of the real `~/.openclaw/`.
2. If the bug is "wrong cost", confirm whether `costUSD` is present in the source data; the parser trusts it over its own calculation.
3. The `sessions.json` index can drift when the user crashes mid-session. Make sure the directory-scan fallback triggers in those cases.
