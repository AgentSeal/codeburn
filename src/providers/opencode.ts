import { readdir } from 'fs/promises'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import initSqlJs, { type SqlJsStatic, type Database } from 'sql.js'

import { calculateCost, getShortModelName } from '../models.js'
import { extractBashCommands } from '../bash-utils.js'
import type {
  Provider,
  SessionSource,
  SessionParser,
  ParsedProviderCall,
} from './types.js'

type MessageData = {
  role: string
  modelID?: string
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
}

const toolNameMap: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  glob: 'Glob',
  grep: 'Grep',
  task: 'Agent',
  fetch: 'WebFetch',
  search: 'WebSearch',
  code: 'CodeSearch',
  todo: 'TodoWrite',
  skill: 'Skill',
  patch: 'Patch',
  question: 'Question',
  lsp: 'LSP',
  plan: 'Plan',
  invalid: 'Invalid',
}

function sanitize(dir: string): string {
  return dir.replace(/^\//, '').replace(/\//g, '-')
}

function getDataDir(dataDir?: string): string {
  const base =
    dataDir ??
    process.env['XDG_DATA_HOME'] ??
    join(homedir(), '.local', 'share')
  return join(base, 'opencode')
}

let sqlPromise: Promise<SqlJsStatic> | null = null
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs()
  return sqlPromise
}

function openDb(SQL: SqlJsStatic, filePath: string): Database | null {
  try {
    const buffer = readFileSync(filePath)
    return new SQL.Database(buffer)
  } catch {
    return null
  }
}

function queryAll<T>(db: Database, sql: string, params?: (string | number | null)[]): T[] {
  const results = db.exec(sql, params)
  if (results.length === 0) return []
  const { columns, values } = results[0]
  return values.map(
    row => Object.fromEntries(columns.map((col, i) => [col, row[i]])) as T
  )
}

async function findDbFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries
      .filter((f) => f.startsWith('opencode') && f.endsWith('.db'))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

