/**
 * Currency conversion and formatting.
 *
 * All internal cost data is USD (from Anthropic API pricing). This module
 * handles converting and formatting those values for display in the user's
 * preferred currency.
 *
 * Currency symbols and decimal rules come from Node's built-in Intl API
 * (ISO 4217), so no hardcoded tables or external dependencies are needed.
 *
 * Exchange rates are fetched from frankfurter.app (free, no API key, ECB-backed)
 * and cached for 24 hours at ~/.cache/codeburn/exchange-rate.json -- the same
 * pattern used for LiteLLM pricing in models.ts.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

import { readConfig } from './config.js'

type CurrencyState = {
  code: string
  rate: number
  symbol: string
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to='

// Default state: USD passthrough (rate=1, no conversion applied).
// Overwritten by loadCurrency() if the user has configured a currency.
let active: CurrencyState = { code: 'USD', rate: 1, symbol: '$' }

// ---------------------------------------------------------------------------
// Intl-based currency helpers
// ---------------------------------------------------------------------------
// Node's Intl API knows all 162 ISO 4217 currencies: symbols, decimal places,
// and code validation. Using it avoids hardcoded lookup tables that go stale.

/**
 * Validates a currency code against ISO 4217.
 * Used by the CLI command to reject invalid input before saving config.
 */
export function isValidCurrencyCode(code: string): boolean {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code })
    return true
  } catch {
    return false
  }
}

/**
 * Resolves the display symbol for a currency code via Intl.
 * Uses 'symbol' display (not 'narrowSymbol') so that dollar-based currencies
 * get distinguishing prefixes: AUD -> "A$", CAD -> "CA$", USD -> "$".
 */
function resolveSymbol(code: string): string {
  const parts = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: code,
    currencyDisplay: 'symbol',
  }).formatToParts(0)
  return parts.find(p => p.type === 'currency')?.value ?? code
}

/**
 * Returns the standard number of decimal places for a currency.
 * Most currencies return 2 (USD, EUR, GBP). JPY and KRW return 0.
 * Drives rounding in both formatCost() and convertCost().
 */
function getFractionDigits(code: string): number {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: code,
  }).resolvedOptions().maximumFractionDigits
}

// ---------------------------------------------------------------------------
// Exchange rate fetching and caching
// ---------------------------------------------------------------------------
// Mirrors the cache pattern in models.ts (loadPricing / loadCachedPricing):
// try cache first, fetch on miss, fall back to defaults on failure.

function getCacheDir(): string {
  return join(homedir(), '.cache', 'codeburn')
}

function getRateCachePath(): string {
  return join(getCacheDir(), 'exchange-rate.json')
}

async function fetchRate(code: string): Promise<number> {
  const response = await fetch(`${FRANKFURTER_URL}${code}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json() as { rates: Record<string, number> }
  const rate = data.rates[code]
  if (!rate) throw new Error(`No rate returned for ${code}`)
  return rate
}

async function loadCachedRate(code: string): Promise<number | null> {
  try {
    const raw = await readFile(getRateCachePath(), 'utf-8')
    const cached = JSON.parse(raw) as { timestamp: number; code: string; rate: number }
    // Invalidate if the user switched currencies or the cache expired
    if (cached.code !== code) return null
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null
    return cached.rate
  } catch {
    return null
  }
}

async function cacheRate(code: string, rate: number): Promise<void> {
  await mkdir(getCacheDir(), { recursive: true })
  await writeFile(getRateCachePath(), JSON.stringify({ timestamp: Date.now(), code, rate }))
}

async function getExchangeRate(code: string): Promise<number> {
  if (code === 'USD') return 1

  const cached = await loadCachedRate(code)
  if (cached) return cached

  try {
    const rate = await fetchRate(code)
    await cacheRate(code, rate)
    return rate
  } catch {
    // API unreachable and no cache -- fall back to no conversion.
    // The tool still works, it just shows USD values.
    return 1
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Loads currency config and fetches the exchange rate.
 * Called once at CLI startup via a Commander preAction hook in cli.ts.
 * If no currency is configured, this is a no-op and everything stays USD.
 */
export async function loadCurrency(): Promise<void> {
  const config = await readConfig()
  if (!config.currency) return

  const code = config.currency.code.toUpperCase()
  const rate = await getExchangeRate(code)
  const symbol = config.currency.symbol ?? resolveSymbol(code)

  active = { code, rate, symbol }
}

// ---------------------------------------------------------------------------
// Accessors -- used by format.ts, export.ts, cli.ts, and dashboard/menubar
// ---------------------------------------------------------------------------

/** Returns the active currency state (code, rate, and symbol). */
export function getCurrency(): CurrencyState {
  return active
}

/** Returns a dynamic column header like "Cost (AUD)" for use in CSV/JSON exports. */
export function getCostColumnHeader(): string {
  return `Cost (${active.code})`
}

/**
 * Converts a USD cost to the active currency, rounded to the correct
 * number of decimal places. Used in exports where a raw number is needed
 * rather than a formatted string.
 */
export function convertCost(costUSD: number): number {
  const digits = getFractionDigits(active.code)
  const factor = 10 ** digits
  return Math.round(costUSD * active.rate * factor) / factor
}

/**
 * Formats a USD cost for display in the active currency.
 *
 * Uses adaptive precision so small values stay readable:
 *   >= 1    -> 2 decimal places   (A$4.59)
 *   >= 0.01 -> 3 decimal places   (A$0.123)
 *   < 0.01  -> 4 decimal places   (A$0.0034)
 *
 * Zero-decimal currencies (JPY, KRW) are rounded to whole numbers.
 */
export function formatCost(costUSD: number): string {
  const { rate, symbol, code } = active
  const cost = costUSD * rate
  const digits = getFractionDigits(code)

  if (digits === 0) return `${symbol}${Math.round(cost)}`

  if (cost >= 1) return `${symbol}${cost.toFixed(2)}`
  if (cost >= 0.01) return `${symbol}${cost.toFixed(3)}`
  return `${symbol}${cost.toFixed(4)}`
}
