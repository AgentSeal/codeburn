import { describe, expect, it } from 'vitest'

import { analyzeGuard, renderGuardText } from '../src/guard.js'
import type { ClassifiedTurn, ParsedApiCall, ProjectSummary, SessionSummary } from '../src/types.js'

function makeCall(costUSD: number, timestamp: string): ParsedApiCall {
  return {
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      webSearchRequests: 0,
    },
    costUSD,
    tools: [],
    mcpTools: [],
    skills: [],
    hasAgentSpawn: false,
    hasPlanMode: false,
    speed: 'standard',
    timestamp,
    bashCommands: [],
    deduplicationKey: `${timestamp}:${costUSD}`,
  }
}

function makeTurn(sessionId: string, timestamp: string, calls: ParsedApiCall[]): ClassifiedTurn {
  return {
    userMessage: 'test',
    assistantCalls: calls,
    timestamp,
    sessionId,
    category: 'coding',
    retries: 0,
    hasEdits: true,
  }
}

function makeSession(
  project: string,
  sessionId: string,
  totalCostUSD: number,
  timestamp: string,
  turns: ClassifiedTurn[] = [],
): SessionSummary {
  const apiCalls = turns.reduce((sum, turn) => sum + turn.assistantCalls.length, 0)
  return {
    sessionId,
    project,
    firstTimestamp: timestamp,
    lastTimestamp: timestamp,
    totalCostUSD,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    apiCalls,
    turns,
    modelBreakdown: {},
    toolBreakdown: {},
    mcpBreakdown: {},
    bashBreakdown: {},
    categoryBreakdown: {} as SessionSummary['categoryBreakdown'],
    skillBreakdown: {},
  }
}

function makeProject(project: string, sessions: SessionSummary[]): ProjectSummary {
  return {
    project,
    projectPath: `/tmp/${project}`,
    sessions,
    totalCostUSD: sessions.reduce((sum, session) => sum + session.totalCostUSD, 0),
    totalApiCalls: sessions.reduce((sum, session) => sum + session.apiCalls, 0),
  }
}

describe('analyzeGuard', () => {
  it('returns no alerts when spend stays below configured guardrails', () => {
    const result = analyzeGuard([
      makeProject('app', [
        makeSession('app', 's1', 1.25, '2026-05-05T10:00:00Z', [
          makeTurn('s1', '2026-05-05T10:00:00Z', [makeCall(1.25, '2026-05-05T10:00:00Z')]),
        ]),
      ]),
    ], {
      label: 'Today',
      maxSessionUSD: 3,
      maxHourlyUSD: 10,
    })

    expect(result.summary).toMatchObject({
      projects: 1,
      sessions: 1,
      apiCalls: 1,
      totalCostUSD: 1.25,
    })
    expect(result.alerts).toEqual([])
  })

  it('flags sessions that reach the max session threshold', () => {
    const result = analyzeGuard([
      makeProject('api', [
        makeSession('api', 'expensive-session', 3, '2026-05-05T11:00:00Z'),
      ]),
    ], {
      label: 'Today',
      maxSessionUSD: 3,
      maxHourlyUSD: 10,
    })

    expect(result.alerts).toEqual([
      expect.objectContaining({
        type: 'session',
        project: 'api',
        sessionId: 'expensive-session',
        costUSD: 3,
        limitUSD: 3,
      }),
    ])
  })

  it('aggregates hourly spend across sessions and projects', () => {
    const sessionA = makeSession('api', 's1', 4, '2026-05-05T10:05:00Z', [
      makeTurn('s1', '2026-05-05T10:05:00Z', [makeCall(4, '2026-05-05T10:05:00Z')]),
    ])
    const sessionB = makeSession('web', 's2', 6, '2026-05-05T10:05:30Z', [
      makeTurn('s2', '2026-05-05T10:05:30Z', [makeCall(6, '2026-05-05T10:05:30Z')]),
    ])

    const result = analyzeGuard([
      makeProject('api', [sessionA]),
      makeProject('web', [sessionB]),
    ], {
      label: 'Today',
      maxSessionUSD: 20,
      maxHourlyUSD: 10,
    })

    expect(result.alerts).toEqual([
      expect.objectContaining({
        type: 'hour',
        costUSD: 10,
        limitUSD: 10,
        apiCalls: 2,
        projects: ['api', 'web'],
        sessions: ['s1', 's2'],
      }),
    ])
  })

  it('ignores invalid timestamps for hourly guardrails', () => {
    const result = analyzeGuard([
      makeProject('api', [
        makeSession('api', 's1', 20, '2026-05-05T10:00:00Z', [
          makeTurn('s1', 'not-a-date', [makeCall(20, 'not-a-date')]),
        ]),
      ]),
    ], {
      label: 'Today',
      maxSessionUSD: 100,
      maxHourlyUSD: 10,
    })

    expect(result.alerts).toEqual([])
  })

  it('sorts alerts by threshold severity before raw cost', () => {
    const expensiveSession = makeSession('api', 's1', 12, '2026-05-05T09:00:00Z')
    const hourlySessionA = makeSession('web', 's2', 4, '2026-05-05T10:05:00Z', [
      makeTurn('s2', '2026-05-05T10:05:00Z', [makeCall(4, '2026-05-05T10:05:00Z')]),
    ])
    const hourlySessionB = makeSession('web', 's3', 5, '2026-05-05T10:05:30Z', [
      makeTurn('s3', '2026-05-05T10:05:30Z', [makeCall(5, '2026-05-05T10:05:30Z')]),
    ])

    const result = analyzeGuard([
      makeProject('api', [expensiveSession]),
      makeProject('web', [hourlySessionA, hourlySessionB]),
    ], {
      label: 'Today',
      maxSessionUSD: 6,
      maxHourlyUSD: 8,
    })

    expect(result.alerts).toHaveLength(2)
    expect(result.alerts[0]).toMatchObject({ type: 'session', sessionId: 's1', costUSD: 12 })
    expect(result.alerts[1]).toMatchObject({ type: 'hour', costUSD: 9 })
  })
})

describe('renderGuardText', () => {
  it('shows an empty-period message when no sessions are present', () => {
    const result = analyzeGuard([], {
      label: 'Today',
      maxSessionUSD: 3,
      maxHourlyUSD: 10,
    })

    expect(renderGuardText(result)).toContain('No usage data found for this period.')
  })

  it('renders session alerts with the target and limit', () => {
    const result = analyzeGuard([
      makeProject('api', [
        makeSession('api', 'expensive-session', 3, '2026-05-05T11:00:00Z'),
      ]),
    ], {
      label: 'Today',
      maxSessionUSD: 3,
      maxHourlyUSD: 10,
    })

    const text = renderGuardText(result)
    expect(text).toContain('Session')
    expect(text).toContain('api/expensive-session')
    expect(text).toContain('limit $3.00')
  })
})
