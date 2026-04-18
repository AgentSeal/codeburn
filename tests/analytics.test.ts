import { describe, it, expect } from 'vitest'
import {
  computeOutlierSessions,
  computeModelOneShotRates,
  dominantActivity,
  TOP_OUTLIER_COUNT,
  OUTLIER_MULTIPLIER,
} from '../src/analytics.js'
import type { ClassifiedTurn, ParsedApiCall, ProjectSummary, SessionSummary, TokenUsage } from '../src/types.js'

const EMPTY_CATS: SessionSummary['categoryBreakdown'] = {
  coding: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  debugging: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  feature: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  refactoring: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  testing: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  exploration: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  planning: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  delegation: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  git: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  'build/deploy': { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  conversation: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  brainstorming: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  general: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
}

function makeSession(id: string, cost: number, firstTs = '2026-04-10T10:00:00Z'): SessionSummary {
  return {
    sessionId: id, project: 'p', firstTimestamp: firstTs, lastTimestamp: firstTs,
    totalCostUSD: cost, totalInputTokens: 0, totalOutputTokens: 0,
    totalCacheReadTokens: 0, totalCacheWriteTokens: 0, apiCalls: 1,
    turns: [], modelBreakdown: {}, toolBreakdown: {}, mcpBreakdown: {},
    bashBreakdown: {}, categoryBreakdown: structuredClone(EMPTY_CATS),
  }
}

function makeProject(name: string, sessions: SessionSummary[]): ProjectSummary {
  const totalCostUSD = sessions.reduce((s, x) => s + x.totalCostUSD, 0)
  return { project: name, projectPath: name, sessions, totalCostUSD, totalApiCalls: sessions.length }
}

describe('dominantActivity', () => {
  it('returns label of highest-cost category', () => {
    const s = makeSession('s1', 10)
    s.categoryBreakdown.coding.costUSD = 5
    s.categoryBreakdown.debugging.costUSD = 8
    expect(dominantActivity(s)).toBe('Debugging')
  })

  it('returns General for empty categoryBreakdown costs', () => {
    const s = makeSession('s1', 0)
    expect(dominantActivity(s)).toBeTypeOf('string')
  })
})

describe('computeOutlierSessions', () => {
  it('returns at most TOP_OUTLIER_COUNT', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => makeSession(`s${i}`, i + 1))
    const rows = computeOutlierSessions([makeProject('p', sessions)])
    expect(rows.length).toBe(TOP_OUTLIER_COUNT)
  })

  it('sorts by cost descending', () => {
    const sessions = [makeSession('a', 3), makeSession('b', 10), makeSession('c', 5)]
    const rows = computeOutlierSessions([makeProject('p', sessions)])
    expect(rows.map(r => r.sessionId)).toEqual(['b', 'c', 'a'])
  })

  it('flags isOutlier when cost > OUTLIER_MULTIPLIER x project avg', () => {
    const sessions = [
      makeSession('big', 100),
      makeSession('s1', 10),
      makeSession('s2', 10),
      makeSession('s3', 10),
    ]
    const rows = computeOutlierSessions([makeProject('p', sessions)])
    const big = rows.find(r => r.sessionId === 'big')!
    expect(big.isOutlier).toBe(true)
    const s1 = rows.find(r => r.sessionId === 's1')!
    expect(s1.isOutlier).toBe(false)
    expect(OUTLIER_MULTIPLIER).toBe(2)
  })

  it('isOutlier is false for a single-session project (no variance)', () => {
    const rows = computeOutlierSessions([makeProject('p', [makeSession('only', 5)])])
    expect(rows[0].isOutlier).toBe(false)
  })

  it('returns empty array for empty projects', () => {
    expect(computeOutlierSessions([])).toEqual([])
  })

  it('includes YYYY-MM-DD date from firstTimestamp', () => {
    const s = makeSession('s', 1, '2026-04-10T15:30:00Z')
    const rows = computeOutlierSessions([makeProject('p', [s])])
    expect(rows[0].date).toBe('2026-04-10')
  })
})

function makeTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    webSearchRequests: 0,
  }
}

function makeApiCall(model: string): ParsedApiCall {
  return {
    provider: 'claude',
    model,
    usage: makeTokenUsage(),
    costUSD: 0,
    tools: [],
    mcpTools: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp: '2026-04-10T10:00:00Z',
    bashCommands: [],
    deduplicationKey: `${model}-0`,
  }
}

function makeTurn(model: string, hasEdits: boolean, retries: number): ClassifiedTurn {
  return {
    userMessage: '',
    assistantCalls: [makeApiCall(model)],
    timestamp: '2026-04-10T10:00:00Z',
    sessionId: 's1',
    category: 'coding',
    retries,
    hasEdits,
  }
}

describe('computeModelOneShotRates', () => {
  it('returns one-shot rate per model', () => {
    const s = makeSession('s1', 10)
    s.modelBreakdown = { 'Sonnet 4.5': { calls: 3, costUSD: 10, tokens: makeTokenUsage() } }
    s.turns = [
      makeTurn('claude-sonnet-4-5', true, 0),
      makeTurn('claude-sonnet-4-5', true, 1),
      makeTurn('claude-sonnet-4-5', true, 0),
    ]
    const rows = computeModelOneShotRates([makeProject('p', [s])])
    const sonnet = rows.find(r => r.model === 'Sonnet 4.5')
    expect(sonnet).toBeDefined()
    expect(sonnet!.oneShotTurns).toBe(2)
    expect(sonnet!.editTurns).toBe(3)
    expect(sonnet!.oneShotRate).toBeCloseTo(2 / 3)
  })

  it('null oneShotRate when no edit turns', () => {
    const s = makeSession('s1', 5)
    s.modelBreakdown = { 'Haiku': { calls: 1, costUSD: 5, tokens: makeTokenUsage() } }
    s.turns = []
    const rows = computeModelOneShotRates([makeProject('p', [s])])
    expect(rows[0]?.oneShotRate).toBeNull()
  })

  it('returns empty for empty projects', () => {
    expect(computeModelOneShotRates([])).toEqual([])
  })
})
