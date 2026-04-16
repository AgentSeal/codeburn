# CodeBurn Development Rules

## Verification
- NEVER commit without running locally first and confirming it works
- Run `npx tsx src/cli.ts report` and `npx tsx src/cli.ts today` to verify changes before any commit
- For dashboard changes: run the interactive TUI and visually confirm rendering
- For new features: test the happy path AND edge cases (empty data, missing config, pipe mode)

## Code Quality
- Clean, minimal code. No dead code, no commented-out blocks, no TODO placeholders
- No emoji anywhere in the codebase
- No em dashes. Use hyphens or rewrite the sentence
- No AI slop: no "streamline", "leverage", "robust", "seamless" in user-facing text
- No unnecessary abstractions. Three similar lines > premature helper function
- No magic numbers. Extract layout offsets, column widths, thresholds, timeouts, and any value used in a calculation into a named `const` at module scope. Inline literals are only OK for universally understood constants (0, 1, 100 for percent). If a number appears in a formula like `pw - bw - 31`, the `31` must be a named constant.

## Accuracy
- Every user-facing number (cost, tokens, calls) must be verified against real data
- LiteLLM pricing model names must match exactly. No guessing model IDs
- Date range calculations must be tested with edge cases (month boundaries, billing day > days in month)

## Style
- TypeScript strict mode. No `any` types
- No comments unless the WHY is non-obvious
- Imports: node builtins first, then deps, then local (separated by blank line)
- Single quotes, no semicolons inconsistency (follow existing: no trailing semicolons in most files)

## Git

### Branching (strict)
- NEVER commit directly to main. All work happens on branches
- Branch naming: `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`
- Merge to main ONLY after: tests pass, CLI verified, manual testing done
- npm publish ONLY from main after merge
- Tag releases: `git tag v0.X.0` after publish

### Creating a branch
```bash
git checkout main && git pull origin main
git checkout -b feat/my-feature
# work, test, iterate
npx vitest run
npx tsx src/cli.ts report
# when ready:
git checkout main && git merge feat/my-feature
git push origin main
```

### Handling external PRs
- NEVER rewrite a contributor's changes on your own branch. Always merge THEIR branch
- Add your improvements as separate commits on top of their branch, not as replacements
- This preserves their authorship in git history so GitHub shows them as a contributor
```bash
gh pr checkout <number>           # checkout PR locally
npx vitest run                    # test their code
npx tsx src/cli.ts report         # manual verification
# apply patches if needed, commit on their branch
git checkout main
git merge <branch>                # preserves their authorship
git push origin main
gh pr comment <number> --body "Merged, thanks!"
```

### What gets committed
- Source code: `src/`, `tests/`
- Config: `package.json`, `tsconfig.json`, `tsup.config.ts`, `.gitignore`
- Docs: `README.md`, `CHANGELOG.md`, `LICENSE`, `CLAUDE.md`
- Assets: `assets/`
- NEVER commit: `.env`, secrets, keys, planning docs (`docs/superpowers/`), IDE config, logs, `.DS_Store`
- Check `git status` before every commit. Stage specific files, never `git add -A` or `git add .`

### Commit rules
- Commits from: AgentSeal <hello@agentseal.org>
- NEVER add Co-Authored-By lines
- NEVER include personal names or usernames in commits
- Small, focused commits. One feature per commit
- Test locally before every commit

### Public-facing language (commits, PRs, release notes, README)
- Commits and release notes are public. Write like you'd publish them.
- NEVER use words like "steal", "stealing", "copy", "rip off", "inspired by" in commit messages
- Describe what the code does, not where ideas came from
- If you must credit prior art, do it in code comments or docs, not commit messages
- No snark, no filler, no self-deprecation. Treat each commit as a product statement
