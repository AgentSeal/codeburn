import React, { useState, useCallback, useEffect } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import { CATEGORY_LABELS, type ProjectSummary, type TaskCategory } from './types.js'
import { formatCost, formatTokens } from './format.js'
import { parseAllSessions } from './parser.js'
import { loadPricing } from './models.js'

type Period = 'today' | 'week' | 'month'

const PERIODS: Period[] = ['today', 'week', 'month']
const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: '7 Days',
  month: 'This Month',
}

const MIN_WIDE = 90
const ORANGE = '#FF8C42'
const DIM = '#555555'
const GOLD = '#FFD700'

const PANEL_COLORS = {
  overview: '#FF8C42',
  daily: '#5B9EF5',
  project: '#5BF5A0',
  model: '#E05BF5',
  activity: '#F5C85B',
  tools: '#5BF5E0',
  mcp: '#F55BE0',
}

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  coding: '#5B9EF5',
  debugging: '#F55B5B',
  feature: '#5BF58C',
  refactoring: '#F5E05B',
  testing: '#E05BF5',
  exploration: '#5BF5E0',
  planning: '#7B9EF5',
  delegation: '#F5C85B',
  git: '#CCCCCC',
  'build/deploy': '#5BF5A0',
  conversation: '#888888',
  brainstorming: '#F55BE0',
  general: '#666666',
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

// Blue -> amber -> orange gradient across the bar width
function gradientColor(pct: number): string {
  if (pct <= 0.33) {
    const t = pct / 0.33
    return toHex(lerp(91, 245, t), lerp(158, 200, t), lerp(245, 91, t))
  }
  if (pct <= 0.66) {
    const t = (pct - 0.33) / 0.33
    return toHex(lerp(245, 255, t), lerp(200, 140, t), lerp(91, 66, t))
  }
  const t = (pct - 0.66) / 0.34
  return toHex(lerp(255, 245, t), lerp(140, 91, t), lerp(66, 91, t))
}

function getDateRange(period: Period): { start: Date; end: Date } {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  switch (period) {
    case 'today': return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end }
    case 'week': return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7), end }
    case 'month': return { start: new Date(now.getFullYear(), now.getMonth(), 1), end }
  }
}

type Layout = { dashWidth: number; wide: boolean; halfWidth: number; barWidth: number }

function calcLayout(): Layout {
  const termWidth = process.stdout.columns || parseInt(process.env['COLUMNS'] ?? '') || 80
  const dashWidth = termWidth
  const wide = dashWidth >= MIN_WIDE
  const halfWidth = wide ? Math.floor(dashWidth / 2) : dashWidth
  const inner = halfWidth - 4
  const barWidth = Math.max(6, Math.min(10, inner - 30))
  return { dashWidth, wide, halfWidth, barWidth }
}

function useLayout(): Layout {
  const [layout, setLayout] = useState(calcLayout)

  useEffect(() => {
    const onResize = () => setLayout(calcLayout())
    process.stdout.on('resize', onResize)
    return () => { process.stdout.off('resize', onResize) }
  }, [])

  return layout
}

function HBar({ value, max, width }: { value: number; max: number; width: number }) {
  if (max === 0) return <Text color={DIM}>{'░'.repeat(width)}</Text>
  const filled = Math.round((value / max) * width)
  const fillChars: React.ReactNode[] = []
  for (let i = 0; i < Math.min(filled, width); i++) {
    fillChars.push(<Text key={i} color={gradientColor(i / width)}>{'█'}</Text>)
  }
  return (
    <Text>
      {fillChars}
      <Text color="#333333">{'░'.repeat(Math.max(width - filled, 0))}</Text>
    </Text>
  )
}

function Panel({ title, color, children, width }: { title: string; color: string; children: React.ReactNode; width: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={width} overflowX="hidden">
      <Text bold color={color}>{title}</Text>
      {children}
    </Box>
  )
}

function fit(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s.padEnd(n)
}

