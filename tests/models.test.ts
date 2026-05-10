import { describe, it, expect, beforeAll, afterEach } from 'vitest'

import { getModelCosts, getShortModelName, calculateCost, loadPricing, setModelAliases } from '../src/models.js'

beforeAll(async () => {
  await loadPricing()
})

afterEach(() => setModelAliases({}))

describe('getModelCosts', () => {
  it('does not match short canonical against longer pricing key', () => {
    const costs = getModelCosts('gpt-4')
    if (costs) {
      expect(costs.inputCostPerToken).not.toBe(2.5e-6)
    }
  })

  it('returns correct pricing for gpt-4o vs gpt-4o-mini', () => {
    const mini = getModelCosts('gpt-4o-mini')
    const full = getModelCosts('gpt-4o')
    expect(mini).not.toBeNull()
    expect(full).not.toBeNull()
    expect(mini!.inputCostPerToken).toBeLessThan(full!.inputCostPerToken)
  })

  it('returns fallback pricing for known Claude models', () => {
    const costs = getModelCosts('claude-opus-4-6-20260205')
    expect(costs).not.toBeNull()
    expect(costs!.inputCostPerToken).toBe(5e-6)
  })
})

describe('getShortModelName', () => {
  it('maps gpt-4o-mini correctly (not gpt-4o)', () => {
    expect(getShortModelName('gpt-4o-mini-2024-07-18')).toBe('GPT-4o Mini')
  })

  it('maps gpt-4o correctly', () => {
    expect(getShortModelName('gpt-4o-2024-08-06')).toBe('GPT-4o')
  })

  it('maps gpt-4.1-mini correctly (not gpt-4.1)', () => {
    expect(getShortModelName('gpt-4.1-mini-2025-04-14')).toBe('GPT-4.1 Mini')
  })

  it('maps gpt-5.4-mini correctly (not gpt-5.4)', () => {
    expect(getShortModelName('gpt-5.4-mini')).toBe('GPT-5.4 Mini')
  })

  it('maps claude-opus-4-6 with date suffix', () => {
    expect(getShortModelName('claude-opus-4-6-20260205')).toBe('Opus 4.6')
  })
})

describe('builtin aliases - getModelCosts', () => {
  it('resolves anthropic--claude-4.6-opus', () => {
    expect(getModelCosts('anthropic--claude-4.6-opus')).not.toBeNull()
  })

  it('resolves anthropic--claude-4.6-sonnet', () => {
    expect(getModelCosts('anthropic--claude-4.6-sonnet')).not.toBeNull()
  })

  it('resolves anthropic--claude-4.5-opus', () => {
    expect(getModelCosts('anthropic--claude-4.5-opus')).not.toBeNull()
  })

  it('resolves anthropic--claude-4.5-sonnet', () => {
    expect(getModelCosts('anthropic--claude-4.5-sonnet')).not.toBeNull()
  })

  it('resolves anthropic--claude-4.5-haiku', () => {
    expect(getModelCosts('anthropic--claude-4.5-haiku')).not.toBeNull()
  })

  it('resolves double-wrapped anthropic/anthropic--claude-4.6-opus', () => {
    expect(getModelCosts('anthropic/anthropic--claude-4.6-opus')).not.toBeNull()
  })

  it('resolves double-wrapped anthropic/anthropic--claude-4.6-sonnet', () => {
    expect(getModelCosts('anthropic/anthropic--claude-4.6-sonnet')).not.toBeNull()
  })

  it('resolves double-wrapped anthropic/anthropic--claude-4.5-haiku', () => {
    expect(getModelCosts('anthropic/anthropic--claude-4.5-haiku')).not.toBeNull()
  })

  it('OMP opus resolves to same pricing as canonical claude-opus-4-6', () => {
    expect(getModelCosts('anthropic--claude-4.6-opus')).toEqual(getModelCosts('claude-opus-4-6'))
  })

  it('OMP sonnet resolves to same pricing as canonical claude-sonnet-4-6', () => {
    expect(getModelCosts('anthropic--claude-4.6-sonnet')).toEqual(getModelCosts('claude-sonnet-4-6'))
  })

  it('OMP haiku resolves to same pricing as canonical claude-haiku-4-5', () => {
    expect(getModelCosts('anthropic--claude-4.5-haiku')).toEqual(getModelCosts('claude-haiku-4-5'))
  })
})

