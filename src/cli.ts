#!/usr/bin/env node
// This launcher must stay parseable by Node 18. Do NOT add static imports.
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write(
    `codeburn requires Node.js >= 22.13.0 (current: ${process.version})\n` +
    'Upgrade at https://nodejs.org/\n',
  )
  process.exit(1)
}

import('./main.js').catch((err) => {
  process.stderr.write(String(err?.message ?? err) + '\n')
  process.exit(1)
})
