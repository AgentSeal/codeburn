import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { kiro, createKiroProvider } from '../../src/providers/kiro.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let tmpDir: string

function makeChatFile(opts: {
  executionId?: string
  modelId?: string
  workflowId?: string
  startTime?: number
  endTime?: number
  userPrompt?: string
  botResponses?: string[]
}) {
  const chat = [
    { role: 'human', content: '<identity>\nYou are Kiro.\n</identity>' },
    { role: 'bot', content: '' },
    { role: 'tool', content: 'workspace tree...' },
    { role: 'bot', content: 'I will follow these instructions.' },
  ]

  if (opts.userPrompt) {
    chat.push({ role: 'human', content: opts.userPrompt })
  }

  for (const resp of opts.botResponses ?? ['Done.']) {
    chat.push({ role: 'bot', content: resp })
  }

  return JSON.stringify({
    executionId: opts.executionId ?? 'exec-001',
    actionId: 'act',
    context: [],
    validations: {},
    chat,
    metadata: {
      modelId: opts.modelId ?? 'claude-haiku-4-5',
      modelProvider: 'qdev',
      workflow: 'act',
      workflowId: opts.workflowId ?? 'wf-001',
      startTime: opts.startTime ?? 1777333000000,
      endTime: opts.endTime ?? 1777333010000,
    },
  })
}

describe('kiro provider - chat file parsing', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kiro-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('parses a basic chat file', async () => {
    const wsHash = 'a'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    const chatPath = join(wsDir, 'abc123.chat')
    await writeFile(chatPath, makeChatFile({
      modelId: 'claude-haiku-4-5',
      userPrompt: 'explain the code',
      botResponses: ['Here is an explanation of the code structure.'],
    }))

    const source = { path: chatPath, project: 'myproject', provider: 'kiro' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('kiro')
    expect(call.model).toBe('claude-haiku-4-5')
    expect(call.outputTokens).toBeGreaterThan(0)
    expect(call.userMessage).toBe('explain the code')
    expect(call.bashCommands).toEqual([])
    expect(call.costUSD).toBeGreaterThan(0)
  })

  it('stores kiro-auto when model is auto', async () => {
    const wsHash = 'b'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    const chatPath = join(wsDir, 'abc.chat')
    await writeFile(chatPath, makeChatFile({
      modelId: 'auto',
      botResponses: ['some output'],
    }))

    const source = { path: chatPath, project: 'test', provider: 'kiro' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('kiro-auto')
    expect(calls[0]!.costUSD).toBeGreaterThan(0)
  })

  it('skips chat files with no bot output', async () => {
    const wsHash = 'c'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    const chatPath = join(wsDir, 'empty.chat')
    await writeFile(chatPath, JSON.stringify({
      executionId: 'exec-empty',
      actionId: 'act',
      context: [],
      validations: {},
      chat: [
        { role: 'human', content: '<identity>\nYou are Kiro.\n</identity>' },
        { role: 'bot', content: '' },
        { role: 'human', content: 'do something' },
        { role: 'bot', content: '' },
      ],
      metadata: {
        modelId: 'claude-haiku-4-5',
        modelProvider: 'qdev',
        workflow: 'act',
        workflowId: 'wf-empty',
        startTime: 1777333000000,
        endTime: 1777333010000,
      },
    }))

    const source = { path: chatPath, project: 'test', provider: 'kiro' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(0)
  })

  it('deduplicates across parser runs', async () => {
    const wsHash = 'd'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    const chatPath = join(wsDir, 'dup.chat')
    await writeFile(chatPath, makeChatFile({ botResponses: ['hello'] }))

    const source = { path: chatPath, project: 'test', provider: 'kiro' }
    const seenKeys = new Set<string>()

    const calls1: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, seenKeys).parse()) calls1.push(call)

    const calls2: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, seenKeys).parse()) calls2.push(call)

    expect(calls1).toHaveLength(1)
    expect(calls2).toHaveLength(0)
  })

  it('returns empty for missing file', async () => {
    const source = { path: '/nonexistent/test.chat', project: 'test', provider: 'kiro' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)
    expect(calls).toHaveLength(0)
  })

  it('returns empty for invalid JSON', async () => {
    const wsHash = 'e'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    const chatPath = join(wsDir, 'bad.chat')
    await writeFile(chatPath, 'not json at all')

    const source = { path: chatPath, project: 'test', provider: 'kiro' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)
    expect(calls).toHaveLength(0)
  })

  it('estimates tokens from text length', async () => {
    const wsHash = 'f'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    const chatPath = join(wsDir, 'tokens.chat')
    const longResponse = 'x'.repeat(400)
    await writeFile(chatPath, makeChatFile({ botResponses: [longResponse] }))

    const source = { path: chatPath, project: 'test', provider: 'kiro' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.outputTokens).toBe(109)
  })

  it('normalizes dot-versioned model IDs to dashes', async () => {
    const wsHash = 'h'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    const chatPath = join(wsDir, 'dot.chat')
    await writeFile(chatPath, makeChatFile({
      modelId: 'claude-haiku-4.5',
      botResponses: ['response text here'],
    }))

    const source = { path: chatPath, project: 'test', provider: 'kiro' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('claude-haiku-4-5')
    expect(calls[0]!.costUSD).toBeGreaterThan(0)
  })

  it('uses workflowId as sessionId', async () => {
    const wsHash = 'g'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    const chatPath = join(wsDir, 'sess.chat')
    await writeFile(chatPath, makeChatFile({
      workflowId: 'my-workflow-id',
      botResponses: ['ok'],
    }))

    const source = { path: chatPath, project: 'test', provider: 'kiro' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiro.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.sessionId).toBe('my-workflow-id')
  })
})

