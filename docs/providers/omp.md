# OMP

OMP CLI. Same parser as Pi, different data directory.

- **Source:** `src/providers/pi.ts` (the `omp` export)
- **Loading:** eager (`src/providers/index.ts:9`)
- **Test:** `tests/providers/omp.test.ts` (225 lines)

## Where it reads from

`~/.omp/agent/sessions/` (`pi.ts:59-61`).

## Storage format

JSONL, identical schema to Pi.

## Caching

None.

## Deduplication

Identical to Pi: `<provider>:<path>:<responseId>` with timestamp / line-index fallbacks (`pi.ts:164`).

## Quirks

- OMP and Pi share the **same** `createParser` function. The provider object differs only in name, displayName, and the discovery directory.
- If OMP and Pi diverge in a future release, do **not** copy-paste the parser. Add a discriminator to `createParser` and branch.

## When fixing a bug here

1. Check if the bug also reproduces against Pi. If yes, fix both with one change; the parser is shared.
2. If the bug is OMP-specific, the right fix is usually to pass an option into `createParser` rather than to fork the file.
3. Read [`pi.md`](pi.md) for the parser-level details.
