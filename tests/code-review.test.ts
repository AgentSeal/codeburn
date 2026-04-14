import { describe, it, expect } from 'vitest'
import { classifyTurn } from '../src/classifier.js'
import { ParsedTurn } from '../src/types.js'

describe('classifyTurn - review', () => {
  it('classifies messages with review keywords as review', () => {
    const turn: ParsedTurn = {
      userMessage: 'Please review this pull request',
      assistantCalls: [],
      timestamp: '2026-04-14T12:00:00Z',
      sessionId: 'test-1'
    }
    const classified = classifyTurn(turn)
    expect(classified.category).toBe('review')
  })
})
