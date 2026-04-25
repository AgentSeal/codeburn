import { describe, expect, it } from 'vitest'

import { classifyTurn } from '../src/classifier.js'
import type { ParsedApiCall, ParsedTurn } from '../src/types.js'

function call(tools: string[], overrides: Partial<ParsedApiCall> = {}): ParsedApiCall {
  return {
    provider: 'auggie',
    model: 'gpt-5.1',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
    },
    costUSD: 0,
    credits: null,
    tools,
    mcpTools: tools.filter(t => t.endsWith('-mcp')),
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: '2026-04-15T12:00:00.000Z',
    bashCommands: [],
    deduplicationKey: tools.join(',') || 'none',
    ...overrides,
  }
}

function turn(tools: string[], overrides: Partial<ParsedApiCall> = {}): ParsedTurn {
  return {
    userMessage: 'please fix this bug and run tests',
    assistantCalls: [call(tools, overrides)],
    timestamp: '2026-04-15T12:00:00.000Z',
    sessionId: 'session-1',
  }
}

describe('classifyTurn Auggie-native tool taxonomy', () => {
  it.each([
    [['view'], 'view/read'],
    [['launch-process'], 'launch-process/terminal'],
    [['codebase-retrieval'], 'search/retrieval'],
    [['browser.exec'], 'browser'],
    [['str-replace-editor'], 'file/write/edit'],
    [['read_note_workspace-mcp'], 'agent/workspace'],
  ] as const)('classifies %j as %s', (tools, expected) => {
    expect(classifyTurn(turn([...tools])).category).toBe(expected)
  })

  it('uses tool activity instead of legacy keyword intent categories', () => {
    expect(classifyTurn(turn(['launch-process'])).category).toBe('launch-process/terminal')
  })

  it('counts edit retries using Auggie edit and terminal tools', () => {
    const classified = classifyTurn({
      ...turn([]),
      assistantCalls: [call(['str-replace-editor']), call(['launch-process']), call(['apply_patch'])],
    })

    expect(classified.category).toBe('file/write/edit')
    expect(classified.hasEdits).toBe(true)
    expect(classified.retries).toBe(1)
  })
})