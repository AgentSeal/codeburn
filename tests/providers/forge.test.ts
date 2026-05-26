import { mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isSqliteAvailable } from '../../src/sqlite.js'
import { createForgeProvider } from '../../src/providers/forge.js'
import { getProvider } from '../../src/providers/index.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

const requireForTest = createRequire(import.meta.url)

type TestDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): void }
  close(): void
}

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'forge-test-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

function createForgeDb(): string {
  const dbPath = join(tmpRoot, 'forge.db')
  const { DatabaseSync: Database } = requireForTest('node:sqlite')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE conversations(
      conversation_id TEXT PRIMARY KEY NOT NULL,
      title TEXT,
      workspace_id BIGINT NOT NULL,
      context TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP,
      metrics TEXT
    )
  `)
  db.close()
  return dbPath
}

function withTestDb(dbPath: string, fn: (db: TestDb) => void): void {
  const { DatabaseSync: Database } = requireForTest('node:sqlite')
  const db = new Database(dbPath)
  try {
    fn(db)
  } finally {
    db.close()
  }
}

function insertConversationRow(db: TestDb, overrides: {
  conversationId?: string
  title?: string | null
  workspaceId?: number | string
  context?: string | null
  createdAt?: string
  updatedAt?: string | null
} = {}): void {
  db.prepare(`
    INSERT INTO conversations (conversation_id, title, workspace_id, context, created_at, updated_at, metrics)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.conversationId ?? 'conv-1',
    'title' in overrides ? overrides.title : 'Forge Project',
    overrides.workspaceId ?? 123,
    overrides.context ?? null,
    overrides.createdAt ?? '2026-05-06 15:00:00',
    'updatedAt' in overrides ? overrides.updatedAt : '2026-05-06 15:20:41.379094',
    null,
  )
}

function insertConversation(db: TestDb): void {
  const context = {
    conversation_id: 'conv-1',
    messages: [
      { message: { text: { role: 'User', content: 'implement forge' } } },
      {
        message: {
          text: {
            role: 'Assistant',
            content: '',
            model: 'claude-opus-4-6',
            tool_calls: [
              { name: 'shell', call_id: 'call-1', arguments: { command: 'git status && npm test' } },
              { name: 'Read', call_id: 'call-2', arguments: { file_path: '/tmp/a' } },
            ],
          },
        },
        usage: {
          prompt_tokens: { actual: 1200 },
          completion_tokens: { actual: 300 },
          total_tokens: { actual: 1500 },
          cached_tokens: { actual: 200 },
        },
      },
    ],
  }

  insertConversationRow(db, { context: JSON.stringify(context) })
}

async function collect(parser: { parse(): AsyncGenerator<ParsedProviderCall> }): Promise<ParsedProviderCall[]> {
  const out: ParsedProviderCall[] = []
  for await (const call of parser.parse()) out.push(call)
  return out
}

