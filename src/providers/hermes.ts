import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { homedir } from 'os'

import { readSessionFile } from '../fs-utils.js'
import { calculateCost } from '../models.js'
import { extractBashCommands } from '../bash-utils.js'
import type { Provider, SessionSource, SessionParser, ParsedProviderCall } from './types.js'

// ── Model display names ────────────────────────────────────────────────

const modelDisplayNames: Record<string, string> = {
  // OpenCode / Hermes proxy models
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4': 'DeepSeek V4',
  'kimi-k2.6': 'Kimi K2.6',
  'kimi-k2': 'Kimi K2',
  'moonshotai/kimi-k2.6': 'Kimi K2.6',
  'minimax/m minimax-m2.5': 'Minimax M2.5',
  'minimax/minimax-m2.7': 'Minimax M2.7',
  // Ollama / local models
  'qwen3.5-plus-0': 'Qwen 3.5 Plus',
  'qwen3:8b': 'Qwen 3 8B',
  'qwen2.5:3b': 'Qwen 2.5 3B',
  'glm-5.1': 'GLM 5.1',
  'llama3-70b-8192': 'Llama 3 70B',
  // Cloud models
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.0-flash-lite-001': 'Gemini 2.0 Flash Lite',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'gpt-5': 'GPT-5',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  // Groq
  'llama-3.3-70b-versatile': 'Llama 3.3 70B',
  // NVIDIA
  'llama-3.1-nemotron-70b-instruct': 'Nemotron 70B',
  'nvidia/llama-3.1-nemotron-70b-instruct': 'Nemotron 70B',
  // Nous / OpenRouter
  'nous/moonshotai/kimi-k2.6': 'Kimi K2.6',
  'nous/minimax/minimax-m2.7': 'Minimax M2.7',
}

// Sorted by key length descending so longer/more-specific keys match first
const modelDisplayEntries = Object.entries(modelDisplayNames).sort(
  (a, b) => b[0].length - a[0].length
)

// ── Tool name normalization ─────────────────────────────────────────────

const toolNameMap: Record<string, string> = {
  // Terminal / shell
  terminal: 'Bash',
  bash: 'Bash',
  process: 'Bash',
  // File reads
  read_file: 'Read',
  read: 'Read',
  // File search
  search_files: 'Grep',
  grep: 'Grep',
  find: 'Grep',
  // File writes / edits
  write_file: 'Write',
  write: 'Write',
  patch: 'Edit',
  edit: 'Edit',
  // Browser
  browser_navigate: 'WebFetch',
  browser_snapshot: 'WebFetch',
  browser_click: 'WebFetch',
  browser_type: 'WebFetch',
  browser_press: 'WebFetch',
  browser_scroll: 'WebFetch',
  browser_back: 'WebFetch',
  browser_console: 'WebFetch',
  browser_get_images: 'WebFetch',
  browser_vision: 'Vision',
  vision_analyze: 'Vision',
  // Web fetch / search
  mcp_fetch_extract_text: 'WebFetch',
  mcp_fetch_fetch_url: 'WebFetch',
  mcp_fetch_extract_links: 'WebFetch',
  mcp_fetch_fetch_json: 'WebFetch',
  web_search: 'WebSearch',
  // GitHub MCP
  mcp_github_get_file_contents: 'Read',
  mcp_github_search_code: 'Grep',
  mcp_github_search_repositories: 'WebSearch',
  mcp_github_create_pull_request: 'Git',
  mcp_github_push_files: 'Git',
  mcp_github_create_branch: 'Git',
  mcp_github_merge_pull_request: 'Git',
  // Brain OS vault tools
  mcp_brain_vault_read_file: 'Read',
  mcp_brain_vault_search_files: 'Grep',
  mcp_brain_vault_write_file: 'Write',
  mcp_brain_vault_edit_file: 'Edit',
  mcp_brain_vault_list_directory: 'Read',
  mcp_brain_vault_directory_tree: 'Read',
  // Skills
  skill_view: 'Skill',
  skill_manage: 'Skill',
  skills_list: 'Skill',
  session_search: 'Skill',
  // Delegation / agents
  delegate_task: 'Agent',
  // Task management
  todo: 'TodoWrite',
  // Memory
  memory: 'Memory',
  // Execution
  execute_code: 'Code',
  // Scheduling
  cronjob: 'Cron',
  // Media
  text_to_speech: 'TTS',
  // User interaction
  clarify: 'Conversation',
}

// ── Session types ───────────────────────────────────────────────────────

type HermesSession = {
  session_id: string
  model: string
  base_url?: string
  platform?: string
  session_start?: string
  last_updated?: string
  message_count?: number
  messages: HermesMessage[]
}

type HermesMessage = {
  role: string
  content: string | null
  reasoning?: string
  reasoning_content?: string
  finish_reason?: string
  tool_calls?: HermesToolCall[]
  tool_call_id?: string
}

type HermesToolCall = {
  id?: string
  call_id?: string
  type?: string
  function: {
    name: string
    arguments: string
  }
}

// ── Token estimation (content-length based, like Kiro/Copilot) ──────────

// Rough average for English text. Hermes sessions don't store explicit
// token counts, so we estimate from content length. CodeBurn's Kiro and
// Copilot providers use the same approach.
const CHARS_PER_TOKEN = 3.5

function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// ── Session discovery ───────────────────────────────────────────────────

function getHermesSessionsDir(): string {
  return join(homedir(), '.hermes', 'sessions')
}

