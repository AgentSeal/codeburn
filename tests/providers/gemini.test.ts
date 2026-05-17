import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createGeminiProvider } from '../../src/providers/gemini.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gemini-provider-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function parseFixture(messages: unknown[]): Promise<ParsedProviderCall[]> {
  const filePath = join(tmpDir, 'session-gemini.json')
  await writeFile(filePath, JSON.stringify({
    sessionId: 'gemini-session-1',
    startTime: '2026-05-16T10:00:00.000Z',
    messages,
  }))

  const provider = createGeminiProvider()
  const calls: ParsedProviderCall[] = []
  for await (const call of provider.createSessionParser({ path: filePath, project: 'gemini-project', provider: 'gemini' }, new Set()).parse()) {
    calls.push(call)
  }
  return calls
}

describe('gemini provider', () => {
  it('emits one provider call per Gemini message with token usage', async () => {
    const calls = await parseFixture([
      {
        id: 'u1',
        timestamp: '2026-05-16T10:00:00.000Z',
        type: 'user',
        content: 'inspect the repo',
      },
      {
        id: 'g1',
        timestamp: '2026-05-16T10:00:05.000Z',
        type: 'gemini',
        content: 'reading files',
        model: 'gemini-3.1-pro-preview',
        tokens: { input: 120, cached: 20, output: 30, thoughts: 5 },
        toolCalls: [{ id: 't1', name: 'read_file', args: { path: 'src/index.ts' } }],
      },
      {
        id: 'u2',
        timestamp: '2026-05-16T10:01:00.000Z',
        type: 'user',
        content: [{ text: 'run tests' }],
      },
      {
        id: 'g2',
        timestamp: '2026-05-16T10:01:10.000Z',
        type: 'gemini',
        content: 'running tests',
        model: 'gemini-3.1-pro-preview',
        tokens: { input: 80, cached: 10, output: 25 },
        toolCalls: [{ id: 't2', name: 'run_command', args: { command: 'npm test' } }],
      },
    ])

    expect(calls).toHaveLength(2)
    expect(calls.map(c => c.deduplicationKey)).toEqual([
      'gemini:gemini-session-1:g1',
      'gemini:gemini-session-1:g2',
    ])
    expect(calls.map(c => c.timestamp)).toEqual([
      '2026-05-16T10:00:05.000Z',
      '2026-05-16T10:01:10.000Z',
    ])
    expect(calls.map(c => c.userMessage)).toEqual(['inspect the repo', 'run tests'])
    expect(calls[0]!.inputTokens).toBe(100)
    expect(calls[0]!.cacheReadInputTokens).toBe(20)
    expect(calls[0]!.reasoningTokens).toBe(5)
    expect(calls[0]!.tools).toEqual(['Read'])
    expect(calls[1]!.inputTokens).toBe(70)
    expect(calls[1]!.cacheReadInputTokens).toBe(10)
    expect(calls[1]!.tools).toEqual(['Bash'])
    expect(calls[1]!.bashCommands).toEqual(['npm'])
  })

  it('keeps aggregate token totals when splitting a Gemini session into calls', async () => {
    const calls = await parseFixture([
      { id: 'u1', timestamp: '2026-05-16T10:00:00.000Z', type: 'user', content: 'work' },
      {
        id: 'g1',
        timestamp: '2026-05-16T10:00:05.000Z',
        type: 'gemini',
        content: 'first',
        model: 'gemini-3.1-pro-preview',
        tokens: { input: 120, cached: 20, output: 30, thoughts: 5 },
      },
      {
        id: 'g2',
        timestamp: '2026-05-16T10:00:10.000Z',
        type: 'gemini',
        content: 'second',
        model: 'gemini-3.1-pro-preview',
        tokens: { input: 80, cached: 10, output: 25, thoughts: 0 },
      },
    ])

    expect(calls).toHaveLength(2)
    expect(calls.reduce((sum, call) => sum + call.inputTokens, 0)).toBe(170)
    expect(calls.reduce((sum, call) => sum + call.cacheReadInputTokens, 0)).toBe(30)
    expect(calls.reduce((sum, call) => sum + call.outputTokens, 0)).toBe(55)
    expect(calls.reduce((sum, call) => sum + call.reasoningTokens, 0)).toBe(5)
  })

  it('skips Gemini messages without token usage', async () => {
    const calls = await parseFixture([
      { id: 'u1', timestamp: '2026-05-16T10:00:00.000Z', type: 'user', content: 'work' },
      {
        id: 'info',
        timestamp: '2026-05-16T10:00:05.000Z',
        type: 'gemini',
        content: 'tool-only notice',
        model: 'gemini-3.1-pro-preview',
      },
    ])

    expect(calls).toEqual([])
  })

  it('uses a deterministic ordinal key when Gemini message ids are missing', async () => {
    const messages = [
      { id: 'u1', timestamp: '2026-05-16T10:00:00.000Z', type: 'user', content: 'work' },
      {
        timestamp: '2026-05-16T10:00:05.000Z',
        type: 'gemini',
        content: 'first',
        model: 'gemini-3.1-pro-preview',
        tokens: { input: 10, output: 5 },
      },
      {
        timestamp: '2026-05-16T10:00:10.000Z',
        type: 'gemini',
        content: 'second',
        model: 'gemini-3.1-pro-preview',
        tokens: { input: 12, output: 6 },
      },
    ]

    const first = await parseFixture(messages)
    const second = await parseFixture(messages)

    expect(first.map(c => c.deduplicationKey)).toEqual([
      'gemini:gemini-session-1:idx-0',
      'gemini:gemini-session-1:idx-1',
    ])
    expect(second.map(c => c.deduplicationKey)).toEqual(first.map(c => c.deduplicationKey))
  })

  it('does not poison seenKeys when a Gemini message timestamp is invalid', async () => {
    const filePath = join(tmpDir, 'session-gemini.json')
    await writeFile(filePath, JSON.stringify({
      sessionId: 'gemini-session-1',
      startTime: '2026-05-16T10:00:00.000Z',
      messages: [
        { id: 'u1', timestamp: '2026-05-16T10:00:00.000Z', type: 'user', content: 'work' },
        {
          id: 'g1',
          timestamp: 'not-a-date',
          type: 'gemini',
          content: 'first',
          model: 'gemini-3.1-pro-preview',
          tokens: { input: 10, output: 5 },
        },
      ],
    }))

    const provider = createGeminiProvider()
    const seenKeys = new Set<string>()
    const calls: ParsedProviderCall[] = []
    for await (const call of provider.createSessionParser(
      { path: filePath, project: 'gemini-project', provider: 'gemini' },
      seenKeys,
    ).parse()) {
      calls.push(call)
    }

    expect(calls).toEqual([])
    expect(seenKeys.has('gemini:gemini-session-1:g1')).toBe(false)
  })
})
