import { readdir, readFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import { homedir } from 'os'

import { calculateCost } from '../models.js'
import type { SessionSource, SessionParser, ParsedProviderCall } from './types.js'

type UiMessage = {
  type?: string
  say?: string
  text?: string
  ts?: number
}

export function getVSCodeGlobalStoragePath(extensionId: string): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', extensionId)
  }
  if (process.platform === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', extensionId)
  }
  return join(homedir(), '.config', 'Code', 'User', 'globalStorage', extensionId)
}

export async function discoverClineTasks(extensionId: string, providerName: string, displayName: string, overrideDir?: string): Promise<SessionSource[]> {
  const baseDir = overrideDir ?? getVSCodeGlobalStoragePath(extensionId)
  const tasksDir = join(baseDir, 'tasks')
  const sources: SessionSource[] = []

  let taskDirs: string[]
  try {
    taskDirs = await readdir(tasksDir)
  } catch {
    return sources
  }

  for (const taskId of taskDirs) {
    const taskDir = join(tasksDir, taskId)
    const dirStat = await stat(taskDir).catch(() => null)
    if (!dirStat?.isDirectory()) continue

    const uiPath = join(taskDir, 'ui_messages.json')
    const uiStat = await stat(uiPath).catch(() => null)
    if (!uiStat?.isFile()) continue

    sources.push({ path: taskDir, project: displayName, provider: providerName })
  }

  return sources
}

const MODEL_TAG_RE = /<model>([^<]+)<\/model>/

function extractModelFromHistory(taskDir: string): Promise<string> {
  return readFile(join(taskDir, 'api_conversation_history.json'), 'utf-8')
    .then(raw => {
      const msgs = JSON.parse(raw) as Array<{ role?: string; content?: Array<{ text?: string }> }>
      if (!Array.isArray(msgs)) return 'cline-auto'
      for (const msg of msgs) {
        if (msg.role !== 'user' || !Array.isArray(msg.content)) continue
        for (const block of msg.content) {
          const match = typeof block.text === 'string' && MODEL_TAG_RE.exec(block.text)
          if (match) {
            const raw = match[1]
            return raw.includes('/') ? raw.split('/').pop()! : raw
          }
        }
      }
      return 'cline-auto'
    })
    .catch(() => 'cline-auto')
}

export function createClineParser(source: SessionSource, seenKeys: Set<string>, providerName: string): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      const taskDir = source.path
      const taskId = basename(taskDir)

      let uiRaw: string
      try {
        uiRaw = await readFile(join(taskDir, 'ui_messages.json'), 'utf-8')
      } catch {
        return
      }

      let uiMessages: UiMessage[]
      try {
        uiMessages = JSON.parse(uiRaw)
      } catch {
        return
      }

      if (!Array.isArray(uiMessages)) return

      const model = await extractModelFromHistory(taskDir)

      let userMessage = ''
      for (const msg of uiMessages) {
        if (msg.type === 'say' && (msg.say === 'user_feedback' || msg.say === 'text')) {
          userMessage = (msg.text ?? '').slice(0, 500)
          break
        }
      }

      const apiReqEntries = uiMessages.filter(m => m.type === 'say' && m.say === 'api_req_started')

      for (const [index, entry] of apiReqEntries.entries()) {
        const dedupKey = `${providerName}:${taskId}:${index}`
        if (seenKeys.has(dedupKey)) continue
        seenKeys.add(dedupKey)

        let tokensIn = 0
        let tokensOut = 0
        let cacheReads = 0
        let cacheWrites = 0
        let cost: number | undefined

        if (entry.text) {
          try {
            const parsed = JSON.parse(entry.text) as {
              tokensIn?: number
              tokensOut?: number
              cacheReads?: number
              cacheWrites?: number
              cost?: number
            }
            tokensIn = parsed.tokensIn ?? 0
            tokensOut = parsed.tokensOut ?? 0
            cacheReads = parsed.cacheReads ?? 0
            cacheWrites = parsed.cacheWrites ?? 0
            cost = parsed.cost
          } catch {}
        }

        if (tokensIn === 0 && tokensOut === 0) continue

        const timestamp = entry.ts ? new Date(entry.ts).toISOString() : ''
        const costUSD = cost ?? calculateCost(model, tokensIn, tokensOut, cacheWrites, cacheReads, 0)

        yield {
          provider: providerName,
          model,
          inputTokens: tokensIn,
          outputTokens: tokensOut,
          cacheCreationInputTokens: cacheWrites,
          cacheReadInputTokens: cacheReads,
          cachedInputTokens: cacheReads,
          reasoningTokens: 0,
          webSearchRequests: 0,
          costUSD,
          tools: [],
          bashCommands: [],
          timestamp,
          speed: 'standard',
          deduplicationKey: dedupKey,
          userMessage: index === 0 ? userMessage : '',
          sessionId: taskId,
        }
      }
    },
  }
}