describe('forge provider', () => {
  it('discovers conversations with context and parses assistant usage/tool calls', async () => {
    if (!isSqliteAvailable()) return

    const dbPath = createForgeDb()
    withTestDb(dbPath, insertConversation)

    const provider = createForgeProvider(dbPath)
    const sources = await provider.discoverSessions()

    expect(sources).toEqual([
      {
        path: `${dbPath}:conv-1`,
        project: 'Forge Project',
        provider: 'forge',
      },
    ])

    const seenKeys = new Set<string>()
    const calls = await collect(provider.createSessionParser(sources[0]!, seenKeys))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      provider: 'forge',
      model: 'claude-opus-4-6',
      inputTokens: 1000,
      outputTokens: 300,
      cacheReadInputTokens: 200,
      cachedInputTokens: 200,
      cacheCreationInputTokens: 0,
      tools: ['Bash', 'Read'],
      bashCommands: ['git', 'npm'],
      userMessage: 'implement forge',
      sessionId: 'conv-1',
      timestamp: '2026-05-06T15:20:41.379Z',
      deduplicationKey: 'forge:conv-1:call-1',
    })

    const duplicates = await collect(provider.createSessionParser(sources[0]!, seenKeys))
    expect(duplicates).toEqual([])
  })

  it('does not select conversation context while discovering sessions', async () => {
    const source = await readFile(new URL('../../src/providers/forge.ts', import.meta.url), 'utf8')
    const discoverySql = source.match(/async function discoverFromDb[\s\S]*?db\.query<[^>]+>\(\s*`([\s\S]*?)`/)?.[1]
    const selectedColumns = discoverySql?.split('FROM conversations')[0] ?? ''

    expect(discoverySql).toContain('WHERE context IS NOT NULL')
    expect(selectedColumns).not.toMatch(/\bcontext\b/)
    expect(selectedColumns).not.toMatch(/\bcreated_at\b|\bupdated_at\b/)
  })

  it('returns no sessions when the database is missing', async () => {
    const provider = createForgeProvider(join(tmpRoot, 'missing.db'))

    await expect(provider.discoverSessions()).resolves.toEqual([])
  })

  it('skips zero-token assistant usage', async () => {
    if (!isSqliteAvailable()) return

    const dbPath = createForgeDb()
    const context = {
      messages: [
        { message: { text: { role: 'User', content: 'zero tokens' } } },
        {
          message: { text: { role: 'Assistant', model: 'claude-opus-4-6' } },
          usage: {
            prompt_tokens: { actual: 0 },
            completion_tokens: { actual: 0 },
            cached_tokens: { actual: 0 },
          },
        },
      ],
    }
    withTestDb(dbPath, db => insertConversationRow(db, { context: JSON.stringify(context) }))

    const provider = createForgeProvider(dbPath)
    const sources = await provider.discoverSessions()
    const calls = await collect(provider.createSessionParser(sources[0]!, new Set()))

    expect(calls).toEqual([])
  })

  it('parses multiple assistant messages with the nearest previous user prompt', async () => {
    if (!isSqliteAvailable()) return

    const dbPath = createForgeDb()
    const context = {
      messages: [
        { message: { text: { role: 'User', content: 'first request' } } },
        {
          message: { text: { role: 'Assistant', model: 'claude-opus-4-6', tool_calls: [{ name: 'shell', call_id: 'call-1', arguments: { command: 'npm test' } }] } },
          usage: { prompt_tokens: { actual: 100 }, completion_tokens: { actual: 20 } },
        },
        { message: { text: { role: 'User', content: 'second request' } } },
        {
          message: { text: { role: 'Assistant', model: 'claude-sonnet-4-6', tool_calls: [{ name: 'Read', call_id: 'call-2', arguments: { file_path: '/tmp/a' } }] } },
          usage: { prompt_tokens: { actual: 200 }, completion_tokens: { actual: 30 } },
        },
      ],
    }
    withTestDb(dbPath, db => insertConversationRow(db, { context: JSON.stringify(context) }))

    const provider = createForgeProvider(dbPath)
    const sources = await provider.discoverSessions()
    const calls = await collect(provider.createSessionParser(sources[0]!, new Set()))

    expect(calls).toHaveLength(2)
    expect(calls.map(call => call.userMessage)).toEqual(['first request', 'second request'])
    expect(calls.map(call => call.deduplicationKey)).toEqual(['forge:conv-1:call-1', 'forge:conv-1:call-2'])
  })

  it('uses workspace_id as project when title is null', async () => {
    if (!isSqliteAvailable()) return

    const dbPath = createForgeDb()
    withTestDb(dbPath, db => insertConversationRow(db, { title: null, workspaceId: 'workspace-1', context: '{}' }))

    const provider = createForgeProvider(dbPath)
    const sources = await provider.discoverSessions()

    expect(sources[0]?.project).toBe('workspace-1')
  })

  it('uses large integer workspace_id values as strings when title is null', async () => {
    if (!isSqliteAvailable()) return

    const dbPath = createForgeDb()
    withTestDb(dbPath, db => {
      db.exec(`
        INSERT INTO conversations (conversation_id, title, workspace_id, context, created_at, updated_at, metrics)
        VALUES ('conv-1', NULL, 8549909960051246556, '{}', '2026-05-06 15:00:00', '2026-05-06 15:20:41.379094', NULL)
      `)
    })

    const provider = createForgeProvider(dbPath)
    const sources = await provider.discoverSessions()

    expect(sources[0]?.project).toBe('8549909960051246556')
  })

  it('does not throw and yields no calls for invalid JSON context', async () => {
    if (!isSqliteAvailable()) return

    const dbPath = createForgeDb()
    withTestDb(dbPath, db => insertConversationRow(db, { context: '{invalid' }))

    const provider = createForgeProvider(dbPath)
    const sources = await provider.discoverSessions()

    await expect(collect(provider.createSessionParser(sources[0]!, new Set()))).resolves.toEqual([])
  })

  it('is available through the provider registry', async () => {
    const provider = await getProvider('forge')
    expect(provider?.name).toBe('forge')
  })
})