function Overview({ projects, label, width }: { projects: ProjectSummary[]; label: string; width: number }) {
  const totalCost = projects.reduce((s, p) => s + p.totalCostUSD, 0)
  const totalCalls = projects.reduce((s, p) => s + p.totalApiCalls, 0)
  const totalSessions = projects.reduce((s, p) => s + p.sessions.length, 0)
  const allSessions = projects.flatMap(p => p.sessions)
  const totalInput = allSessions.reduce((s, sess) => s + sess.totalInputTokens, 0)
  const totalOutput = allSessions.reduce((s, sess) => s + sess.totalOutputTokens, 0)
  const totalCacheRead = allSessions.reduce((s, sess) => s + sess.totalCacheReadTokens, 0)
  const totalCacheWrite = allSessions.reduce((s, sess) => s + sess.totalCacheWriteTokens, 0)
  const cacheHit = totalInput + totalCacheRead > 0
    ? (totalCacheRead / (totalInput + totalCacheRead)) * 100 : 0

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PANEL_COLORS.overview} paddingX={1} width={width}>
      <Text wrap="truncate-end">
        <Text bold color={ORANGE}>CodeBurn</Text>
        <Text dimColor>  {label}</Text>
      </Text>
      <Text wrap="truncate-end">
        <Text bold color={GOLD}>{formatCost(totalCost)}</Text>
        <Text dimColor> cost   </Text>
        <Text bold>{totalCalls.toLocaleString()}</Text>
        <Text dimColor> calls   </Text>
        <Text bold>{String(totalSessions)}</Text>
        <Text dimColor> sessions   </Text>
        <Text bold>{cacheHit.toFixed(0)}%</Text>
        <Text dimColor> cache hit</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {formatTokens(totalInput)} in   {formatTokens(totalOutput)} out   {formatTokens(totalCacheRead)} cached   {formatTokens(totalCacheWrite)} written
      </Text>
    </Box>
  )
}

function DailyActivity({ projects, days = 14, pw, bw }: { projects: ProjectSummary[]; days?: number; pw: number; bw: number }) {
  const dailyCosts: Record<string, number> = {}
  const dailyCalls: Record<string, number> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (!turn.timestamp) continue
        const day = turn.timestamp.slice(0, 10)
        dailyCosts[day] = (dailyCosts[day] ?? 0) + turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0)
        dailyCalls[day] = (dailyCalls[day] ?? 0) + turn.assistantCalls.length
      }
    }
  }
  const sortedDays = Object.keys(dailyCosts).sort().slice(-days)
  const maxCost = Math.max(...sortedDays.map(d => dailyCosts[d] ?? 0))
  const rows: BreakdownRow[] = sortedDays.map(day => ({
    key: day, barValue: dailyCosts[day] ?? 0, label: day.slice(5), labelColor: DIM,
    values: [formatCost(dailyCosts[day] ?? 0), String(dailyCalls[day] ?? 0)],
  }))
  return <Breakdown title="Daily Activity" color={PANEL_COLORS.daily} pw={pw} bw={bw} barMax={maxCost} labelBefore
    cols={[{ header: 'cost', width: 8, color: GOLD }, { header: 'calls', width: 6 }]} rows={rows} />
}

function shortProject(project: string): string {
  const parts = project.replace(/^-/, '').split('-').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return parts.slice(-2).join('/')
}

type BreakdownCol = { header: string; width: number; color?: string }
type BreakdownRow = { key: string; barValue: number; label: string; labelColor?: string; values: string[] }

function Breakdown({ title, color, pw, bw, cols, rows, barMax, emptyText, labelBefore }: {
  title: string; color: string; pw: number; bw: number
  cols: BreakdownCol[]; rows: BreakdownRow[]; barMax: number; emptyText?: string; labelBefore?: boolean
}) {
  if (rows.length === 0 && emptyText) {
    return <Panel title={title} color={color} width={pw}><Text dimColor>{emptyText}</Text></Panel>
  }
  const colTotal = cols.reduce((s, c) => s + c.width, 0)
  const nw = Math.max(6, pw - bw - colTotal - 5)

  return (
    <Panel title={title} color={color} width={pw}>
      <Text dimColor wrap="truncate-end">{''.padEnd(bw + 1 + nw)}{cols.map(c => c.header.padStart(c.width)).join('')}</Text>
      {rows.map(row => (
        <Text key={row.key} wrap="truncate-end">
          {labelBefore && <Text color={row.labelColor}>{fit(row.label, nw)} </Text>}
          <HBar value={row.barValue} max={barMax} width={bw} />
          {!labelBefore && <Text color={row.labelColor}> {fit(row.label, nw)}</Text>}
          {row.values.map((v, i) => (
            <Text key={i} color={cols[i]?.color}>{v.padStart(cols[i]?.width ?? 6)}</Text>
          ))}
        </Text>
      ))}
    </Panel>
  )
}

function ProjectBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const maxCost = Math.max(...projects.map(p => p.totalCostUSD))
  const rows: BreakdownRow[] = projects.slice(0, 8).map((p, i) => ({
    key: `${p.project}-${i}`, barValue: p.totalCostUSD,
    label: shortProject(p.project), labelColor: DIM,
    values: [formatCost(p.totalCostUSD), String(p.sessions.length)],
  }))
  return <Breakdown title="By Project" color={PANEL_COLORS.project} pw={pw} bw={bw} barMax={maxCost}
    cols={[{ header: 'cost', width: 8, color: GOLD }, { header: 'sess', width: 6 }]} rows={rows} />
}

function ModelBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const modelTotals: Record<string, { calls: number; costUSD: number }> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [model, data] of Object.entries(session.modelBreakdown)) {
        if (!modelTotals[model]) modelTotals[model] = { calls: 0, costUSD: 0 }
        modelTotals[model].calls += data.calls
        modelTotals[model].costUSD += data.costUSD
      }
    }
  }
  const sorted = Object.entries(modelTotals).sort(([, a], [, b]) => b.costUSD - a.costUSD)
  const rows: BreakdownRow[] = sorted.map(([model, data], i) => ({
    key: `${model}-${i}`, barValue: data.costUSD, label: model,
    values: [formatCost(data.costUSD), String(data.calls)],
  }))
  return <Breakdown title="By Model" color={PANEL_COLORS.model} pw={pw} bw={bw} barMax={sorted[0]?.[1]?.costUSD ?? 0}
    cols={[{ header: 'cost', width: 8, color: GOLD }, { header: 'calls', width: 7 }]} rows={rows} />
}

function ActivityBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const categoryTotals: Record<string, { turns: number; costUSD: number }> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [cat, data] of Object.entries(session.categoryBreakdown)) {
        if (!categoryTotals[cat]) categoryTotals[cat] = { turns: 0, costUSD: 0 }
        categoryTotals[cat].turns += data.turns
        categoryTotals[cat].costUSD += data.costUSD
      }
    }
  }
  const sorted = Object.entries(categoryTotals).sort(([, a], [, b]) => b.costUSD - a.costUSD)
  const rows: BreakdownRow[] = sorted.map(([cat, data]) => ({
    key: cat, barValue: data.costUSD,
    label: CATEGORY_LABELS[cat as TaskCategory] ?? cat,
    labelColor: CATEGORY_COLORS[cat as TaskCategory] ?? '#666666',
    values: [formatCost(data.costUSD), String(data.turns)],
  }))
  return <Breakdown title="By Activity" color={PANEL_COLORS.activity} pw={pw} bw={bw} barMax={sorted[0]?.[1]?.costUSD ?? 0}
    cols={[{ header: 'cost', width: 8, color: GOLD }, { header: 'turns', width: 6 }]} rows={rows} />
}

function ToolBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const toolTotals: Record<string, number> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [tool, data] of Object.entries(session.toolBreakdown)) {
        toolTotals[tool] = (toolTotals[tool] ?? 0) + data.calls
      }
    }
  }
  const sorted = Object.entries(toolTotals).sort(([, a], [, b]) => b - a)
  const rows: BreakdownRow[] = sorted.slice(0, 10).map(([tool, calls]) => ({
    key: tool, barValue: calls, label: tool, values: [String(calls)],
  }))
  return <Breakdown title="Core Tools" color={PANEL_COLORS.tools} pw={pw} bw={bw} barMax={sorted[0]?.[1] ?? 0}
    cols={[{ header: 'calls', width: 7 }]} rows={rows} />
}

function McpBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const mcpTotals: Record<string, number> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [server, data] of Object.entries(session.mcpBreakdown)) {
        mcpTotals[server] = (mcpTotals[server] ?? 0) + data.calls
      }
    }
  }
  const sorted = Object.entries(mcpTotals).sort(([, a], [, b]) => b - a)
  const rows: BreakdownRow[] = sorted.slice(0, 8).map(([server, calls]) => ({
    key: server, barValue: calls, label: server, values: [String(calls)],
  }))
  return <Breakdown title="MCP Servers" color={PANEL_COLORS.mcp} pw={pw} bw={bw} barMax={sorted[0]?.[1] ?? 0}
    cols={[{ header: 'calls', width: 6 }]} rows={rows} emptyText="No MCP usage" />
}

function PeriodTabs({ active }: { active: Period }) {
  return (
    <Box gap={1} paddingX={1}>
      {PERIODS.map(p => (
        <Text key={p} bold={active === p} color={active === p ? ORANGE : DIM}>
          {active === p ? `[ ${PERIOD_LABELS[p]} ]` : `  ${PERIOD_LABELS[p]}  `}
        </Text>
      ))}
    </Box>
  )
}