describe('builtin aliases - getShortModelName', () => {
  it('anthropic--claude-4.6-opus -> Opus 4.6', () => {
    expect(getShortModelName('anthropic--claude-4.6-opus')).toBe('Opus 4.6')
  })

  it('anthropic--claude-4.6-sonnet -> Sonnet 4.6', () => {
    expect(getShortModelName('anthropic--claude-4.6-sonnet')).toBe('Sonnet 4.6')
  })

  it('anthropic--claude-4.5-opus -> Opus 4.5', () => {
    expect(getShortModelName('anthropic--claude-4.5-opus')).toBe('Opus 4.5')
  })

  it('anthropic--claude-4.5-sonnet -> Sonnet 4.5', () => {
    expect(getShortModelName('anthropic--claude-4.5-sonnet')).toBe('Sonnet 4.5')
  })

  it('anthropic--claude-4.5-haiku -> Haiku 4.5', () => {
    expect(getShortModelName('anthropic--claude-4.5-haiku')).toBe('Haiku 4.5')
  })

  it('anthropic/anthropic--claude-4.6-opus -> Opus 4.6', () => {
    expect(getShortModelName('anthropic/anthropic--claude-4.6-opus')).toBe('Opus 4.6')
  })
})

describe('user aliases via setModelAliases', () => {
  it('user alias resolves for getModelCosts', () => {
    setModelAliases({ 'my-internal-model': 'claude-sonnet-4-6' })
    expect(getModelCosts('my-internal-model')).toEqual(getModelCosts('claude-sonnet-4-6'))
  })

  it('user alias resolves for getShortModelName', () => {
    setModelAliases({ 'my-internal-model': 'claude-opus-4-6' })
    expect(getShortModelName('my-internal-model')).toBe('Opus 4.6')
  })

  it('user alias overrides builtin', () => {
    setModelAliases({ 'anthropic--claude-4.6-opus': 'claude-sonnet-4-5' })
    expect(getModelCosts('anthropic--claude-4.6-opus')).toEqual(getModelCosts('claude-sonnet-4-5'))
  })

  it('resetting aliases restores builtins', () => {
    setModelAliases({ 'anthropic--claude-4.6-opus': 'claude-sonnet-4-5' })
    setModelAliases({})
    expect(getModelCosts('anthropic--claude-4.6-opus')).toEqual(getModelCosts('claude-opus-4-6'))
  })
})

describe('calculateCost - OMP names produce non-zero cost', () => {
  it('calculates cost for anthropic--claude-4.6-opus', () => {
    expect(calculateCost('anthropic--claude-4.6-opus', 1000, 200, 0, 0, 0)).toBeGreaterThan(0)
  })

  it('calculates cost for anthropic/anthropic--claude-4.6-sonnet', () => {
    expect(calculateCost('anthropic/anthropic--claude-4.6-sonnet', 1000, 200, 0, 0, 0)).toBeGreaterThan(0)
  })
})

describe('existing model names still resolve', () => {
  it('canonical claude-opus-4-6', () => {
    expect(getModelCosts('claude-opus-4-6')).not.toBeNull()
  })

  it('canonical claude-sonnet-4-5', () => {
    expect(getModelCosts('claude-sonnet-4-5')).not.toBeNull()
  })

  it('date-stamped claude-sonnet-4-20250514', () => {
    expect(getModelCosts('claude-sonnet-4-20250514')).not.toBeNull()
  })

  it('pinned claude-sonnet-4-6@20250929', () => {
    expect(getModelCosts('claude-sonnet-4-6@20250929')).not.toBeNull()
  })

  it('anthropic/-prefixed anthropic/claude-opus-4-6', () => {
    expect(getModelCosts('anthropic/claude-opus-4-6')).not.toBeNull()
  })
})

