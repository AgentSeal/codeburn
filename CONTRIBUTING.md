# Contributing to CodeBurn

Thanks for your interest. This document covers what you need to know to send a working pull request.

## Prerequisites

- Node.js 22.20 or newer (`engines.node` in `package.json`).
- npm 10 or newer (ships with recent Node).
- macOS or Linux for full provider coverage. Windows works for most providers but Cursor / Antigravity development is easier on macOS.
- Optional: Swift 6 toolchain if you are touching the macOS menubar (`mac/`).
- Optional: GNOME 45 or newer if you are touching the GNOME extension (`gnome/`).

## Setup

```bash
git clone https://github.com/getagentseal/codeburn
cd codeburn
npm install
```

There is no separate build step required to run the dev CLI. `npm run dev` runs `tsx` against `src/cli.ts` directly.

## Common Commands

| Command | What it does |
|---|---|
| `npm test` | Runs the vitest suite (42 test files, 568 tests). |
| `npm run dev -- status` | Runs the CLI in dev mode against your real data. |
| `npm run build` | Bundles the litellm pricing snapshot, then runs `tsup` to produce `dist/cli.js`. |
| `npm run bundle-litellm` | Refreshes `src/data/litellm-snapshot.json` from the upstream litellm repo. |

To test a specific suite, pass a path:

```bash
npm test -- tests/providers/codex.test.ts
```

## What to Read Before Editing

- `docs/architecture.md` for the high-level codebase map.
- `docs/providers/<name>.md` for the provider you intend to change.
- `RELEASING.md` if you are touching version bumps or the release pipeline.
- `SECURITY.md` for the disclosure policy.

## Project Layout

```
src/                CLI, parsers, optimize detectors, cache layers
src/providers/      One file per AI tool integration
src/data/           Bundled litellm pricing snapshot
tests/              vitest specs
mac/                Swift menubar app
gnome/              GNOME shell extension
scripts/            Build helpers (litellm bundle)
```

See `docs/architecture.md` for a fuller map.

## Coding Conventions

- TypeScript strict mode is on. Do not introduce `any` without a comment explaining why.
- Avoid bracket-assign (`obj[key] = value`) on parsed user input in hot paths inside `src/providers/` and `src/parser.ts`. There is a Semgrep rule (`.semgrep/rules/no-bracket-assign-hot-paths.yml`) enforced in CI that will fail your PR if you do. Use a `Map` or an explicit allowlist instead.
- Provider parsers must be deterministic given the same input. If you read the system clock or the filesystem outside the documented session paths, add a fixture-based test.
- New providers go through `src/providers/index.ts`. Lazy-load anything that pulls a heavy native dependency (sqlite, protobuf) so users without that provider are not slowed down.

## Tests

- Each new provider should ship with a fixture-based test under `tests/providers/`. The five providers without test files today (claude, gemini, goose, qwen, antigravity) are a known gap; new code should not add to that list.
- Each new optimize detector in `src/optimize.ts` needs at least one positive and one negative case in `tests/optimize.test.ts`.
- If your change affects the menubar JSON contract, update `tests/menubar-json.test.ts`.

## Commit Message Format

Short imperative subject, optional body. Examples from `git log`:

```
Enhance GNOME extension with scrollable UI, dark mode, charts, and performance fixes
Add table column headers, oneshot placeholder, currency picker dropdown
```

### No AI Co-Author Trailers

The `.github/workflows/block-claude-coauthor.yml` workflow rejects any PR whose commits contain a `Co-authored-by: ... claude ...` or `... anthropic ...` trailer. You may use AI tools to help write code, but strip the co-author line before pushing.

If a flagged PR rejects on this check, the workflow prints the exact rebase command to fix it.

## Pull Requests

1. Fork or branch from `main`.
2. Push your branch and open a PR against `main`.
3. The `firstlook` workflow will auto-assess the PR. The `semgrep` CI workflow runs the hot-path bracket-assign guard. The `block-claude-coauthor` workflow scans commits.
4. A maintainer reviews. For non-trivial changes, expect requests for tests.
5. Squash-merge is the default. Keep the PR title short and accurate; the description carries the context.

## Reporting Bugs

File issues at https://github.com/getagentseal/codeburn/issues. Useful details:

- Output of `codeburn --version`.
- Provider involved and rough size of your session history (`du -sh ~/.codex/sessions`, etc.).
- Output of the failing command with `DEBUG=1` if applicable.
- For parsing bugs: a redacted JSONL or SQLite snippet that reproduces the issue.

## Security Issues

Do not file security issues in the public tracker. See `SECURITY.md` for the disclosure process.

## License

CodeBurn is MIT-licensed. By contributing, you agree your contributions are licensed under the same terms.
