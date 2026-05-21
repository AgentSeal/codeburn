import { stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

import { extractBashCommands } from '../bash-utils.js'
import { calculateCost, getShortModelName } from '../models.js'
import { blobToText, getSqliteLoadError, isSqliteAvailable, isSqliteBusyError, openDatabase, type SqliteDatabase } from '../sqlite.js'
import type { ParsedProviderCall, Provider, SessionParser, SessionSource } from './types.js'

const HERMES_SESSION_SEPARATOR = '#hermes-session='
const STRUCTURED_CONTENT_PREFIX = '\0json:'

type SessionRow = {
  id: string
  source: string
  model: Uint8Array | string | null
  parent_session_id: string | null
  started_at: number
  ended_at: number | null
  title: Uint8Array | string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  reasoning_tokens: number | null
  estimated_cost_usd: number | null
  actual_cost_usd: number | null
}

type MessageRow = {
  id: number
  session_id: string
  role: string
  content: Uint8Array | string | null
  tool_calls: Uint8Array | string | null
  tool_name: Uint8Array | string | null
  timestamp: number
  token_count: number | null
  finish_reason: Uint8Array | string | null
  reasoning: Uint8Array | string | null
  reasoning_content: Uint8Array | string | null
}

type ToolCall = {
  name: string
  args: Record<string, unknown>
}

type AssistantTurn = {
  msg: MessageRow
  model: string
  userMessage: string
  tools: string[]
  bashCommands: string[]
  webSearchRequests: number
  hasExplicitToolCalls: boolean
  outputWeight: number
  reasoningWeight: number
  turnId: string
}

const toolNameMap: Record<string, string> = {
  terminal: 'Bash',
  bash: 'Bash',
  shell: 'Bash',
  process: 'Bash',
  execute_code: 'Bash',
  read_file: 'Read',
  file_read: 'Read',
  read: 'Read',
  write_file: 'Write',
  write: 'Write',
  edit: 'Edit',
  patch: 'Edit',
  search_replace: 'Edit',
  str_replace: 'Edit',
  search_files: 'Grep',
  grep: 'Grep',
  glob: 'Glob',
  find: 'Grep',
  browser_navigate: 'WebFetch',
  browser_click: 'WebFetch',
  browser_type: 'WebFetch',
  browser_snapshot: 'WebFetch',
  browser_scroll: 'WebFetch',
  browser_press: 'WebFetch',
  browser_back: 'WebFetch',
  browser_console: 'WebFetch',
  browser_get_images: 'WebFetch',
  browser_vision: 'Vision',
  vision_analyze: 'Vision',
  web_search: 'WebSearch',
  web_extract: 'WebFetch',
  web_fetch: 'WebFetch',
  delegate_task: 'Agent',
  todo: 'TodoWrite',
  skill_view: 'Skill',
  skill_manage: 'Skill',
  skills_list: 'Skill',
  session_search: 'Skill',
  clarify: 'Conversation',
  memory: 'Memory',
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function getHermesHome(override?: string): string {
  if (override) return expandHome(override)
  const configured = process.env['HERMES_HOME']
  return configured ? expandHome(configured) : join(homedir(), '.hermes')
}

function getStateDbPath(hermesHome: string): string {
  return join(hermesHome, 'state.db')
}

function sourcePathFor(dbPath: string, sessionId: string): string {
  return `${dbPath}${HERMES_SESSION_SEPARATOR}${encodeURIComponent(sessionId)}`
}

function parseSourcePath(sourcePath: string): { dbPath: string; sessionId: string } {
  const idx = sourcePath.lastIndexOf(HERMES_SESSION_SEPARATOR)
  if (idx === -1) return { dbPath: sourcePath, sessionId: '' }
  const encoded = sourcePath.slice(idx + HERMES_SESSION_SEPARATOR.length)
  let sessionId = encoded
  try {
    sessionId = decodeURIComponent(encoded)
  } catch {
    // keep the raw suffix
  }
  return { dbPath: sourcePath.slice(0, idx), sessionId }
}

function text(value: Uint8Array | string | null | undefined): string {
  return blobToText(value).trim()
}

function safeNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function parseTimestamp(raw: number | null | undefined): string {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return ''
  const ms = raw < 1e12 ? raw * 1000 : raw
  return new Date(ms).toISOString()
}

function sanitizeProject(name: string): string {
  return name
    .replace(/^\//, '')
    .replace(/[/\\:]/g, '-')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .slice(0, 100)
}

function projectName(row: SessionRow): string {
  const title = text(row.title)
  if (title) return sanitizeProject(title)
  if (row.source === 'cli') return 'hermes-cli'
  if (row.source) return sanitizeProject(`hermes-${row.source}`)
  return sanitizeProject(row.id)
}

type SchemaCheckResult =
  | { ok: true }
  | { ok: false; missing: string[] }

function validateSchemaDetailed(db: SqliteDatabase): SchemaCheckResult {
  const missing: string[] = []
  const checks = [
    {
      name: 'sessions',
      sql: `SELECT
        id, source, CAST(model AS BLOB) AS model, parent_session_id,
        started_at, ended_at, CAST(title AS BLOB) AS title,
        input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, estimated_cost_usd,
        actual_cost_usd
       FROM sessions LIMIT 0`,
    },
    {
      name: 'messages',
      sql: `SELECT
        id, session_id, role, CAST(content AS BLOB) AS content,
        CAST(tool_calls AS BLOB) AS tool_calls,
        CAST(tool_name AS BLOB) AS tool_name,
        timestamp, token_count, CAST(finish_reason AS BLOB) AS finish_reason,
        CAST(reasoning AS BLOB) AS reasoning,
        CAST(reasoning_content AS BLOB) AS reasoning_content
       FROM messages LIMIT 0`,
    },
  ]

  for (const check of checks) {
    try {
      db.query(check.sql)
    } catch (err) {
      if (isSqliteBusyError(err)) throw err
      missing.push(check.name)
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}

const warnedHermesSchemas = new Set<string>()

function warnUnrecognizedHermesSchemaOnce(missing: string[]): void {
  const key = missing.slice().sort().join(',')
  if (warnedHermesSchemas.has(key)) return
  warnedHermesSchemas.add(key)
  process.stderr.write(
    `codeburn: Hermes state.db is missing expected tables or columns (${missing.join(', ')}). ` +
    `Run Hermes once to apply migrations, or report at https://github.com/getagentseal/codeburn/issues if this persists on a current Hermes install.\n`,
  )
}

async function isFile(path: string): Promise<boolean> {
  const s = await stat(path).catch(() => null)
  return Boolean(s?.isFile())
}

function hasSessionActivity(row: SessionRow): boolean {
  return safeNumber(row.input_tokens) +
    safeNumber(row.output_tokens) +
    safeNumber(row.cache_read_tokens) +
    safeNumber(row.cache_write_tokens) +
    safeNumber(row.reasoning_tokens) +
    safeNumber(row.estimated_cost_usd) +
    safeNumber(row.actual_cost_usd) > 0
}

function decodeContent(raw: Uint8Array | string | null): string {
  const value = blobToText(raw)
  if (!value) return ''

  if (value.startsWith(STRUCTURED_CONTENT_PREFIX)) {
    try {
      return normalizeContent(JSON.parse(value.slice(STRUCTURED_CONTENT_PREFIX.length)))
    } catch {
      return ''
    }
  }

  return value
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (!content) return ''
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const record = part as Record<string, unknown>
        if (typeof record['text'] === 'string') return record['text']
        if (typeof record['content'] === 'string') return record['content']
        return ''
      })
      .filter(Boolean)
      .join(' ')
  }
  if (typeof content === 'object') {
    const record = content as Record<string, unknown>
    if (typeof record['text'] === 'string') return record['text']
    if (typeof record['content'] === 'string') return record['content']
  }
  return ''
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function parseToolCalls(raw: Uint8Array | string | null): ToolCall[] {
  const payload = blobToText(raw)
  if (!payload) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return []
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  const calls: ToolCall[] = []

  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const fn = record['function']
    const fnRecord = fn && typeof fn === 'object' ? fn as Record<string, unknown> : null
    const name = (
      typeof fnRecord?.['name'] === 'string' ? fnRecord['name'] :
      typeof record['name'] === 'string' ? record['name'] :
      typeof record['tool_name'] === 'string' ? record['tool_name'] :
      ''
    ).trim()
    if (!name) continue
    const args = parseArgs(fnRecord?.['arguments'] ?? record['arguments'] ?? record['input'] ?? record['args'])
    calls.push({ name, args })
  }

  return calls
}

function normalizeToolName(rawTool: string): string {
  const clean = rawTool.trim()
  if (!clean) return ''
  if (clean.startsWith('mcp__')) return clean

  const mapped = toolNameMap[clean]
  if (mapped) return mapped

  if (clean.startsWith('mcp_')) {
    const rest = clean.slice(4)
    const separator = rest.indexOf('_')
    if (separator > 0 && separator < rest.length - 1) {
      return `mcp__${rest.slice(0, separator)}__${rest.slice(separator + 1)}`
    }
  }

  return clean
}

function appendTool(target: { tools: string[]; bashCommands: string[]; webSearchRequests: number }, rawName: string, args: Record<string, unknown> = {}): void {
  const tool = normalizeToolName(rawName)
  if (!tool) return

  target.tools.push(tool)
  if (tool === 'WebSearch') target.webSearchRequests += 1

  if (tool !== 'Bash') return
  const command = args['command'] ?? args['cmd'] ?? args['input']
  if (typeof command === 'string' && command.trim()) {
    target.bashCommands.push(...extractBashCommands(command))
  }
}

function estimateWeight(...parts: string[]): number {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  return Math.max(1, Math.ceil(length / 4))
}

function allocateIntegers(total: number, weights: number[]): number[] {
  const count = weights.length
  if (count === 0) return []

  const budget = Math.max(0, Math.round(total))
  if (budget === 0) return weights.map(() => 0)

  const normalized = weights.map(w => Number.isFinite(w) && w > 0 ? w : 1)
  const totalWeight = normalized.reduce((sum, weight) => sum + weight, 0)
  const raw = normalized.map(weight => (budget * weight) / totalWeight)
  const allocated = raw.map(Math.floor)
  let remainder = budget - allocated.reduce((sum, value) => sum + value, 0)

  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)

  for (const { index } of order) {
    if (remainder <= 0) break
    allocated[index] += 1
    remainder--
  }

  return allocated
}

function allocateCost(total: number, weights: number[]): number[] {
  const count = weights.length
  if (count === 0) return []
  const safeTotal = safeNumber(total)
  if (safeTotal === 0) return weights.map(() => 0)
  const normalized = weights.map(w => Number.isFinite(w) && w > 0 ? w : 1)
  const totalWeight = normalized.reduce((sum, weight) => sum + weight, 0)
  return normalized.map(weight => safeTotal * weight / totalWeight)
}

function buildTurns(session: SessionRow, messages: MessageRow[]): AssistantTurn[] {
  const turns: AssistantTurn[] = []
  const model = text(session.model) || 'unknown'
  let currentUserMessage = text(session.title).slice(0, 500)
  let pendingAssistant: AssistantTurn | null = null
  let turnOrdinal = 0

  for (const msg of messages) {
    if (msg.role === 'user') {
      const userText = decodeContent(msg.content).replace(/\s+/g, ' ').trim()
      if (userText) currentUserMessage = userText.slice(0, 500)
      pendingAssistant = null
      continue
    }

    if (msg.role === 'assistant') {
      const body = decodeContent(msg.content)
      const reasoning = text(msg.reasoning_content) || text(msg.reasoning)
      const toolCalls = parseToolCalls(msg.tool_calls)
      const tokenCount = safeNumber(msg.token_count)
      const turn: AssistantTurn = {
        msg,
        model,
        userMessage: currentUserMessage,
        tools: [],
        bashCommands: [],
        webSearchRequests: 0,
        hasExplicitToolCalls: toolCalls.length > 0,
        outputWeight: tokenCount || estimateWeight(body, blobToText(msg.tool_calls)),
        reasoningWeight: estimateWeight(reasoning),
        turnId: `${msg.session_id}:turn-${turnOrdinal++}`,
      }

      for (const call of toolCalls) {
        appendTool(turn, call.name, call.args)
      }

      turns.push(turn)
      pendingAssistant = turn
      continue
    }

    if (msg.role === 'tool' && pendingAssistant && !pendingAssistant.hasExplicitToolCalls) {
      const toolName = text(msg.tool_name)
      if (toolName) appendTool(pendingAssistant, toolName)
    }
  }

  return turns
}

function usageCost(row: SessionRow): { value: number; estimated: boolean } {
  const actual = safeNumber(row.actual_cost_usd)
  if (actual > 0) return { value: actual, estimated: false }
  const estimated = safeNumber(row.estimated_cost_usd)
  if (estimated > 0) return { value: estimated, estimated: true }
  return { value: 0, estimated: true }
}

function createSyntheticTurn(row: SessionRow): AssistantTurn {
  const timestamp = row.ended_at ?? row.started_at
  return {
    msg: {
      id: 0,
      session_id: row.id,
      role: 'assistant',
      content: null,
      tool_calls: null,
      tool_name: null,
      timestamp,
      token_count: null,
      finish_reason: null,
      reasoning: null,
      reasoning_content: null,
    },
    model: text(row.model) || 'unknown',
    userMessage: text(row.title).slice(0, 500),
    tools: [],
    bashCommands: [],
    webSearchRequests: 0,
    hasExplicitToolCalls: false,
    outputWeight: 1,
    reasoningWeight: 1,
    turnId: `${row.id}:synthetic`,
  }
}

async function discoverFromDb(dbPath: string): Promise<SessionSource[]> {
  let db: SqliteDatabase
  try {
    db = openDatabase(dbPath)
  } catch {
    return []
  }

  try {
    const schema = validateSchemaDetailed(db)
    if (!schema.ok) {
      warnUnrecognizedHermesSchemaOnce(schema.missing)
      return []
    }

    const rows = db.query<SessionRow>(
      `SELECT
        s.id, s.source, CAST(s.model AS BLOB) AS model, s.parent_session_id,
        s.started_at, s.ended_at, CAST(s.title AS BLOB) AS title,
        s.input_tokens, s.output_tokens, s.cache_read_tokens,
        s.cache_write_tokens, s.reasoning_tokens, s.estimated_cost_usd,
        s.actual_cost_usd
       FROM sessions s
       WHERE (s.parent_session_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM sessions parent WHERE parent.id = s.parent_session_id
       ))
       AND (
         COALESCE(s.input_tokens, 0) > 0 OR
         COALESCE(s.output_tokens, 0) > 0 OR
         COALESCE(s.cache_read_tokens, 0) > 0 OR
         COALESCE(s.cache_write_tokens, 0) > 0 OR
         COALESCE(s.reasoning_tokens, 0) > 0 OR
         COALESCE(s.estimated_cost_usd, 0) > 0 OR
         COALESCE(s.actual_cost_usd, 0) > 0 OR
         EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id) OR
         EXISTS (SELECT 1 FROM sessions child WHERE child.parent_session_id = s.id)
       )
       ORDER BY s.started_at DESC, s.id DESC`,
    )

    return rows.map(row => ({
      path: sourcePathFor(dbPath, row.id),
      project: projectName(row),
      provider: 'hermes',
    }))
  } catch {
    return []
  } finally {
    db.close()
  }
}

function createParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      if (!isSqliteAvailable()) {
        process.stderr.write(getSqliteLoadError() + '\n')
        return
      }

      const { dbPath, sessionId: rootSessionId } = parseSourcePath(source.path)
      if (!rootSessionId) return

      let db: SqliteDatabase
      try {
        db = openDatabase(dbPath)
      } catch (err) {
        process.stderr.write(`codeburn: cannot open Hermes state.db: ${err instanceof Error ? err.message : err}\n`)
        return
      }

      try {
        const schema = validateSchemaDetailed(db)
        if (!schema.ok) {
          warnUnrecognizedHermesSchemaOnce(schema.missing)
          return
        }

        const sessions = db.query<SessionRow>(
          `WITH RECURSIVE session_tree(id, depth, path) AS (
            SELECT id, 0, char(31) || id || char(31) FROM sessions WHERE id = ?
            UNION ALL
            SELECT child.id, parent.depth + 1, parent.path || child.id || char(31)
            FROM sessions child
            JOIN session_tree parent ON child.parent_session_id = parent.id
            WHERE parent.depth < 128
              AND instr(parent.path, char(31) || child.id || char(31)) = 0
          )
          SELECT
            id, source, CAST(model AS BLOB) AS model, parent_session_id,
            started_at, ended_at, CAST(title AS BLOB) AS title,
            input_tokens, output_tokens, cache_read_tokens,
            cache_write_tokens, reasoning_tokens, estimated_cost_usd,
            actual_cost_usd
          FROM sessions
          WHERE id IN (SELECT id FROM session_tree)
          ORDER BY (SELECT MIN(depth) FROM session_tree WHERE session_tree.id = sessions.id) ASC, started_at ASC, id ASC`,
          [rootSessionId],
        )

        const messages = db.query<MessageRow>(
          `WITH RECURSIVE session_tree(id) AS (
            SELECT id FROM sessions WHERE id = ?
            UNION
            SELECT child.id
            FROM sessions child
            JOIN session_tree parent ON child.parent_session_id = parent.id
          )
          SELECT
            id, session_id, role, CAST(content AS BLOB) AS content,
            CAST(tool_calls AS BLOB) AS tool_calls,
            CAST(tool_name AS BLOB) AS tool_name,
            timestamp, token_count, CAST(finish_reason AS BLOB) AS finish_reason,
            CAST(reasoning AS BLOB) AS reasoning,
            CAST(reasoning_content AS BLOB) AS reasoning_content
          FROM messages
          WHERE session_id IN (SELECT id FROM session_tree)
          ORDER BY timestamp ASC, id ASC`,
          [rootSessionId],
        )

        const messagesBySession = new Map<string, MessageRow[]>()
        for (const msg of messages) {
          const list = messagesBySession.get(msg.session_id) ?? []
          list.push(msg)
          messagesBySession.set(msg.session_id, list)
        }

        for (const session of sessions) {
          let turns = buildTurns(session, messagesBySession.get(session.id) ?? [])
          if (turns.length === 0 && hasSessionActivity(session)) {
            turns = [createSyntheticTurn(session)]
          }
          if (turns.length === 0) continue

          const equalWeights = turns.map(() => 1)
          const outputWeights = turns.map(turn => turn.outputWeight)
          const reasoningWeights = turns.map(turn => turn.reasoningWeight)
          const inputTokens = allocateIntegers(safeNumber(session.input_tokens), equalWeights)
          const outputTokens = allocateIntegers(safeNumber(session.output_tokens), outputWeights)
          const cacheReadTokens = allocateIntegers(safeNumber(session.cache_read_tokens), equalWeights)
          const cacheWriteTokens = allocateIntegers(safeNumber(session.cache_write_tokens), equalWeights)
          const reasoningTokens = allocateIntegers(safeNumber(session.reasoning_tokens), reasoningWeights)
          const storedCost = usageCost(session)
          const costWeights = turns.map((_, i) =>
            inputTokens[i]! + outputTokens[i]! + cacheReadTokens[i]! + cacheWriteTokens[i]! + reasoningTokens[i]!,
          )
          const storedCosts = allocateCost(storedCost.value, costWeights)

          for (let i = 0; i < turns.length; i++) {
            const turn = turns[i]!
            const deduplicationKey = `hermes:${turn.msg.session_id}:${turn.msg.id}`
            if (seenKeys.has(deduplicationKey)) continue
            seenKeys.add(deduplicationKey)

            const callInputTokens = inputTokens[i]!
            const callOutputTokens = outputTokens[i]!
            const callCacheReadTokens = cacheReadTokens[i]!
            const callCacheWriteTokens = cacheWriteTokens[i]!
            const callReasoningTokens = reasoningTokens[i]!
            const calculatedCost = calculateCost(
              turn.model,
              callInputTokens,
              callOutputTokens + callReasoningTokens,
              callCacheWriteTokens,
              callCacheReadTokens,
              turn.webSearchRequests,
            )
            const costUSD = storedCost.value > 0 ? storedCosts[i]! : calculatedCost

            const hasUsage = callInputTokens + callOutputTokens + callCacheReadTokens + callCacheWriteTokens + callReasoningTokens > 0
            if (!hasUsage && costUSD === 0 && turn.tools.length === 0) continue

            yield {
              provider: 'hermes',
              model: turn.model,
              inputTokens: callInputTokens,
              outputTokens: callOutputTokens,
              cacheCreationInputTokens: callCacheWriteTokens,
              cacheReadInputTokens: callCacheReadTokens,
              cachedInputTokens: callCacheReadTokens,
              reasoningTokens: callReasoningTokens,
              webSearchRequests: turn.webSearchRequests,
              costUSD,
              preserveCostUSD: storedCost.value > 0,
              costIsEstimated: storedCost.value > 0 ? storedCost.estimated : calculatedCost > 0,
              tools: turn.tools,
              bashCommands: turn.bashCommands,
              timestamp: parseTimestamp(turn.msg.timestamp),
              speed: 'standard',
              deduplicationKey,
              turnId: turn.turnId,
              userMessage: turn.userMessage,
              sessionId: rootSessionId,
            }
          }
        }
      } catch (err) {
        process.stderr.write(`codeburn: cannot parse Hermes state.db: ${err instanceof Error ? err.message : err}\n`)
        return
      } finally {
        db.close()
      }
    },
  }
}

export function createHermesProvider(hermesHome?: string): Provider {
  const home = getHermesHome(hermesHome)

  return {
    name: 'hermes',
    displayName: 'Hermes',

    modelDisplayName(model: string): string {
      return getShortModelName(model)
    },

    toolDisplayName(rawTool: string): string {
      return normalizeToolName(rawTool)
    },

    async discoverSessions(): Promise<SessionSource[]> {
      if (!isSqliteAvailable()) return []

      const dbPath = getStateDbPath(home)
      if (!await isFile(dbPath)) return []
      return discoverFromDb(dbPath)
    },

    createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
      return createParser(source, seenKeys)
    },
  }
}

export const hermes = createHermesProvider()
