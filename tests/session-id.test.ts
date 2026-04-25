import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { exportCsv, exportJson, type PeriodExport } from '../src/export.js'
import type { DateRange, ProjectSummary } from '../src/types.js'

const FIXTURE_DIR = new URL('./fixtures/auggie/', import.meta.url).pathname
const FULL_SUB_AGENT_SESSION_ID = '44444444-4444-4444-8444-444444444444#sub:root-task-0001'
const RANGE: DateRange = {
  start: new Date('2026-01-01T00:00:00.000Z'),
  end: new Date('2027-01-01T00:00:00.000Z'),
}

describe('Auggie sub-agent session IDs', () => {
  let workDir: string
  let originalAugmentHome: string | undefined
  let originalCacheDir: string | undefined

  beforeEach(async () => {
    originalAugmentHome = process.env['AUGMENT_HOME']
    originalCacheDir = process.env['CODEBURN_CACHE_DIR']
    workDir = await mkdtemp(join(tmpdir(), 'codeburn-session-id-'))
    const sessionsDir = join(workDir, 'sessions')
    await mkdir(sessionsDir, { recursive: true })
    await copyFile(join(FIXTURE_DIR, 'sub-agent.json'), join(sessionsDir, 'sub-agent.json'))
    process.env['AUGMENT_HOME'] = workDir
    process.env['CODEBURN_CACHE_DIR'] = join(workDir, 'cache')
    vi.resetModules()
  })

  afterEach(async () => {
    if (originalAugmentHome === undefined) delete process.env['AUGMENT_HOME']
    else process.env['AUGMENT_HOME'] = originalAugmentHome
    if (originalCacheDir === undefined) delete process.env['CODEBURN_CACHE_DIR']
    else process.env['CODEBURN_CACHE_DIR'] = originalCacheDir
    vi.resetModules()
    if (existsSync(workDir)) await rm(workDir, { recursive: true, force: true })
  })

  async function parseFixtureProjects(): Promise<ProjectSummary[]> {
    const { parseAllSessions } = await import('../src/parser.js')
    return parseAllSessions(RANGE)
  }

  it('preserves #sub root task suffixes in summaries and top-session-style data', async () => {
    const projects = await parseFixtureProjects()
    const sessions = projects.flatMap(project => project.sessions)
    const parsed = sessions.find(session => session.sessionId === FULL_SUB_AGENT_SESSION_ID)

    expect(parsed?.turns[0]?.sessionId).toBe(FULL_SUB_AGENT_SESSION_ID)

    const topSessions = projects
      .flatMap(project => project.sessions.map(session => ({ sessionId: session.sessionId, cost: session.totalCostUSD })))
      .sort((a, b) => b.cost - a.cost)

    expect(topSessions[0]?.sessionId).toBe(FULL_SUB_AGENT_SESSION_ID)
  })

  it('propagates Auggie project and workspace labels into summaries', async () => {
    const projects = await parseFixtureProjects()
    const project = projects.find(project => project.project === 'alpha/repo')
    const session = project?.sessions.find(session => session.sessionId === FULL_SUB_AGENT_SESSION_ID)

    expect(project?.projectPath).toBe('alpha/repo')
    expect(project?.workspaceIds).toEqual(['ws-cccccccc'])
    expect(session?.project).toBe('alpha/repo')
    expect(session?.workspaceId).toBe('ws-cccccccc')
  })

  it('preserves full sub-agent session IDs in JSON and CSV exports', async () => {
    const projects = await parseFixtureProjects()
    const periods: PeriodExport[] = [{ label: '30 Days', projects }]

    const jsonPath = await exportJson(periods, join(workDir, 'report.json'))
    const json = JSON.parse(await readFile(jsonPath, 'utf-8')) as { sessions: Array<Record<string, unknown>> }
    expect(json.sessions).toContainEqual(expect.objectContaining({ 'Session ID': FULL_SUB_AGENT_SESSION_ID }))

    const csvFolder = await exportCsv(periods, join(workDir, 'export'))
    const sessionsCsv = await readFile(join(csvFolder, 'sessions.csv'), 'utf-8')
    expect(sessionsCsv).toContain(FULL_SUB_AGENT_SESSION_ID)
  })
})