function StatusBar({ width }: { width: number }) {
  return (
    <Box borderStyle="round" borderColor={DIM} width={width} justifyContent="center" paddingX={1}>
      <Text>
        <Text color={ORANGE} bold>{'<'}</Text><Text color={ORANGE}>{'>'}</Text>
        <Text dimColor> switch   </Text>
        <Text color={ORANGE} bold>q</Text>
        <Text dimColor> quit   </Text>
        <Text color={ORANGE} bold>1</Text>
        <Text dimColor> today   </Text>
        <Text color={ORANGE} bold>2</Text>
        <Text dimColor> week   </Text>
        <Text color={ORANGE} bold>3</Text>
        <Text dimColor> month</Text>
      </Text>
    </Box>
  )
}

function Row({ wide, width, children }: { wide: boolean; width: number; children: React.ReactNode }) {
  if (wide) return <Box width={width}>{children}</Box>
  return <>{children}</>
}

function DashboardContent({ projects, period }: { projects: ProjectSummary[]; period: Period }) {
  const { dashWidth, wide, halfWidth, barWidth } = useLayout()

  if (projects.length === 0) {
    return (
      <Panel title="CodeBurn" color={ORANGE} width={dashWidth}>
        <Text dimColor>No usage data found for {PERIOD_LABELS[period]}.</Text>
      </Panel>
    )
  }

  const pw = wide ? halfWidth : dashWidth

  return (
    <Box flexDirection="column" width={dashWidth}>
      <Overview projects={projects} label={PERIOD_LABELS[period]} width={dashWidth} />

      <Row wide={wide} width={dashWidth}>
        <DailyActivity projects={projects} days={period === 'month' ? 31 : 14} pw={pw} bw={barWidth} />
        <ProjectBreakdown projects={projects} pw={pw} bw={barWidth} />
      </Row>

      <Row wide={wide} width={dashWidth}>
        <ModelBreakdown projects={projects} pw={pw} bw={barWidth} />
        <ActivityBreakdown projects={projects} pw={pw} bw={barWidth} />
      </Row>

      <Row wide={wide} width={dashWidth}>
        <ToolBreakdown projects={projects} pw={pw} bw={barWidth} />
        <McpBreakdown projects={projects} pw={pw} bw={barWidth} />
      </Row>
    </Box>
  )
}

function InteractiveDashboard({ initialProjects, initialPeriod }: {
  initialProjects: ProjectSummary[]
  initialPeriod: Period
}) {
  const { exit } = useApp()
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects)
  const [loading, setLoading] = useState(false)
  const { dashWidth } = useLayout()

  const switchPeriod = useCallback(async (newPeriod: Period) => {
    if (newPeriod === period) return
    setLoading(true)
    setPeriod(newPeriod)
    const range = getDateRange(newPeriod)
    const data = await parseAllSessions(range)
    setProjects(data)
    setLoading(false)
  }, [period])

  useInput((input, key) => {
    if (input === 'q') {
      exit()
      return
    }
    const idx = PERIODS.indexOf(period)
    if (key.leftArrow) {
      switchPeriod(PERIODS[(idx - 1 + PERIODS.length) % PERIODS.length])
    } else if (key.rightArrow || key.tab) {
      switchPeriod(PERIODS[(idx + 1) % PERIODS.length])
    } else if (input === '1') switchPeriod('today')
    else if (input === '2') switchPeriod('week')
    else if (input === '3') switchPeriod('month')
  })

  if (loading) {
    return (
      <Box flexDirection="column" width={dashWidth}>
        <PeriodTabs active={period} />
        <Panel title="CodeBurn" color={ORANGE} width={dashWidth}>
          <Text dimColor>Loading {PERIOD_LABELS[period]}...</Text>
        </Panel>
        <StatusBar width={dashWidth} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width={dashWidth}>
      <PeriodTabs active={period} />
      <DashboardContent projects={projects} period={period} />
      <StatusBar width={dashWidth} />
    </Box>
  )
}

function StaticDashboard({ projects, period }: { projects: ProjectSummary[]; period: Period }) {
  const { dashWidth } = useLayout()
  return (
    <Box flexDirection="column" width={dashWidth}>
      <PeriodTabs active={period} />
      <DashboardContent projects={projects} period={period} />
    </Box>
  )
}

export async function renderDashboard(period: Period = 'week'): Promise<void> {
  await loadPricing()
  const range = getDateRange(period)
  const projects = await parseAllSessions(range)

  const isTTY = process.stdin.isTTY && process.stdout.isTTY

  if (isTTY) {
    const { waitUntilExit } = render(
      <InteractiveDashboard initialProjects={projects} initialPeriod={period} />
    )
    await waitUntilExit()
  } else {
    const { unmount } = render(
      <StaticDashboard projects={projects} period={period} />,
      { patchConsole: false }
    )
    unmount()
  }
}
