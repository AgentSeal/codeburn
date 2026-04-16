import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { getModelCosts, getShortModelName, calculateCost, setModelAliases, loadPricing } from '../src/models.js'

// Alias tests run without loadPricing — fallback pricing only.
// setModelAliases resets between tests to avoid cross-contamination.
afterEach(() => setModelAliases({}))

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
    // Remap an OMP key to a different canonical target
    setModelAliases({ 'anthropic--claude-4.6-opus': 'claude-sonnet-4-5' })
    expect(getModelCosts('anthropic--claude-4.6-opus')).toEqual(getModelCosts('claude-sonnet-4-5'))
  })

  it('resetting aliases restores builtins', () => {
    setModelAliases({ 'anthropic--claude-4.6-opus': 'claude-sonnet-4-5' })
    setModelAliases({})
    // Back to builtin: should resolve as opus pricing, not sonnet
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

describe('getModelCosts - prefix disambiguation (requires live pricing)', () => {
  beforeAll(async () => {
    await loadPricing()
  })

  it('does not match short canonical gpt-4 against longer pricing key', () => {
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

  it('returns fallback pricing for known Claude models with date suffix', () => {
    const costs = getModelCosts('claude-opus-4-6-20260205')
    expect(costs).not.toBeNull()
    expect(costs!.inputCostPerToken).toBe(5e-6)
  })
})

describe('getShortModelName - GPT model disambiguation', () => {
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
