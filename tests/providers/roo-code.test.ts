import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { rooCode, createRooCodeProvider } from '../../src/providers/roo-code.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let tmpDir: string

function makeUiMessages(opts: {
  tokensIn?: number
  tokensOut?: number
  cacheReads?: number
  cacheWrites?: number
  cost?: number
  userMessage?: string
  ts?: number
}): string {
  const messages: unknown[] = []

  if (opts.userMessage) {
    messages.push({ type: 'say', say: 'user_feedback', text: opts.userMessage, ts: 1700000000000 })
  }

  const apiData: Record<string, unknown> = {
    tokensIn: opts.tokensIn ?? 100,
    tokensOut: opts.tokensOut ?? 50,
    cacheReads: opts.cacheReads ?? 0,
    cacheWrites: opts.cacheWrites ?? 0,
  }
  if (opts.cost !== undefined) apiData.cost = opts.cost

  messages.push({
    type: 'say',
    say: 'api_req_started',
    text: JSON.stringify(apiData),
    ts: opts.ts ?? 1700000001000,
  })

  return JSON.stringify(messages)
}

function makeApiHistory(opts?: { model?: string }): string {
  const modelTag = opts?.model ? `<model>${opts.model}</model>` : ''
  const messages = [
    { role: 'user', content: [{ type: 'text', text: `hello\n<environment_details>\n${modelTag}\n</environment_details>` }] },
    { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
  ]
  return JSON.stringify(messages)
}

describe('roo-code provider - parsing', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'roo-code-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('parses tokens and cost from ui_messages.json', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-001')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), makeUiMessages({
      tokensIn: 200,
      tokensOut: 100,
      cacheReads: 50,
      cacheWrites: 30,
      cost: 0.05,
      userMessage: 'fix the bug',
    }))
    await writeFile(join(taskDir, 'api_conversation_history.json'), makeApiHistory())

    const source = { path: taskDir, project: 'task-001', provider: 'roo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('roo-code')
    expect(call.inputTokens).toBe(200)
    expect(call.outputTokens).toBe(100)
    expect(call.cacheReadInputTokens).toBe(50)
    expect(call.cacheCreationInputTokens).toBe(30)
    expect(call.costUSD).toBe(0.05)
    expect(call.userMessage).toBe('fix the bug')
    expect(call.sessionId).toBe('task-001')
  })

  it('extracts model from api_conversation_history.json', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-002')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), makeUiMessages({ tokensIn: 100, tokensOut: 50 }))
    await writeFile(join(taskDir, 'api_conversation_history.json'), makeApiHistory({ model: 'claude-sonnet-4-5' }))

    const source = { path: taskDir, project: 'task-002', provider: 'roo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('claude-sonnet-4-5')
  })

  it('falls back to cline-auto when no model indicators', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-003')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), makeUiMessages({ tokensIn: 100, tokensOut: 50 }))
    await writeFile(join(taskDir, 'api_conversation_history.json'), JSON.stringify([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ]))

    const source = { path: taskDir, project: 'task-003', provider: 'roo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('cline-auto')
  })

  it('deduplicates across parser runs', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-004')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), makeUiMessages({ tokensIn: 100, tokensOut: 50 }))

    const source = { path: taskDir, project: 'task-004', provider: 'roo-code' }
    const seenKeys = new Set<string>()

    const calls1: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, seenKeys).parse()) calls1.push(call)

    const calls2: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, seenKeys).parse()) calls2.push(call)

    expect(calls1).toHaveLength(1)
    expect(calls2).toHaveLength(0)
  })

  it('handles missing ui_messages.json gracefully', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-005')
    await mkdir(taskDir, { recursive: true })

    const source = { path: taskDir, project: 'task-005', provider: 'roo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(0)
  })

  it('handles invalid JSON gracefully', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-006')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), 'not valid json')

    const source = { path: taskDir, project: 'task-006', provider: 'roo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(0)
  })

  it('skips entries with zero tokens', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-007')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 0, tokensOut: 0 }), ts: 1700000000000 },
    ]))

    const source = { path: taskDir, project: 'task-007', provider: 'roo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(0)
  })

  it('calculates cost from model when cost field missing', async () => {
    const taskDir = join(tmpDir, 'tasks', 'task-008')
    await mkdir(taskDir, { recursive: true })
    await writeFile(join(taskDir, 'ui_messages.json'), makeUiMessages({ tokensIn: 1000, tokensOut: 500 }))
    await writeFile(join(taskDir, 'api_conversation_history.json'), makeApiHistory())

    const source = { path: taskDir, project: 'task-008', provider: 'roo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of rooCode.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.costUSD).toBeGreaterThan(0)
  })
})

describe('roo-code provider - discovery', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'roo-code-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('discovers task directories with ui_messages.json', async () => {
    const task1 = join(tmpDir, 'tasks', 'task-a')
    const task2 = join(tmpDir, 'tasks', 'task-b')
    await mkdir(task1, { recursive: true })
    await mkdir(task2, { recursive: true })
    await writeFile(join(task1, 'ui_messages.json'), '[]')
    await writeFile(join(task2, 'ui_messages.json'), '[]')

    const provider = createRooCodeProvider(tmpDir)
    const sessions = await provider.discoverSessions()

    expect(sessions).toHaveLength(2)
    expect(sessions.every(s => s.provider === 'roo-code')).toBe(true)
  })

  it('skips tasks without ui_messages.json', async () => {
    const task = join(tmpDir, 'tasks', 'task-no-ui')
    await mkdir(task, { recursive: true })
    await writeFile(join(task, 'api_conversation_history.json'), '[]')

    const provider = createRooCodeProvider(tmpDir)
    const sessions = await provider.discoverSessions()

    expect(sessions).toHaveLength(0)
  })

  it('returns empty for nonexistent directory', async () => {
    const provider = createRooCodeProvider('/nonexistent/path')
    const sessions = await provider.discoverSessions()
    expect(sessions).toHaveLength(0)
  })
})

describe('roo-code provider - metadata', () => {
  it('has correct name and displayName', () => {
    expect(rooCode.name).toBe('roo-code')
    expect(rooCode.displayName).toBe('Roo Code')
  })

  it('passes through model display names', () => {
    expect(rooCode.modelDisplayName('claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
  })

  it('passes through tool display names', () => {
    expect(rooCode.toolDisplayName('read_file')).toBe('read_file')
  })
})
