import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const fixtureDir = fileURLToPath(new URL('./fixtures/auggie/', import.meta.url))

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'codeburn-json-billing-'))
  await mkdir(join(workDir, 'sessions'), { recursive: true })
  await copyFile(join(fixtureDir, 'single-call.json'), join(workDir, 'sessions', 'single-call.json'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      AUGMENT_HOME: workDir,
      CODEBURN_CACHE_DIR: join(workDir, 'cache'),
    },
    timeout: 10_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

describe('billing-aware report/status JSON', () => {
  it('uses credits fields and nullable cost for credits mode rows', () => {
    const report = runCli(['report', '--period', 'all', '--format', 'json'], { CODEBURN_BILLING_MODE: 'credits' })

    expect(report.billing.mode).toBe('credits')
    expect(report.overview.cost).toBeNull()
    expect(report.overview.creditsAugment).toBeGreaterThan(0)
    expect(report.overview.creditsSynthesizedCalls).toBe(1)
    expect(report.overview.costEstimateUsd).toBeGreaterThan(0)
    expect(report.daily[0]).toMatchObject({ cost: null, creditsSynthesizedCalls: 1 })
    expect(report.models[0]).toMatchObject({ cost: null, creditsSynthesizedCalls: 1 })
    expect(report.topSessions[0]).toMatchObject({ cost: null, creditsSynthesizedCalls: 1 })

    const status = runCli(['status', '--format', 'json'], { CODEBURN_BILLING_MODE: 'credits' })
    expect(status.billing.mode).toBe('credits')
    expect(status.month.cost).toBeNull()
    expect(status.month.creditsSynthesizedCalls).toBe(1)
  })

  it('uses base surcharge and billed USD fields for token_plus rows', () => {
    const env = { CODEBURN_BILLING_MODE: 'token_plus', CODEBURN_SURCHARGE_RATE: '0.3' }
    const report = runCli(['report', '--period', 'all', '--format', 'json'], env)

    expect(report.billing).toMatchObject({ mode: 'token_plus', surchargeRate: 0.3 })
    expect(report.overview.baseCostUsd).toBeGreaterThan(0)
    expect(Math.abs(report.overview.surchargeUsd - report.overview.baseCostUsd * 0.3)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(report.overview.billedAmountUsd - (report.overview.baseCostUsd + report.overview.surchargeUsd))).toBeLessThanOrEqual(0.01)
    expect(report.overview.cost).toBe(report.overview.billedAmountUsd)
    expect(report.daily[0].billedAmountUsd).toBe(report.overview.billedAmountUsd)
    expect(report.models[0].billedAmountUsd).toBe(report.overview.billedAmountUsd)
    expect(report.topSessions[0].billedAmountUsd).toBe(report.overview.billedAmountUsd)

    const status = runCli(['status', '--format', 'json'], env)
    expect(status.billing.mode).toBe('token_plus')
    expect(status.month.billedAmountUsd).toBe(report.overview.billedAmountUsd)
  })
})