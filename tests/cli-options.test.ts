import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const fixtureDir = fileURLToPath(new URL('./fixtures/auggie/', import.meta.url))

function runCli(args: string[], setup?: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), 'codeburn-cli-test-'))
  try {
    setup?.(home)
    const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        AUGMENT_HOME: join(home, '.augment'),
        CODEBURN_CACHE_DIR: join(home, '.cache', 'codeburn'),
      },
      timeout: 10_000,
    })
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe('CLI option validation', () => {
  it.each([
    { args: ['report', '--period', 'banana', '--format', 'json'], option: '--period', value: 'banana' },
    { args: ['optimize', '--period', 'yesterday'], option: '--period', value: 'yesterday' },
    { args: ['report', '--format', 'xml'], option: '--format', value: 'xml' },
    { args: ['status', '--format', 'tui'], option: '--format', value: 'tui' },
    { args: ['export', '--format', 'xml'], option: '--format', value: 'xml' },
    { args: ['today', '--refresh', '1abc'], option: '--refresh', value: '1abc' },
    { args: ['month', '--refresh', '0'], option: '--refresh', value: '0' },
  ])('rejects invalid $option value "$value"', ({ args, option, value }) => {
    const result = runCli(args)

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(option)
    expect(result.stderr).toContain(value)
  })
})

describe('CLI help wording', () => {
  it('describes Auggie tokens and credits in root help', () => {
    const result = runCli(['--help'])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('See where your Auggie tokens (and credits) go')
  })

  it('shows accepted choices and defaults for report options', () => {
    const result = runCli(['report', '--help'])
    const help = result.stdout.replace(/\s+/g, ' ')

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(help).toContain('choices: "today", "week", "30days", "month", "all"')
    expect(help).toContain('choices: "tui", "json"')
    expect(help).toContain('default: "week"')
    expect(help).toContain('default: "tui"')
  })
})

describe('CLI project attribution smoke', () => {
  it('filters JSON reports by Auggie workspace ID and reports project labels', () => {
    const result = runCli(['report', '--period', 'all', '--format', 'json', '--project', 'ws-aaaaaaaa'], home => {
      const sessionsDir = join(home, '.augment', 'sessions')
      mkdirSync(sessionsDir, { recursive: true })
      copyFileSync(join(fixtureDir, 'single-call.json'), join(sessionsDir, 'single-call.json'))
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as { projects: Array<Record<string, unknown>>; topSessions: Array<Record<string, unknown>> }
    expect(report.projects).toContainEqual(expect.objectContaining({ name: 'demo-project/repo', path: 'demo-project/repo', workspaceIds: ['ws-aaaaaaaa'] }))
    expect(report.topSessions[0]).toEqual(expect.objectContaining({ project: 'demo-project/repo', workspaceId: 'ws-aaaaaaaa' }))
  })
})