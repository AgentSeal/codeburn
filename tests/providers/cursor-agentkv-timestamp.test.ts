import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'node:module'

import { createCursorProvider } from '../../src/providers/cursor.js'
import { isSqliteAvailable } from '../../src/sqlite.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

const requireForTest = createRequire(import.meta.url)
const skipUnlessSqlite = isSqliteAvailable() ? describe : describe.skip

let tmpDir: string
let oldCacheDir: string | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cursor-agentkv-timestamp-'))
  oldCacheDir = process.env['CODEBURN_CACHE_DIR']
  process.env['CODEBURN_CACHE_DIR'] = join(tmpDir, 'cache')
})

afterEach(async () => {
  if (oldCacheDir === undefined) {
    delete process.env['CODEBURN_CACHE_DIR']
  } else {
    process.env['CODEBURN_CACHE_DIR'] = oldCacheDir
  }
  await rm(tmpDir, { recursive: true, force: true })
})

function agentKvValue(opts: {
  role: 'user' | 'assistant'
  text: string
  requestId: string
  createdAt?: string | number
  modelName?: string
}): string {
  return JSON.stringify({
    role: opts.role,
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    providerOptions: { cursor: { requestId: opts.requestId } },
    content: [{
      text: opts.text,
      ...(opts.modelName ? { providerOptions: { cursor: { modelName: opts.modelName } } } : {}),
    }],
  })
}

async function createAgentKvDb(rows: Array<{ key: string; value: string }>): Promise<string> {
  const dbPath = join(tmpDir, 'state.vscdb')
  await writeFile(dbPath, '')
  const { DatabaseSync: Database } = requireForTest('node:sqlite') as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void
      prepare(sql: string): { run(...params: unknown[]): void }
      close(): void
    }
  }
  const db = new Database(dbPath)
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)')
  const insert = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)')
  for (const row of rows) insert.run(row.key, row.value)
  db.close()
  return dbPath
}

async function collectCursorCalls(dbPath: string): Promise<ParsedProviderCall[]> {
  const provider = createCursorProvider(dbPath)
  const source = { path: dbPath, project: 'cursor', provider: 'cursor' }
  const calls: ParsedProviderCall[] = []
  for await (const call of provider.createSessionParser(source, new Set()).parse()) calls.push(call)
  return calls
}

skipUnlessSqlite('cursor agentKv timestamps', () => {
  it('skips agentKv sessions without internal timestamps instead of using database mtime', async () => {
    const dbPath = await createAgentKvDb([
      {
        key: 'agentKv:blob:req-1:user',
        value: agentKvValue({ role: 'user', requestId: 'req-1', text: '<user_query>old task</user_query>' }),
      },
      {
        key: 'agentKv:blob:req-1:assistant',
        value: agentKvValue({ role: 'assistant', requestId: 'req-1', text: 'old answer', modelName: 'gpt-5' }),
      },
    ])
    await utimes(dbPath, new Date('2099-01-01T00:00:00.000Z'), new Date('2099-01-01T00:00:00.000Z'))
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      const calls = await collectCursorCalls(dbPath)

      expect(calls).toHaveLength(0)
      expect(String(stderrSpy.mock.calls.at(-1)?.[0] ?? '')).toContain('without internal timestamps')
    } finally {
      stderrSpy.mockRestore()
    }
  })

  it('uses agentKv internal createdAt when present', async () => {
    const createdAt = '2025-01-02T03:04:05.000Z'
    const dbPath = await createAgentKvDb([
      {
        key: 'agentKv:blob:req-2:user',
        value: agentKvValue({ role: 'user', requestId: 'req-2', text: '<user_query>old task</user_query>', createdAt }),
      },
      {
        key: 'agentKv:blob:req-2:assistant',
        value: agentKvValue({ role: 'assistant', requestId: 'req-2', text: 'old answer', modelName: 'gpt-5', createdAt }),
      },
    ])
    await utimes(dbPath, new Date('2099-01-01T00:00:00.000Z'), new Date('2099-01-01T00:00:00.000Z'))

    const calls = await collectCursorCalls(dbPath)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.timestamp).toBe(createdAt)
    expect(calls[0]!.deduplicationKey).toBe('cursor:agentKv:req-2')
    expect(calls[0]!.model).toBe('gpt-5')
  })

  it('accepts numeric agentKv timestamps stored as JSON strings', async () => {
    const dbPath = await createAgentKvDb([
      {
        key: 'agentKv:blob:req-3:user',
        value: agentKvValue({
          role: 'user',
          requestId: 'req-3',
          text: '<user_query>old task</user_query>',
          createdAt: '1735787045',
        }),
      },
      {
        key: 'agentKv:blob:req-3:assistant',
        value: agentKvValue({
          role: 'assistant',
          requestId: 'req-3',
          text: 'old answer',
          modelName: 'gpt-5',
          createdAt: '1735787045',
        }),
      },
    ])

    const calls = await collectCursorCalls(dbPath)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.timestamp).toBe('2025-01-02T03:04:05.000Z')
  })
})
