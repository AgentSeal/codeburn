import { mkdir, mkdtemp, rm } from 'fs/promises'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  inspectChatGPTDesktop,
  redactChatGPTDesktopDiagnostics,
  renderChatGPTDesktopDiagnostics,
} from '../src/chatgpt-desktop-diagnostics.js'
import { isSqliteAvailable } from '../src/sqlite.js'

const requireForTest = createRequire(import.meta.url)

type TestDb = {
  exec(sql: string): void
  close(): void
}

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'chatgpt-desktop-test-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

function createSqliteDb(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const { DatabaseSync: Database } = requireForTest('node:sqlite')
  const db: TestDb = new Database(path)
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      model_slug TEXT,
      created_at INTEGER
    )
  `)
  db.exec(`
    CREATE TABLE message_usage (
      message_id TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_cost_usd REAL
    )
  `)
  db.exec(`INSERT INTO conversations (id, title, model_slug, created_at) VALUES ('secret-id', 'private title', 'gpt-5', 1)`)
  db.close()
}

describe.skipIf(!isSqliteAvailable())('ChatGPT Desktop diagnostics', () => {
  it('reports missing storage roots without reading data rows', async () => {
    const report = await inspectChatGPTDesktop({
      roots: [join(tmpRoot, 'missing-chat'), join(tmpRoot, 'missing-atlas')],
    })

    expect(report.conclusion).toBe('storage-not-found')
    expect(report.databases).toEqual([])
    expect(report.roots.every(r => !r.exists)).toBe(true)
  })

  it('scans sqlite schemas and surfaces usage-like column names only', async () => {
    const root = join(tmpRoot, 'com.openai.chat')
    await mkdir(root, { recursive: true })
    createSqliteDb(join(root, 'state_5.sqlite'))

    const report = await inspectChatGPTDesktop({ roots: [root] })

    expect(report.conclusion).toBe('usage-candidates-found')
    expect(report.databases).toHaveLength(1)
    expect(report.databases[0]!.relativePath).toBe('state_5.sqlite')

    const usage = report.databases[0]!.tables.find(t => t.name === 'message_usage')
    expect(usage?.usageLikeColumns).toEqual([
      'prompt_tokens',
      'completion_tokens',
      'total_cost_usd',
    ])

    const rendered = renderChatGPTDesktopDiagnostics(report)
    expect(rendered).toContain('state_5.sqlite')
    expect(rendered).toContain('message_usage: prompt_tokens, completion_tokens, total_cost_usd')
    expect(rendered).not.toContain('private title')
    expect(rendered).not.toContain('secret-id')
  })

  it('redacts the home directory in shareable output', () => {
    const homeRoot = join(homedir(), 'Library', 'Application Support', 'com.openai.chat')
    const report = {
      sqliteAvailable: true,
      roots: [{ path: homeRoot, exists: true }],
      databases: [{
        path: join(homeRoot, 'state_5.sqlite'),
        root: homeRoot,
        relativePath: 'state_5.sqlite',
        tables: [],
      }],
      conclusion: 'no-usage-candidates' as const,
    }

    const redacted = redactChatGPTDesktopDiagnostics(report)
    expect(redacted.roots[0]!.path).toBe(`~${homeRoot.slice(homedir().length)}`)
    expect(redacted.databases[0]!.path).toBe(`~${join(homeRoot, 'state_5.sqlite').slice(homedir().length)}`)

    const rendered = renderChatGPTDesktopDiagnostics(report)
    expect(rendered).toContain('~/Library/Application Support/com.openai.chat')
    expect(rendered).not.toContain(homedir())
    expect(report.roots[0]!.path).toBe(homeRoot)
  })
})