// Issue #159: every model name Cursor emits in its SQLite database must
// resolve to a non-zero pricing entry, otherwise the dashboard shows $0 for
// that model. Each case asserts the resolved pricing identity matches the
// pricing of the expected canonical key, so an accidental alias swap (e.g.
// `claude-4.6-opus` aliased to a haiku entry) fails the test even though
// haiku also has positive pricing.
describe('Cursor model variants resolve to pricing', () => {
  const cases: Array<[string, string]> = [
    // Sonnet family
    ['claude-4-sonnet', 'claude-sonnet-4'],
    ['claude-4-sonnet-1m', 'claude-sonnet-4'],
    ['claude-4-sonnet-thinking', 'claude-sonnet-4-5'],
    ['claude-4.5-sonnet', 'claude-sonnet-4-5'],
    ['claude-4.5-sonnet-thinking', 'claude-sonnet-4-5'],
    ['claude-4.6-sonnet', 'claude-sonnet-4-6'],
    ['claude-4.6-sonnet-high', 'claude-sonnet-4-6'],
    ['claude-4.6-sonnet-low', 'claude-sonnet-4-6'],
    ['claude-4.6-sonnet-thinking', 'claude-sonnet-4-6'],
    ['claude-4.6-sonnet-high-thinking', 'claude-sonnet-4-6'],
    // Opus family
    ['claude-4-opus', 'claude-opus-4'],
    ['claude-4.5-opus', 'claude-opus-4-5'],
    ['claude-4.5-opus-high', 'claude-opus-4-5'],
    ['claude-4.5-opus-low', 'claude-opus-4-5'],
    ['claude-4.5-opus-medium', 'claude-opus-4-5'],
    ['claude-4.5-opus-high-thinking', 'claude-opus-4-5'],
    ['claude-4.6-opus', 'claude-opus-4-6'],
    ['claude-4.6-opus-fast-mode', 'claude-opus-4-6'],
    ['claude-4.6-opus-high', 'claude-opus-4-6'],
    ['claude-4.6-opus-low', 'claude-opus-4-6'],
    ['claude-4.6-opus-medium', 'claude-opus-4-6'],
    ['claude-4.6-opus-high-thinking', 'claude-opus-4-6'],
    ['claude-4.7-opus', 'claude-opus-4-7'],
    ['claude-opus-4-7-thinking-high', 'claude-opus-4-7'],
    // Haiku family
    ['claude-4.5-haiku', 'claude-haiku-4-5'],
    ['claude-4.6-haiku', 'claude-haiku-4-5'],
    // Cursor house models
    ['composer-1', 'claude-sonnet-4-5'],
    ['composer-1.5', 'claude-sonnet-4-5'],
    ['composer-2', 'claude-sonnet-4-6'],
    ['cursor-auto', 'claude-sonnet-4-5'],
    // OpenAI variants Cursor emits
    ['gpt-5', 'gpt-5'],
    ['gpt-5-fast', 'gpt-5'],
    ['gpt-5.2', 'gpt-5.2'],
    ['gpt-5.2-low', 'gpt-5'],
    // Direct LiteLLM hits where no alias is required
    ['grok-code-fast-1', 'grok-code-fast-1'],
    ['gemini-3-pro', 'gemini-3-pro-preview'],
  ]

  for (const [input, expectedAlias] of cases) {
    it(`${input} resolves to ${expectedAlias} pricing`, () => {
      const costs = getModelCosts(input)
      expect(costs, `${input} should resolve to pricing (and not produce $0 in the dashboard)`).not.toBeNull()
      expect(costs!.inputCostPerToken).toBeGreaterThan(0)
      expect(costs!.outputCostPerToken).toBeGreaterThan(0)
      const expected = getModelCosts(expectedAlias)
      expect(expected, `expected target ${expectedAlias} should itself resolve`).not.toBeNull()
      // Identity check: the alias must produce the SAME pricing object as
      // the canonical key, not just any non-zero pricing. Catches drift
      // where a future edit re-points an alias at a wrong-but-positive entry.
      expect(costs!.inputCostPerToken).toBe(expected!.inputCostPerToken)
      expect(costs!.outputCostPerToken).toBe(expected!.outputCostPerToken)
    })
  }
})
