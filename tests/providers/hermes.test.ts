import { mkdtemp, rm } from 'fs/promises'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHermesProvider } from '../../src/providers/hermes.js'
import { isSqliteAvailable } from '../../src/sqlite.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

const requireForTest = createRequire(import.meta.url)

type TestDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): void }
  close(): void
}

type SessionFixture = {
  id: string
  source?: string
  model?: string | null
  title?: string | null
  parentSessionId?: string | null
  startedAt?: number
  endedAt?: number | null
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  estimatedCostUsd?: number | null
  actualCostUsd?: number | null
}

type MessageFixture = {
  id: number
  sessionId: string
  role: string
  content?: string | null
  toolCalls?: unknown
  toolName?: string | null
  timestamp: number
  tokenCount?: number | null
  reasoningContent?: string | null
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'hermes-provider-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function createHermesDb(home: string): string {
  const hermesHome = join(home, '.hermes')
  mkdirSync(hermesHome, { recursive: true })
  const dbPath = join(hermesHome, 'state.db')
  const { DatabaseSync: Database } = requireForTest('node:sqlite')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      user_id TEXT,
      model TEXT,
      model_config TEXT,
      system_prompt TEXT,
      parent_session_id TEXT,
      started_at REAL NOT NULL,
      ended_at REAL,
      end_reason TEXT,
      message_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      billing_provider TEXT,
      billing_base_url TEXT,
      billing_mode TEXT,
      estimated_cost_usd REAL,
      actual_cost_usd REAL,
      cost_status TEXT,
      cost_source TEXT,
      pricing_version TEXT,
      title TEXT,
      api_call_count INTEGER DEFAULT 0,
      handoff_state TEXT,
      handoff_platform TEXT,
      handoff_error TEXT
    )
  `)
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_call_id TEXT,
      tool_calls TEXT,
      tool_name TEXT,
      timestamp REAL NOT NULL,
      token_count INTEGER,
      finish_reason TEXT,
      reasoning TEXT,
      reasoning_content TEXT,
      reasoning_details TEXT,
      codex_reasoning_items TEXT,
      codex_message_items TEXT,
      platform_message_id TEXT
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

function insertSession(db: TestDb, fixture: SessionFixture): void {
  db.prepare(`
    INSERT INTO sessions (
      id, source, model, parent_session_id, started_at, ended_at, input_tokens,
      output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      estimated_cost_usd, actual_cost_usd, title, message_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    fixture.id,
    fixture.source ?? 'cli',
    fixture.model ?? 'claude-sonnet-4-6',
    fixture.parentSessionId ?? null,
    fixture.startedAt ?? 1779345600,
    fixture.endedAt ?? null,
    fixture.inputTokens ?? 0,
    fixture.outputTokens ?? 0,
    fixture.cacheReadTokens ?? 0,
    fixture.cacheWriteTokens ?? 0,
    fixture.reasoningTokens ?? 0,
    fixture.estimatedCostUsd ?? null,
    fixture.actualCostUsd ?? null,
    fixture.title ?? null,
  )
}

function insertMessage(db: TestDb, fixture: MessageFixture): void {
  db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content, tool_calls, tool_name, timestamp,
      token_count, reasoning_content
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fixture.id,
    fixture.sessionId,
    fixture.role,
    fixture.content ?? null,
    fixture.toolCalls ? JSON.stringify(fixture.toolCalls) : null,
    fixture.toolName ?? null,
    fixture.timestamp,
    fixture.tokenCount ?? null,
    fixture.reasoningContent ?? null,
  )
}

async function collect(provider: ReturnType<typeof createHermesProvider>, dbPath: string, sessionId: string, seenKeys = new Set<string>()): Promise<ParsedProviderCall[]> {
  const source = {
    path: `${dbPath}#hermes-session=${encodeURIComponent(sessionId)}`,
    project: 'hermes',
    provider: 'hermes',
  }
  const calls: ParsedProviderCall[] = []
  for await (const call of provider.createSessionParser(source, seenKeys).parse()) {
    calls.push(call)
  }
  return calls
}

const skipUnlessSqlite = isSqliteAvailable() ? describe : describe.skip

