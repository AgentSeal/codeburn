import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { exportCsv, type PeriodExport } from '../src/export.js'
import type { ProjectSummary } from '../src/types.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'export-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function makeProject(projectPath: string): ProjectSummary {
  return {
    project: projectPath,
    projectPath,
    sessions: [
      {
        sessionId: 'sess-001',
        project: projectPath,
        firstTimestamp: '2026-04-14T10:00:00Z',
        lastTimestamp: '2026-04-14T10:01:00Z',
        totalCostUSD: 1.23,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        apiCalls: 1,
        turns: [
          {
            userMessage: '=SUM(1,2)',
            timestamp: '2026-04-14T10:00:00Z',
            sessionId: 'sess-001',
            category: 'coding',
            retries: 0,
            hasEdits: true,
            assistantCalls: [
              {
                provider: 'claude',
                model: '+danger-model',
                usage: {
                  inputTokens: 100,
                  outputTokens: 50,
                  cacheCreationInputTokens: 0,
                  cacheReadInputTokens: 0,
                  cachedInputTokens: 0,
                  reasoningTokens: 0,
                  webSearchRequests: 0,
                },
                costUSD: 1.23,
                tools: ['Read'],
                mcpTools: [],
                hasAgentSpawn: false,
                hasPlanMode: false,
                speed: 'standard',
                timestamp: '2026-04-14T10:00:00Z',
                bashCommands: ['@malicious'],
                deduplicationKey: 'dedup-1',
              },
            ],
          },
        ],
        modelBreakdown: {
          '+danger-model': {
            calls: 1,
            costUSD: 1.23,
            tokens: {
              inputTokens: 100,
              outputTokens: 50,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0,
              cachedInputTokens: 0,
              reasoningTokens: 0,
              webSearchRequests: 0,
            },
          },
        },
        toolBreakdown: {
          Read: { calls: 1 },
        },
        mcpBreakdown: {},
        bashBreakdown: {
          '@malicious': { calls: 1 },
        },
        categoryBreakdown: {
          coding: { turns: 1, costUSD: 1.23, retries: 0, editTurns: 1, oneShotTurns: 1 },
          debugging: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          feature: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          refactoring: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          testing: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          exploration: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          planning: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          delegation: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          git: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          'build/deploy': { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          conversation: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          brainstorming: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
          general: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
        },
      },
    ],
    totalCostUSD: 1.23,
    totalApiCalls: 1,
  }
}

describe('exportCsv', () => {
  it('prefixes formula-like cells to prevent CSV injection', async () => {
    const periods: PeriodExport[] = [
      {
        label: '30 Days',
        projects: [makeProject('=cmd,calc')],
      },
    ]

    const outputPath = join(tmpDir, 'report.csv')
    const folder = await exportCsv(periods, outputPath)
    // exportCsv now writes a folder of clean one-table-per-file CSVs, so the formula-prefix
    // guard is scattered across files. Concatenate them for the assertion surface.
    const [projects, models, shell] = await Promise.all([
      readFile(join(folder, 'projects.csv'), 'utf-8'),
      readFile(join(folder, 'models.csv'), 'utf-8'),
      readFile(join(folder, 'shell-commands.csv'), 'utf-8'),
    ])
    const content = projects + models + shell

    expect(content).toContain("\"'=cmd,calc\"")
    expect(content).toContain("'+danger-model")
    expect(content).toContain("'@malicious")
  })

  it('refuses to reuse a directory whose .codeburn-export marker is a symlink', async () => {
    // Stage a directory that holds a user file we don't want deleted plus a symlinked
    // marker that points at an unrelated regular file. Pre-fix, isCodeburnExportFolder
    // would stat-through the symlink, see a regular file, and proceed to wipe everything
    // in `targetFolder`. Post-fix, lstat catches the symlink and we refuse.
    const targetFolder = join(tmpDir, 'looks-like-a-codeburn-export')
    await mkdir(targetFolder)
    const userFile = join(targetFolder, 'important.txt')
    await writeFile(userFile, 'do not delete me\n', 'utf-8')
    const sentinelTarget = join(tmpDir, 'unrelated-real-file')
    await writeFile(sentinelTarget, '', 'utf-8')
    await symlink(sentinelTarget, join(targetFolder, '.codeburn-export'))

    const periods: PeriodExport[] = [{ label: '30 Days', projects: [makeProject('demo')] }]
    await expect(exportCsv(periods, targetFolder)).rejects.toThrow(/no \.codeburn-export marker/i)

    // Confirm nothing was deleted from the target directory.
    const survived = await readFile(userFile, 'utf-8')
    expect(survived).toBe('do not delete me\n')
  })
})
