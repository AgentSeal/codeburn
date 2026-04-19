import type { ProjectSummary } from './types.js'

export type ModelStats = {
  model: string
  calls: number
  cost: number
  outputTokens: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTurns: number
  editTurns: number
  oneShotTurns: number
  retries: number
  selfCorrections: number
  firstSeen: string
  lastSeen: string
}

export function aggregateModelStats(projects: ProjectSummary[]): ModelStats[] {
  const byModel = new Map<string, ModelStats>()

  const ensure = (model: string): ModelStats => {
    let s = byModel.get(model)
    if (!s) {
      s = { model, calls: 0, cost: 0, outputTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTurns: 0, editTurns: 0, oneShotTurns: 0, retries: 0, selfCorrections: 0, firstSeen: '', lastSeen: '' }
      byModel.set(model, s)
    }
    return s
  }

  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (turn.assistantCalls.length === 0) continue
        const primaryModel = turn.assistantCalls[0]!.model
        if (primaryModel === '<synthetic>') continue

        const ms = ensure(primaryModel)
        ms.totalTurns++
        if (turn.hasEdits) ms.editTurns++
        if (turn.hasEdits && turn.retries === 0) ms.oneShotTurns++
        ms.retries += turn.retries

        for (const call of turn.assistantCalls) {
          if (call.model === '<synthetic>') continue
          const cs = call.model === primaryModel ? ms : ensure(call.model)
          cs.calls++
          cs.cost += call.costUSD
          cs.outputTokens += call.usage.outputTokens
          cs.inputTokens += call.usage.inputTokens
          cs.cacheReadTokens += call.usage.cacheReadInputTokens
          cs.cacheWriteTokens += call.usage.cacheCreationInputTokens

          if (!cs.firstSeen || call.timestamp < cs.firstSeen) cs.firstSeen = call.timestamp
          if (!cs.lastSeen || call.timestamp > cs.lastSeen) cs.lastSeen = call.timestamp
        }
      }
    }
  }

  return [...byModel.values()].sort((a, b) => b.cost - a.cost)
}
