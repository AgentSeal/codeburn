import type { ClassifiedTurn, ParsedTurn, TaskCategory } from './types.js'

const FILE_EDIT_TOOLS = new Set([
  'apply_patch', 'str-replace-editor', 'save-file', 'remove-files',
  'write_file', 'edit_file', 'Edit', 'Write', 'FileEditTool', 'FileWriteTool', 'NotebookEdit',
])
const VIEW_READ_TOOLS = new Set(['view', 'read_file', 'list_files', 'Read', 'FileReadTool'])
const SEARCH_RETRIEVAL_TOOLS = new Set([
  'codebase-retrieval', 'conversation-retrieval', 'web-search', 'web-fetch',
  'github-api', 'jira', 'linear', 'notion', 'glean', 'Grep', 'Glob', 'GrepTool', 'GlobTool', 'WebSearch', 'WebFetch', 'ToolSearch',
])
export const TERMINAL_TOOLS = new Set(['launch-process', 'read-process', 'write-process', 'kill-process', 'list-processes', 'Bash', 'BashTool', 'PowerShellTool'])
export const BASH_TOOLS = TERMINAL_TOOLS
const BROWSER_TOOLS = new Set(['browser', 'browser.exec', 'screenshot'])
const AGENT_WORKSPACE_TOOLS = new Set(['Agent', 'Task', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'EnterPlanMode'])

function hasEditTools(tools: string[]): boolean {
  return tools.some(t => FILE_EDIT_TOOLS.has(t))
}

function hasReadTools(tools: string[]): boolean {
  return tools.some(t => VIEW_READ_TOOLS.has(t))
}

function hasTerminalTool(tools: string[]): boolean {
  return tools.some(t => TERMINAL_TOOLS.has(t))
}

function hasAgentWorkspaceTools(tools: string[]): boolean {
  return tools.some(t => AGENT_WORKSPACE_TOOLS.has(t) || t.endsWith('_workspace-mcp'))
}

function hasSearchRetrievalTools(tools: string[]): boolean {
  return tools.some(t => SEARCH_RETRIEVAL_TOOLS.has(t) || t.includes('Context7'))
}

function hasBrowserTools(tools: string[]): boolean {
  return tools.some(t => BROWSER_TOOLS.has(t) || t.startsWith('browser.'))
}

function hasSkillTool(tools: string[]): boolean {
  return tools.some(t => t === 'Skill')
}

function getAllTools(turn: ParsedTurn): string[] {
  return turn.assistantCalls.flatMap(c => c.tools)
}

function classifyByToolPattern(turn: ParsedTurn): TaskCategory | null {
  const tools = getAllTools(turn)
  if (tools.length === 0) return null

  const hasEdits = hasEditTools(tools)
  const hasReads = hasReadTools(tools)
  const hasTerminal = hasTerminalTool(tools)
  const hasAgentWorkspace = hasAgentWorkspaceTools(tools)
    || turn.assistantCalls.some(c => c.hasPlanMode || c.hasAgentSpawn)
  const hasSearch = hasSearchRetrievalTools(tools)
  const hasBrowser = hasBrowserTools(tools)
  const hasSkill = hasSkillTool(tools)

  if (hasEdits) return 'file/write/edit'
  if (hasTerminal) return 'launch-process/terminal'
  if (hasBrowser) return 'browser'
  if (hasSearch) return 'search/retrieval'
  if (hasReads) return 'view/read'
  if (hasAgentWorkspace) return 'agent/workspace'
  if (hasSkill) return 'general'

  return null
}

function classifyConversation(): TaskCategory {
  return 'conversation'
}

function countRetries(turn: ParsedTurn): number {
  let sawEditBeforeBash = false
  let sawBashAfterEdit = false
  let retries = 0

  for (const call of turn.assistantCalls) {
    const hasEdit = call.tools.some(t => FILE_EDIT_TOOLS.has(t))
    const hasTerminal = call.tools.some(t => TERMINAL_TOOLS.has(t))

    if (hasEdit) {
      if (sawBashAfterEdit) retries++
      sawEditBeforeBash = true
      sawBashAfterEdit = false
    }
    if (hasTerminal && sawEditBeforeBash) {
      sawBashAfterEdit = true
    }
  }

  return retries
}

function turnHasEdits(turn: ParsedTurn): boolean {
  return turn.assistantCalls.some(c => c.tools.some(t => FILE_EDIT_TOOLS.has(t)))
}

export function classifyTurn(turn: ParsedTurn): ClassifiedTurn {
  const tools = getAllTools(turn)

  let category: TaskCategory

  if (tools.length === 0) {
    category = classifyConversation()
  } else {
    const toolCategory = classifyByToolPattern(turn)
    if (toolCategory) {
      category = toolCategory
    } else {
      category = classifyConversation()
    }
  }

  return { ...turn, category, retries: countRetries(turn), hasEdits: turnHasEdits(turn) }
}
