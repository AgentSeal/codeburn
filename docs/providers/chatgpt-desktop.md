# ChatGPT Desktop

Pre-provider investigation for the ChatGPT desktop app on macOS.

- **Source:** `src/chatgpt-desktop-diagnostics.ts`
- **CLI:** `codeburn doctor chatgpt-desktop`
- **Test:** `tests/chatgpt-desktop-diagnostics.test.ts`

## Status

Not a usage provider yet. CodeBurn should only add a real ChatGPT Desktop provider if the local app storage exposes defensible token/cost data. Estimating cost from message text length would be misleading for ChatGPT subscriptions and should not be shipped as provider usage.

## What the diagnostic checks

The diagnostic scans known macOS storage roots:

```
~/Library/Application Support/com.openai.chat/
~/Library/Application Support/com.openai.atlas/
```

It recursively finds `.sqlite`, `.sqlite3`, and `.db` files under those roots, opens them read-only, and prints schema metadata only:

- root path found/missing, with the home directory redacted to `~` in CLI output
- database relative path
- table/view count
- column names that look usage-related (`token`, `usage`, `cost`, `model`, `prompt`, `completion`, `input`, `output`)

It does **not** read conversation rows, message text, or column values.

## Expected use for issue #234

Ask affected users to run:

```
codeburn doctor chatgpt-desktop --format json
```

If the app data lives somewhere else, point the diagnostic at one or more
custom roots. Use the platform path delimiter (`:` on macOS/Linux, `;` on
Windows):

```
CODEBURN_CHATGPT_DESKTOP_DIRS="/path/to/com.openai.chat:/path/to/com.openai.atlas" \
  codeburn doctor chatgpt-desktop --format json
```

The JSON output is intended for issue triage: it contains schema metadata and redacted local paths, not row values. If it shows stable token/cost columns, add a real provider with fixtures based on that schema. If it only shows logging/state tables with no token-level accounting, keep #234 open as blocked on upstream storage/API data rather than adding approximate costs.