function createParser(
  source: SessionSource,
  seenKeys: Set<string>,
): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      // Path is encoded as `${dbPath}:${sessionId}`. Rejoin on ':'
      // handles Windows drive letters (C:\...). Session IDs are UUIDs,
      // so they never contain colons.
      const segments = source.path.split(':')
      const sessionId = segments[segments.length - 1]!
      const dbPath = segments.slice(0, -1).join(':')

      const SQL = await getSql()
      let db: Database
      const maybeDb = openDb(SQL, dbPath)
      if (!maybeDb) return
      db = maybeDb

      try {
        const messages = queryAll<{
          id: string
          time_created: number
          data: string
        }>(
          db,
          'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC',
          [sessionId],
        )

        const parts = queryAll<{ message_id: string; data: string }>(
          db,
          'SELECT message_id, data FROM part WHERE session_id = ? ORDER BY message_id, id',
          [sessionId],
        )

        const partsByMsg = new Map<
          string,
          Array<{ type: string; text?: string; tool?: string; state?: { input?: { command?: string } } }>
        >()
        for (const part of parts) {
          try {
            const parsed = JSON.parse(part.data)
            if (!partsByMsg.has(part.message_id)) {
              partsByMsg.set(part.message_id, [])
            }
            partsByMsg.get(part.message_id)!.push(parsed)
          } catch {
            // Corrupt part data is non-fatal; skip and continue with remaining parts
          }
        }

        let currentUserMessage = ''

        for (const msg of messages) {
          let data: MessageData
          try {
            data = JSON.parse(msg.data)
          } catch {
            // Corrupt message data is non-fatal; skip to next message
            continue
          }

          if (data.role === 'user') {
            const textParts = (partsByMsg.get(msg.id) ?? [])
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .filter(Boolean)
            if (textParts.length > 0) {
              currentUserMessage = textParts.join(' ')
            }
            continue
          }

          if (data.role === 'assistant') {
            const tokens = {
              input: data.tokens?.input ?? 0,
              output: data.tokens?.output ?? 0,
              reasoning: data.tokens?.reasoning ?? 0,
              cacheRead: data.tokens?.cache?.read ?? 0,
              cacheWrite: data.tokens?.cache?.write ?? 0,
            }

            const allZero =
              tokens.input === 0 &&
              tokens.output === 0 &&
              tokens.reasoning === 0 &&
              tokens.cacheRead === 0 &&
              tokens.cacheWrite === 0
            if (allZero && (data.cost ?? 0) === 0) {
              continue
            }

            const msgParts = partsByMsg.get(msg.id) ?? []
            const toolParts = msgParts.filter((p) => p.type === 'tool')
            const tools = toolParts
              .map((p) => toolNameMap[p.tool ?? ''] ?? p.tool ?? '')
              .filter(Boolean)

            const bashCommands = toolParts
              .filter((p) => p.tool === 'bash' && typeof p.state?.input?.command === 'string')
              .flatMap((p) => extractBashCommands(p.state!.input!.command!))

            const dedupKey = `opencode:${sessionId}:${msg.id}`
            if (seenKeys.has(dedupKey)) {
              continue
            }
            seenKeys.add(dedupKey)

            const model = data.modelID ?? 'unknown'
            let costUSD = calculateCost(
              model,
              tokens.input,
              tokens.output + tokens.reasoning,
              tokens.cacheWrite,
              tokens.cacheRead,
              0,
            )

            if (
              costUSD === 0 &&
              typeof data.cost === 'number' &&
              data.cost > 0
            ) {
              costUSD = data.cost
            }

            const ms =
              msg.time_created < 1e12
                ? msg.time_created * 1000
                : msg.time_created
            const timestamp = new Date(ms).toISOString()

            yield {
              provider: 'opencode',
              model,
              inputTokens: tokens.input,
              outputTokens: tokens.output,
              cacheCreationInputTokens: tokens.cacheWrite,
              cacheReadInputTokens: tokens.cacheRead,
              cachedInputTokens: tokens.cacheRead,
              reasoningTokens: tokens.reasoning,
              webSearchRequests: 0,
              costUSD,
              tools,
              bashCommands,
              timestamp,
              speed: 'standard',
              deduplicationKey: dedupKey,
              userMessage: currentUserMessage,
              sessionId,
            }
          }
        }
      } finally {
        db.close()
      }
    },
  }
}

async function discoverFromDb(dbPath: string): Promise<SessionSource[]> {
  const SQL = await getSql()
  const db = openDb(SQL, dbPath)
  if (!db) return []

  try {
    const rows = queryAll<{
      id: string
      directory: string
      title: string
      time_created: number
    }>(
      db,
      'SELECT id, directory, title, time_created FROM session WHERE time_archived IS NULL AND parent_id IS NULL ORDER BY time_created DESC',
    )

    return rows.map((row) => ({
      path: `${dbPath}:${row.id}`,
      project: row.directory ? sanitize(row.directory) : row.title,
      provider: 'opencode',
    }))
  } catch {
    return []
  } finally {
    db.close()
  }
}

// dataDir is the XDG data home root (e.g. ~/.local/share), not the
// opencode directory itself. The opencode/ subdirectory is appended
// internally by getDataDir.
export function createOpenCodeProvider(dataDir?: string): Provider {
  const dir = getDataDir(dataDir)

  return {
    name: 'opencode',
    displayName: 'OpenCode',

    modelDisplayName(model: string): string {
      // Strip provider prefix (e.g. "anthropic/" or "google/") before
      // delegating to the shared short-name lookup
      const stripped = model.replace(/^[^/]+\//, '')
      return getShortModelName(stripped)
    },

    toolDisplayName(rawTool: string): string {
      return toolNameMap[rawTool] ?? rawTool
    },

    async discoverSessions(): Promise<SessionSource[]> {
      const dbPaths = await findDbFiles(dir)
      if (dbPaths.length === 0) return []

      const sessions: SessionSource[] = []
      for (const dbPath of dbPaths) {
        sessions.push(...await discoverFromDb(dbPath))
      }
      return sessions
    },

    createSessionParser(
      source: SessionSource,
      seenKeys: Set<string>,
    ): SessionParser {
      return createParser(source, seenKeys)
    },
  }
}

export const opencode = createOpenCodeProvider()
