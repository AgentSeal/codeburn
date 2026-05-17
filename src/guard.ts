import chalk from 'chalk'

import { formatCost } from './currency.js'
import { toDateString } from './daily-cache.js'
import type { ProjectSummary } from './types.js'

export const DEFAULT_MAX_SESSION_USD = 3
export const DEFAULT_MAX_HOURLY_USD = 10

const PANEL_WIDTH = 72
const SEP = '-'
const RED = '#ff6b6b'
const GREEN = '#7bd88f'
const GOLD = '#ffd166'
const ORANGE = '#ff9f1c'
const DIM = '#6b7280'

export type GuardThresholds = {
  maxSessionUSD: number
  maxHourlyUSD: number
}

export type GuardSessionAlert = {
  type: 'session'
  project: string
  sessionId: string
  costUSD: number
  limitUSD: number
  apiCalls: number
  firstTimestamp: string
  lastTimestamp: string
}

export type GuardHourlyAlert = {
  type: 'hour'
  hour: string
  costUSD: number
  limitUSD: number
  apiCalls: number
  projects: string[]
  sessions: string[]
}

export type GuardAlert = GuardSessionAlert | GuardHourlyAlert

export type GuardSummary = {
  projects: number
  sessions: number
  apiCalls: number
  totalCostUSD: number
}

export type GuardResult = {
  label: string
  thresholds: GuardThresholds
  summary: GuardSummary
  alerts: GuardAlert[]
}

export type AnalyzeGuardOptions = {
  label: string
  maxSessionUSD: number
  maxHourlyUSD: number
}

type HourBucket = {
  costUSD: number
  apiCalls: number
  projects: Set<string>
  sessions: Set<string>
}

function parseTimestamp(timestamp: string | undefined): Date | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

function localHourLabel(timestamp: string | undefined): string | null {
  const date = parseTimestamp(timestamp)
  if (!date) return null
  return `${toDateString(date)} ${String(date.getHours()).padStart(2, '0')}:00`
}

function isPositiveCost(costUSD: number): boolean {
  return Number.isFinite(costUSD) && costUSD > 0
}

function severity(alert: GuardAlert): number {
  return alert.limitUSD > 0 ? alert.costUSD / alert.limitUSD : alert.costUSD
}

export function analyzeGuard(projects: ProjectSummary[], options: AnalyzeGuardOptions): GuardResult {
  const thresholds: GuardThresholds = {
    maxSessionUSD: options.maxSessionUSD,
    maxHourlyUSD: options.maxHourlyUSD,
  }

  const alerts: GuardAlert[] = []
  const hourly = new Map<string, HourBucket>()
  let sessions = 0
  let apiCalls = 0
  let totalCostUSD = 0

  for (const project of projects) {
    totalCostUSD += project.totalCostUSD
    apiCalls += project.totalApiCalls
    sessions += project.sessions.length

    for (const session of project.sessions) {
      if (session.totalCostUSD >= thresholds.maxSessionUSD) {
        alerts.push({
          type: 'session',
          project: project.project,
          sessionId: session.sessionId,
          costUSD: session.totalCostUSD,
          limitUSD: thresholds.maxSessionUSD,
          apiCalls: session.apiCalls,
          firstTimestamp: session.firstTimestamp,
          lastTimestamp: session.lastTimestamp,
        })
      }

      for (const turn of session.turns) {
        for (const call of turn.assistantCalls) {
          if (!isPositiveCost(call.costUSD)) continue
          const hour = localHourLabel(call.timestamp) ?? localHourLabel(turn.timestamp)
          if (!hour) continue

          const bucket = hourly.get(hour) ?? {
            costUSD: 0,
            apiCalls: 0,
            projects: new Set<string>(),
            sessions: new Set<string>(),
          }
          bucket.costUSD += call.costUSD
          bucket.apiCalls += 1
          bucket.projects.add(project.project)
          bucket.sessions.add(session.sessionId)
          hourly.set(hour, bucket)
        }
      }
    }
  }

  for (const [hour, bucket] of hourly) {
    if (bucket.costUSD < thresholds.maxHourlyUSD) continue
    alerts.push({
      type: 'hour',
      hour,
      costUSD: bucket.costUSD,
      limitUSD: thresholds.maxHourlyUSD,
      apiCalls: bucket.apiCalls,
      projects: [...bucket.projects].sort(),
      sessions: [...bucket.sessions].sort(),
    })
  }

  alerts.sort((a, b) => {
    const bySeverity = severity(b) - severity(a)
    if (bySeverity !== 0) return bySeverity
    return b.costUSD - a.costUSD
  })

  return {
    label: options.label,
    thresholds,
    summary: {
      projects: projects.length,
      sessions,
      apiCalls,
      totalCostUSD,
    },
    alerts,
  }
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function renderAlertLine(alert: GuardAlert): string {
  if (alert.type === 'session') {
    const target = truncate(`${alert.project}/${alert.sessionId}`, 42)
    return [
      chalk.hex(RED)('Session'),
      chalk.bold(target),
      chalk.hex(GOLD)(formatCost(alert.costUSD)),
      chalk.dim(`limit ${formatCost(alert.limitUSD)}`),
      chalk.dim(`${plural(alert.apiCalls, 'call')}`),
    ].join('  ')
  }

  const projects = alert.projects.length > 0 ? alert.projects.join(', ') : 'unknown project'
  return [
    chalk.hex(RED)('Hour'),
    chalk.bold(alert.hour),
    chalk.hex(GOLD)(formatCost(alert.costUSD)),
    chalk.dim(`limit ${formatCost(alert.limitUSD)}`),
    chalk.dim(`${plural(alert.apiCalls, 'call')} across ${truncate(projects, 30)}`),
  ].join('  ')
}

export function renderGuardText(result: GuardResult): string {
  const lines: string[] = []
  lines.push('')
  lines.push(`  ${chalk.bold.hex(ORANGE)('CodeBurn guard')}${chalk.dim('  ' + result.label)}`)
  lines.push(chalk.hex(DIM)('  ' + SEP.repeat(PANEL_WIDTH)))
  lines.push('  ' + [
    plural(result.summary.projects, 'project'),
    plural(result.summary.sessions, 'session'),
    plural(result.summary.apiCalls, 'call'),
    chalk.hex(GOLD)(formatCost(result.summary.totalCostUSD)),
  ].join(chalk.hex(DIM)('   ')))
  lines.push('  ' + chalk.dim([
    `session limit ${formatCost(result.thresholds.maxSessionUSD)}`,
    `hourly limit ${formatCost(result.thresholds.maxHourlyUSD)}`,
  ].join('   ')))
  lines.push('')

  if (result.summary.sessions === 0) {
    lines.push(chalk.dim('  No usage data found for this period.'))
    lines.push('')
    return lines.join('\n')
  }

  if (result.alerts.length === 0) {
    lines.push(chalk.hex(GREEN)('  Guard OK. No spend guardrails crossed.'))
    lines.push('')
    return lines.join('\n')
  }

  lines.push(chalk.hex(RED)(`  ${plural(result.alerts.length, 'alert')} crossed configured guardrails.`))
  lines.push('')

  const visibleAlerts = result.alerts.slice(0, 10)
  for (const alert of visibleAlerts) {
    lines.push(`  ${renderAlertLine(alert)}`)
  }

  const hidden = result.alerts.length - visibleAlerts.length
  if (hidden > 0) {
    lines.push(chalk.dim(`  ...and ${plural(hidden, 'more alert')}.`))
  }

  lines.push('')
  return lines.join('\n')
}
