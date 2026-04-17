import { describe, it, expect } from 'vitest'

import { renderMenubarFormat, type PeriodData } from '../../src/menubar.js'

const ESC = '\u001b'

function period(name: string): PeriodData {
  return {
    label: 'x',
    cost: 0.01,
    calls: 1,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    categories: [{ name, cost: 0.01, turns: 1, editTurns: 0, oneShotTurns: 1 }],
    models: [{ name, cost: 0.01, calls: 1 }],
  }
}

function linesWithToken(output: string, token: string): string[] {
  return output.split('\n').filter(l => l.includes(token))
}

describe('MEDIUM-2 menubar directive separator injection', () => {
  it('strips pipe separators from model names', () => {
    const p = period('foo | href=https://attacker.example/pwn')
    const out = renderMenubarFormat(p, p, p, p)
    for (const line of linesWithToken(out, 'foo')) {
      expect(line.split('|').length).toBeLessThanOrEqual(2)
    }
  })

  it('strips ANSI escapes from model names', () => {
    const p = period(`foo${ESC}[31mMODEL${ESC}[0m`)
    const out = renderMenubarFormat(p, p, p, p)
    expect(out).not.toContain(ESC)
  })

  it('strips pipe separators from category names', () => {
    const p = period('cat | color=red')
    const out = renderMenubarFormat(p, p, p, p)
    for (const line of linesWithToken(out, 'cat')) {
      expect(line.split('|').length).toBeLessThanOrEqual(2)
    }
  })
})
