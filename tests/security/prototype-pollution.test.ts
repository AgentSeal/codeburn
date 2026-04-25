import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { DateRange } from '../../src/types.js'

// Generated sessions carry timestamps near 2026-04-16T00:00:00Z. The range below
// must stay wide enough to include that date.
const FIXTURE_DAY = Date.UTC(2026, 3, 16) // month index 3 = April (Date.UTC is 0-indexed)
const RANGE_BEFORE_MS = FIXTURE_DAY - 24 * 60 * 60 * 1000
const RANGE_AFTER_MS = FIXTURE_DAY + 24 * 60 * 60 * 1000

function makeRange(offsetMs: number): DateRange {
  return {
    start: new Date(RANGE_BEFORE_MS + offsetMs),
    end: new Date(RANGE_AFTER_MS + offsetMs),
  }
}

describe('HIGH-1 prototype pollution via unchecked bracket-assign', () => {
  const tmpDirs: string[] = []
  let originalAugmentHome: string | undefined
  let originalCacheDir: string | undefined

  beforeEach(() => {
    originalAugmentHome = process.env['AUGMENT_HOME']
    originalCacheDir = process.env['CODEBURN_CACHE_DIR']
  })

  afterEach(async () => {
    delete (Object.prototype as Record<string, unknown>).calls
    if (originalAugmentHome === undefined) {
      delete process.env['AUGMENT_HOME']
    } else {
      process.env['AUGMENT_HOME'] = originalAugmentHome
    }
    if (originalCacheDir === undefined) {
      delete process.env['CODEBURN_CACHE_DIR']
    } else {
      process.env['CODEBURN_CACHE_DIR'] = originalCacheDir
    }
    vi.resetModules()
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop()
      if (d) await rm(d, { recursive: true, force: true })
    }
  })

  async function setupPoc(
    responseNode: Record<string, unknown>,
    timestampMs: number,
    modelId = 'claude-sonnet-4-5',
  ): Promise<void> {
    const base = await mkdtemp(join(tmpdir(), 'codeburn-sec-'))
    tmpDirs.push(base)
    const sessionsDir = join(base, 'sessions')
    await mkdir(sessionsDir, { recursive: true })
    process.env['AUGMENT_HOME'] = base
    process.env['CODEBURN_CACHE_DIR'] = join(base, 'cache')

    const session = {
      sessionId: 'security-test',
      created: new Date(timestampMs).toISOString(),
      modified: new Date(timestampMs).toISOString(),
      agentState: { modelId },
      chatHistory: [
        {
          exchange: {
            request_id: `req-${timestampMs}`,
            request_message: 'security regression',
            response_nodes: [responseNode],
          },
        },
      ],
    }
    await writeFile(join(sessionsDir, 'pwn.json'), JSON.stringify(session), 'utf-8')
    vi.resetModules()
  }

  async function parseFixture(range: DateRange): Promise<void> {
    const { parseAllSessions } = await import('../../src/parser.js')
    await expect(parseAllSessions(range)).resolves.not.toThrow()
  }

  it('does not pollute Object.prototype when session contains tool_use name "__proto__"', async () => {
    const timestampMs = FIXTURE_DAY
    await setupPoc({
      id: 0,
      type: 8,
      tool_use: { tool_name: '__proto__', input: {} },
      token_usage: { input_tokens: 1, output_tokens: 1 },
      metadata: { provider: 'anthropic' },
      timestamp_ms: timestampMs,
    }, timestampMs)
    await parseFixture(makeRange(0))
    expect(({} as Record<string, unknown>).calls).toBeUndefined()
  })

  it('does not pollute Object.prototype when bash command basename is "__proto__"', async () => {
    const timestampMs = FIXTURE_DAY + 1
    await setupPoc({
      id: 0,
      type: 8,
      tool_use: { tool_name: 'launch-process', input: { command: '/x/__proto__' } },
      token_usage: { input_tokens: 1, output_tokens: 1 },
      metadata: { provider: 'anthropic' },
      timestamp_ms: timestampMs,
    }, timestampMs)
    await parseFixture(makeRange(1))
    expect(({} as Record<string, unknown>).calls).toBeUndefined()
  })

  it('does not pollute Object.prototype when model name is "__proto__"', async () => {
    const timestampMs = FIXTURE_DAY + 2
    await setupPoc({
      id: 0,
      type: 8,
      tool_use: null,
      token_usage: { input_tokens: 1, output_tokens: 1 },
      metadata: { provider: 'anthropic' },
      timestamp_ms: timestampMs,
    }, timestampMs, '__proto__')
    await parseFixture(makeRange(2))
    expect(({} as Record<string, unknown>).calls).toBeUndefined()
  })
})