async function discoverHermesSessions(): Promise<SessionSource[]> {
  const sessionsDir = getHermesSessionsDir()
  const sources: SessionSource[] = []

  let files: string[]
  try {
    files = await readdir(sessionsDir)
  } catch {
    return sources
  }

  for (const file of files) {
    if (!file.startsWith('session_') || !file.endsWith('.json')) continue

    const filePath = join(sessionsDir, file)
    const fileStat = await stat(filePath).catch(() => null)
    if (!fileStat?.isFile()) continue

    // Quick validation: read the file and check it has a session_id
    try {
      const content = await readSessionFile(filePath)
      if (!content) continue
      const session = JSON.parse(content) as HermesSession
      if (!session.session_id) continue

      // Project name: use the session file's timestamp prefix for grouping
      // e.g. "session_20260502_141438" → "20260502"
      const dateMatch = file.match(/^session_(\d{8})/)
      const project = dateMatch ? dateMatch[1] : basename(file, '.json').replace(/^session_/, '')

      sources.push({ path: filePath, project, provider: 'hermes' })
    } catch {
      continue
    }
  }

  return sources
}

// ── Session parser ──────────────────────────────────────────────────────

function createParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      const content = await readSessionFile(source.path)
      if (!content) return

      let session: HermesSession
      try {
        session = JSON.parse(content) as HermesSession
      } catch {
        return
      }

      // Some sessions may have multiple models if the agent switched mid-session.
      // Default to session-level model; fall back to 'unknown'.
      const defaultModel = session.model || 'unknown'
      const sessionId = session.session_id || basename(source.path, '.json')
      const sessionTimestamp = session.session_start || session.last_updated || ''
      let pendingUserMessage = ''
      let msgIndex = 0

      for (const msg of session.messages || []) {
        msgIndex++

        if (msg.role === 'user') {
          pendingUserMessage = (msg.content || '').slice(0, 500)
          continue
        }

        // Skip system, tool, and other non-assistant messages (tools are captured via assistant tool_calls)
        if (msg.role !== 'assistant') continue

        const content = msg.content || ''
        // Hermes stores reasoning in both `reasoning` and `reasoning_content`.
        // `reasoning_content` is the canonical OpenAI field; `reasoning` may be a duplicate.
        // Use reasoning_content and avoid double-counting.
        const reasoning = msg.reasoning_content || msg.reasoning || ''

        // Extract tools from tool_calls array
        const toolCalls = msg.tool_calls || []
        const tools: string[] = []
        const bashCommands: string[] = []

        for (const tc of toolCalls) {
          const rawName = tc.function?.name || 'unknown'
          const displayName = toolNameMap[rawName] || rawName
          tools.push(displayName)

          // Extract bash commands from terminal tool calls
          if (rawName === 'terminal' || rawName === 'bash') {
            try {
              const args = JSON.parse(tc.function?.arguments || '{}')
              const cmd = typeof args.command === 'string' ? args.command : ''
              if (cmd) bashCommands.push(...extractBashCommands(cmd))
            } catch {
              // skip malformed arguments
            }
          }
        }

        // Estimate token counts
        const inputTokens = estimateTokens(pendingUserMessage) + estimateTokens(reasoning)
        const outputTokens = estimateTokens(content)

        // Yield even if estimated tokens are zero, as long as there are tool calls
        // (so tool usage gets counted even for very short messages)
        const hasToolCalls = tools.length > 0
        if (inputTokens === 0 && outputTokens === 0 && !hasToolCalls) continue

        // Dedup by session_id + message index.
        // Hermes sessions don't have per-message UUIDs, so we use positional index.
        // Same-message dedup works because session files are immutable once written.
        const dedupKey = `hermes:${sessionId}:${msgIndex}`

        if (seenKeys.has(dedupKey)) continue
        seenKeys.add(dedupKey)

        const costUSD = calculateCost(defaultModel, inputTokens, outputTokens, 0, 0, 0)
        const reasoningTokens = estimateTokens(reasoning)

        yield {
          provider: 'hermes',
          model: defaultModel,
          inputTokens,
          outputTokens,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens,
          webSearchRequests: 0,
          costUSD,
          tools,
          bashCommands,
          timestamp: sessionTimestamp,
          speed: 'standard',
          deduplicationKey: dedupKey,
          userMessage: pendingUserMessage,
          sessionId,
        }

        pendingUserMessage = ''
      }
    },
  }
}

// ── Provider export ─────────────────────────────────────────────────────

export const hermes: Provider = {
  name: 'hermes',
  displayName: 'Hermes Agent',

  modelDisplayName(model: string): string {
    // Check exact match first
    if (modelDisplayNames[model]) return modelDisplayNames[model]

    // Check prefix match using length-sorted entries (longest first)
    for (const [key, name] of modelDisplayEntries) {
      if (model.startsWith(key)) return name
    }

    // Strip provider prefix (e.g. "opencode-go/deepseek-v4-pro" → "deepseek-v4-pro")
    const slashIdx = model.lastIndexOf('/')
    const short = slashIdx >= 0 ? model.slice(slashIdx + 1) : model

    // Try the stripped name in display names
    if (modelDisplayNames[short]) return modelDisplayNames[short]

    return short || model
  },

  toolDisplayName(rawTool: string): string {
    return toolNameMap[rawTool] || rawTool
  },

  async discoverSessions(): Promise<SessionSource[]> {
    return discoverHermesSessions()
  },

  createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
    return createParser(source, seenKeys)
  },
}
