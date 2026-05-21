import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'
import { isSqliteAvailable } from '../src/sqlite.js'

const requireForTest = createRequire(import.meta.url)

type TestDb = {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): void }
  close(): void
}

function runCli(args: string[], home: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      HERMES_HOME: join(home, '.hermes'),
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CODEBURN_CACHE_DIR: join(home, '.cache', 'codeburn'),
      TZ: 'UTC',
    },
    encoding: 'utf-8',
    timeout: 30_000,
  })
}

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

const describeIfSqlite = isSqliteAvailable() ? describe : describe.skip

describeIfSqlite('CLI Hermes provider regression', () => {
  it('reads Hermes CLI usage from ~/.hermes/state.db with --provider hermes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-hermes-cli-'))

    try {
      const dbPath = createHermesDb(home)
      withTestDb(dbPath, db => {
        db.prepare(`
          INSERT INTO sessions (
            id, source, model, started_at, ended_at, message_count,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            reasoning_tokens, estimated_cost_usd, title
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          '20260521_070000_abc123',
          'cli',
          'anthropic/claude-sonnet-4.6',
          1779345600,
          1779345900,
          2,
          1200,
          340,
          90,
          40,
          25,
          0.031,
          'Hermes auth fix',
        )
        db.prepare(`
          INSERT INTO messages (
            id, session_id, role, content, tool_calls, timestamp, reasoning_content
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          1,
          '20260521_070000_abc123',
          'user',
          'wire Hermes support into codeburn',
          null,
          1779345600,
          null,
        )
        db.prepare(`
          INSERT INTO messages (
            id, session_id, role, content, tool_calls, timestamp, reasoning_content
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          2,
          '20260521_070000_abc123',
          'assistant',
          'implemented the provider',
          JSON.stringify([
            { name: 'terminal', arguments: JSON.stringify({ command: 'npm test -- --run tests/providers/hermes.test.ts' }) },
            { name: 'write_file', arguments: JSON.stringify({ path: 'src/providers/hermes.ts' }) },
          ]),
          1779345660,
          'checked the state.db schema',
        )
      })

      const result = runCli([
        '--format', 'json',
        '--from', '2026-05-21',
        '--to', '2026-05-21',
        '--provider', 'hermes',
      ], home)

      expect(result.status, `stderr: ${result.stderr}`).toBe(0)

      const report = JSON.parse(result.stdout) as {
        overview: {
          calls: number
          cost: number
          tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
        }
        models: Array<{ name: string; calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number }>
        tools: Array<{ name: string; calls: number }>
      }
      const model = report.models.find(m => m.name === 'Sonnet 4.6')

      expect(report.overview.calls).toBe(1)
      expect(report.overview.tokens.input).toBe(1200)
      expect(report.overview.tokens.output).toBe(340)
      expect(report.overview.tokens.cacheRead).toBe(90)
      expect(report.overview.tokens.cacheWrite).toBe(40)
      expect(report.overview.cost).toBeCloseTo(0.031, 8)
      expect(model).toBeDefined()
      expect(model!.calls).toBe(1)
      expect(model!.inputTokens).toBe(1200)
      expect(model!.outputTokens).toBe(340)
      expect(model!.cacheReadTokens).toBe(90)
      expect(model!.cacheWriteTokens).toBe(40)
      expect(model!.cost).toBeCloseTo(0.031, 8)
      expect(report.tools.find(t => t.name === 'Bash')?.calls).toBe(1)
      expect(report.tools.find(t => t.name === 'Write')?.calls).toBe(1)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