skipUnlessSqlite('hermes provider', () => {
  it('discovers root sessions from Hermes state.db', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, {
        id: '20260521_070000_abc123',
        title: 'Fix auth flow',
        inputTokens: 100,
      })
      insertSession(db, {
        id: 'child-session',
        title: 'child',
        parentSessionId: '20260521_070000_abc123',
        inputTokens: 100,
      })
    })

    const sessions = await createHermesProvider(join(tmpDir, '.hermes')).discoverSessions()

    expect(sessions).toEqual([{
      path: `${dbPath}#hermes-session=20260521_070000_abc123`,
      project: 'Fix auth flow',
      provider: 'hermes',
    }])
  })

  it('warns and skips discovery when Hermes state.db has drifted columns', async () => {
    const hermesHome = join(tmpDir, '.hermes')
    mkdirSync(hermesHome, { recursive: true })
    const dbPath = join(hermesHome, 'state.db')
    const { DatabaseSync: Database } = requireForTest('node:sqlite')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY);
      CREATE TABLE messages (id INTEGER PRIMARY KEY);
    `)
    db.close()
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      const sessions = await createHermesProvider(hermesHome).discoverSessions()

      expect(sessions).toEqual([])
      expect(write.mock.calls.some(([message]) =>
        String(message).includes('Hermes state.db is missing expected tables or columns'),
      )).toBe(true)
    } finally {
      write.mockRestore()
    }
  })

  it('parses session totals, tool calls, bash commands, and stored cost', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, {
        id: 'sess-1',
        model: 'anthropic/claude-sonnet-4.6',
        title: 'Auth bug',
        inputTokens: 1000,
        outputTokens: 250,
        cacheReadTokens: 80,
        cacheWriteTokens: 20,
        reasoningTokens: 30,
        actualCostUsd: 0.42,
      })
      insertMessage(db, {
        id: 1,
        sessionId: 'sess-1',
        role: 'user',
        content: 'fix auth bug',
        timestamp: 1779345600,
      })
      insertMessage(db, {
        id: 2,
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'patched the auth flow',
        reasoningContent: 'checked route guard',
        toolCalls: [
          { name: 'terminal', arguments: JSON.stringify({ command: 'npm test && git status' }) },
          { function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/auth.ts' }) } },
        ],
        timestamp: 1779345660,
      })
    })

    const calls = await collect(createHermesProvider(join(tmpDir, '.hermes')), dbPath, 'sess-1')

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('hermes')
    expect(call.model).toBe('anthropic/claude-sonnet-4.6')
    expect(call.inputTokens).toBe(1000)
    expect(call.outputTokens).toBe(250)
    expect(call.cacheReadInputTokens).toBe(80)
    expect(call.cacheCreationInputTokens).toBe(20)
    expect(call.reasoningTokens).toBe(30)
    expect(call.costUSD).toBeCloseTo(0.42, 8)
    expect(call.costIsEstimated).toBe(false)
    expect(call.preserveCostUSD).toBe(true)
    expect(call.tools).toEqual(['Bash', 'Read'])
    expect(call.bashCommands).toEqual(['npm', 'git'])
    expect(call.userMessage).toBe('fix auth bug')
    expect(call.timestamp).toBe('2026-05-21T06:41:00.000Z')
    expect(call.sessionId).toBe('sess-1')
    expect(call.turnId).toBe('sess-1:turn-0')
    expect(call.deduplicationKey).toBe('hermes:sess-1:2')
  })

  it('attaches tool result rows to the preceding assistant turn', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, { id: 'sess-tools', title: 'Search', inputTokens: 10 })
      insertMessage(db, {
        id: 1,
        sessionId: 'sess-tools',
        role: 'assistant',
        content: '',
        timestamp: 1779345600,
      })
      insertMessage(db, {
        id: 2,
        sessionId: 'sess-tools',
        role: 'tool',
        toolName: 'web_search',
        content: 'results',
        timestamp: 1779345601,
      })
    })

    const calls = await collect(createHermesProvider(join(tmpDir, '.hermes')), dbPath, 'sess-tools')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.tools).toEqual(['WebSearch'])
    expect(calls[0]!.webSearchRequests).toBe(1)
  })

  it('does not double count tool result rows when assistant tool_calls are present', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, { id: 'sess-no-double-tools', title: 'Search', inputTokens: 10 })
      insertMessage(db, {
        id: 1,
        sessionId: 'sess-no-double-tools',
        role: 'assistant',
        content: '',
        toolCalls: [{ name: 'web_search', arguments: JSON.stringify({ query: 'hermes cli' }) }],
        timestamp: 1779345600,
      })
      insertMessage(db, {
        id: 2,
        sessionId: 'sess-no-double-tools',
        role: 'tool',
        toolName: 'web_search',
        content: 'results',
        timestamp: 1779345601,
      })
    })

    const calls = await collect(createHermesProvider(join(tmpDir, '.hermes')), dbPath, 'sess-no-double-tools')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.tools).toEqual(['WebSearch'])
    expect(calls[0]!.webSearchRequests).toBe(1)
  })

  it('keeps recursive session parsing bounded when parent links form a cycle', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, { id: 'cycle-a', parentSessionId: 'cycle-b', startedAt: 1779345600, inputTokens: 100 })
      insertSession(db, { id: 'cycle-b', parentSessionId: 'cycle-a', startedAt: 1779345601, inputTokens: 200 })
      insertMessage(db, { id: 1, sessionId: 'cycle-a', role: 'assistant', content: 'a', timestamp: 1779345600 })
      insertMessage(db, { id: 2, sessionId: 'cycle-b', role: 'assistant', content: 'b', timestamp: 1779345601 })
    })

    const calls = await collect(createHermesProvider(join(tmpDir, '.hermes')), dbPath, 'cycle-a')

    expect(calls.map(call => call.deduplicationKey)).toEqual([
      'hermes:cycle-a:1',
      'hermes:cycle-b:2',
    ])
  })

  it('uses message token_count to split output tokens across multi-turn sessions', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, { id: 'sess-token-count', outputTokens: 100 })
      insertMessage(db, {
        id: 1,
        sessionId: 'sess-token-count',
        role: 'assistant',
        content: 'short visible text',
        tokenCount: 25,
        timestamp: 1779345600,
      })
      insertMessage(db, {
        id: 2,
        sessionId: 'sess-token-count',
        role: 'assistant',
        content: 'another short visible text',
        tokenCount: 75,
        timestamp: 1779345601,
      })
    })

    const calls = await collect(createHermesProvider(join(tmpDir, '.hermes')), dbPath, 'sess-token-count')

    expect(calls.map(call => call.outputTokens)).toEqual([25, 75])
  })

  it('does not request cached cost preservation for locally calculated costs', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, {
        id: 'sess-calculated-cost',
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 100,
      })
      insertMessage(db, { id: 1, sessionId: 'sess-calculated-cost', role: 'assistant', content: 'done', timestamp: 1779345600 })
    })

    const calls = await collect(createHermesProvider(join(tmpDir, '.hermes')), dbPath, 'sess-calculated-cost')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.costUSD).toBeGreaterThan(0)
    expect(calls[0]!.preserveCostUSD).toBe(false)
  })

  it('parses child sessions through the discovered root source', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, { id: 'root', title: 'Root', inputTokens: 100, outputTokens: 10 })
      insertSession(db, { id: 'child', parentSessionId: 'root', inputTokens: 200, outputTokens: 20 })
      insertMessage(db, { id: 1, sessionId: 'root', role: 'assistant', content: 'root answer', timestamp: 1779345600 })
      insertMessage(db, { id: 2, sessionId: 'child', role: 'assistant', content: 'child answer', timestamp: 1779345660 })
    })

    const calls = await collect(createHermesProvider(join(tmpDir, '.hermes')), dbPath, 'root')

    expect(calls).toHaveLength(2)
    expect(calls.map(call => call.sessionId)).toEqual(['root', 'root'])
    expect(calls.map(call => call.deduplicationKey)).toEqual([
      'hermes:root:1',
      'hermes:child:2',
    ])
    expect(calls.map(call => call.inputTokens)).toEqual([100, 200])
    expect(calls.map(call => call.outputTokens)).toEqual([10, 20])
  })

  it('deduplicates calls across parser runs', async () => {
    const dbPath = createHermesDb(tmpDir)
    withTestDb(dbPath, db => {
      insertSession(db, { id: 'sess-dedup', inputTokens: 100, outputTokens: 10 })
      insertMessage(db, { id: 1, sessionId: 'sess-dedup', role: 'assistant', content: 'done', timestamp: 1779345600 })
    })

    const provider = createHermesProvider(join(tmpDir, '.hermes'))
    const seenKeys = new Set<string>()
    const first = await collect(provider, dbPath, 'sess-dedup', seenKeys)
    const second = await collect(provider, dbPath, 'sess-dedup', seenKeys)

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(seenKeys.has('hermes:sess-dedup:1')).toBe(true)
  })
})