describe('kiro provider - discoverSessions', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kiro-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('discovers chat files from workspace hash directories', async () => {
    const wsHash = 'a1b2c3d4e5f6'.padEnd(32, '0')
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    await writeFile(join(wsDir, 'session1.chat'), makeChatFile({}))
    await writeFile(join(wsDir, 'session2.chat'), makeChatFile({}))

    const provider = createKiroProvider(tmpDir, '/nonexistent/ws')
    const sessions = await provider.discoverSessions()

    expect(sessions).toHaveLength(2)
    expect(sessions.every(s => s.provider === 'kiro')).toBe(true)
    expect(sessions.every(s => s.path.endsWith('.chat'))).toBe(true)
  })

  it('reads project name from workspace.json', async () => {
    const wsHash = 'b'.repeat(32)
    const agentWsDir = join(tmpDir, wsHash)
    await mkdir(agentWsDir, { recursive: true })
    await writeFile(join(agentWsDir, 'test.chat'), makeChatFile({}))

    const workspaceStorageDir = join(tmpDir, 'ws-storage')
    const wsStorageEntry = join(workspaceStorageDir, wsHash)
    await mkdir(wsStorageEntry, { recursive: true })
    await writeFile(join(wsStorageEntry, 'workspace.json'), JSON.stringify({ folder: 'file:///home/user/myapp' }))

    const provider = createKiroProvider(tmpDir, workspaceStorageDir)
    const sessions = await provider.discoverSessions()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.project).toBe('myapp')
  })

  it('returns empty when directory does not exist', async () => {
    const provider = createKiroProvider('/nonexistent/agent', '/nonexistent/ws')
    const sessions = await provider.discoverSessions()
    expect(sessions).toHaveLength(0)
  })

  it('skips non-32-char directories', async () => {
    const shortDir = join(tmpDir, 'short')
    await mkdir(shortDir, { recursive: true })
    await writeFile(join(shortDir, 'test.chat'), makeChatFile({}))

    const provider = createKiroProvider(tmpDir, '/nonexistent/ws')
    const sessions = await provider.discoverSessions()
    expect(sessions).toHaveLength(0)
  })

  it('skips files without .chat extension', async () => {
    const wsHash = 'c'.repeat(32)
    const wsDir = join(tmpDir, wsHash)
    await mkdir(wsDir, { recursive: true })
    await writeFile(join(wsDir, 'index.json'), '{}')
    await writeFile(join(wsDir, 'notes.txt'), 'hello')

    const provider = createKiroProvider(tmpDir, '/nonexistent/ws')
    const sessions = await provider.discoverSessions()
    expect(sessions).toHaveLength(0)
  })
})

describe('kiro provider - metadata', () => {
  it('has correct name and displayName', () => {
    expect(kiro.name).toBe('kiro')
    expect(kiro.displayName).toBe('Kiro')
  })

  it('normalizes model display names', () => {
    expect(kiro.modelDisplayName('claude-haiku-4-5')).toBe('Haiku 4.5')
    expect(kiro.modelDisplayName('claude-sonnet-4-5')).toBe('Sonnet 4.5')
    expect(kiro.modelDisplayName('claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(kiro.modelDisplayName('unknown-model')).toBe('unknown-model')
  })

  it('normalizes tool display names', () => {
    expect(kiro.toolDisplayName('readFile')).toBe('Read')
    expect(kiro.toolDisplayName('writeFile')).toBe('Edit')
    expect(kiro.toolDisplayName('runCommand')).toBe('Bash')
    expect(kiro.toolDisplayName('searchFiles')).toBe('Grep')
    expect(kiro.toolDisplayName('unknown_tool')).toBe('unknown_tool')
  })

  it('longest-prefix match for versioned model IDs', () => {
    expect(kiro.modelDisplayName('claude-sonnet-4-5-20260101')).toBe('Sonnet 4.5')
    expect(kiro.modelDisplayName('claude-haiku-4-5-20260101')).toBe('Haiku 4.5')
  })
})
