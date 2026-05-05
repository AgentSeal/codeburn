import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { parseAllSessions } from '../src/parser.js'
import type { DateRange } from '../src/types.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'claude-cwd-test-'))
  originalConfigDir = process.env['CLAUDE_CONFIG_DIR']
  process.env['CLAUDE_CONFIG_DIR'] = tmpDir
})

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env['CLAUDE_CONFIG_DIR']
  } else {
    process.env['CLAUDE_CONFIG_DIR'] = originalConfigDir
  }
  await rm(tmpDir, { recursive: true, force: true })
})

function dayRange(day: string): DateRange {
  return {
    start: new Date(`${day}T00:00:00.000Z`),
    end: new Date(`${day}T23:59:59.999Z`),
  }
}

async function writeClaudeSession(projectSlug: string, sessionId: string, cwd: string, timestamp: string): Promise<void> {
  const projectDir = join(tmpDir, 'projects', projectSlug)
  await mkdir(projectDir, { recursive: true })
  const filePath = join(projectDir, `${sessionId}.jsonl`)
  await writeFile(filePath, JSON.stringify({
    type: 'assistant',
    sessionId,
    timestamp,
    cwd,
    message: {
      id: `msg-${sessionId}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    },
  }) + '\n')

  const mtime = new Date(timestamp)
  await utimes(filePath, mtime, mtime)
}

describe('Claude cwd project paths', () => {
  it('uses the JSONL cwd as the canonical project path instead of the lossy directory slug', async () => {
    await writeClaudeSession(
      'c--AI-LAB-OPENCLAW',
      'windows-session',
      'C:\\AI_LAB\\OPENCLAW',
      '2099-05-01T12:00:00.000Z',
    )

    const projects = await parseAllSessions(dayRange('2099-05-01'), 'claude')

    expect(projects).toHaveLength(1)
    expect(projects[0]!.projectPath).toBe('C:\\AI_LAB\\OPENCLAW')
    expect(projects[0]!.projectPath).not.toBe('c//AI/LAB/OPENCLAW')
    expect(projects[0]!.totalApiCalls).toBe(1)
  })

  it('groups Windows cwd case and slash variants into one project', async () => {
    await writeClaudeSession(
      'windows-openclaw-a',
      'upper-backslash',
      'C:\\AI_LAB\\OPENCLAW',
      '2099-05-02T10:00:00.000Z',
    )
    await writeClaudeSession(
      'windows-openclaw-b',
      'lower-forward-slash',
      'c:/AI_LAB/OPENCLAW/',
      '2099-05-02T11:00:00.000Z',
    )

    const projects = await parseAllSessions(dayRange('2099-05-02'), 'claude')

    expect(projects).toHaveLength(1)
    expect(projects[0]!.sessions).toHaveLength(2)
    expect(projects[0]!.totalApiCalls).toBe(2)
    expect(projects[0]!.sessions.map(s => s.sessionId).sort()).toEqual([
      'lower-forward-slash',
      'upper-backslash',
    ])
  })
})
