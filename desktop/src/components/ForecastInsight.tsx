import type { DailyEntry } from '../lib/payload'
import type { CurrencyState } from '../lib/currency'
import { formatCurrency, formatCompactCurrency } from '../lib/currency'
import {
  formatDateKey, addDays, startOfDay,
  firstOfMonth, daysInMonth, dayOfMonth,
} from '../lib/dates'

type Props = {
  days: DailyEntry[]
  currency: CurrencyState
}

type ForecastStats = {
  mtd: number
  projection: number
  weekAvg: number
  weekTotal: number
  yesterday: number
  previousMonthTotal: number | null
}

function compute(days: DailyEntry[]): ForecastStats {
  const now = new Date()
  const fom = firstOfMonth(now)
  const fomStr = formatDateKey(fom)
  const totalDays = daysInMonth(now)
  const dom = dayOfMonth(now)

  const mtd = days.filter(d => d.date >= fomStr).reduce((s, d) => s + d.cost, 0)
  const avgPerDay = dom > 0 ? mtd / dom : 0
  const projection = avgPerDay * totalDays

  const today = startOfDay(now)
  const weekStartStr = formatDateKey(addDays(today, -6))
  const weekTotal = days.filter(d => d.date >= weekStartStr).reduce((s, d) => s + d.cost, 0)
  const weekAvg = weekTotal / 7

  const yesterdayStr = formatDateKey(addDays(today, -1))
  const yesterday = days.find(d => d.date === yesterdayStr)?.cost ?? 0

  let previousMonthTotal: number | null = null
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const prevFirstStr = formatDateKey(prevMonth)
  const prevLastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  const prevLastStr = formatDateKey(prevLastDay)
  const prevEntries = days.filter(d => d.date >= prevFirstStr && d.date <= prevLastStr)
  if (prevEntries.length > 0) {
    previousMonthTotal = prevEntries.reduce((s, d) => s + d.cost, 0)
  }

  return { mtd, projection, weekAvg, weekTotal, yesterday, previousMonthTotal }
}

export function ForecastInsight({ days, currency }: Props) {
  const s = compute(days)
  const prevDelta = s.previousMonthTotal && s.previousMonthTotal > 0
    ? ((s.projection - s.previousMonthTotal) / s.previousMonthTotal) * 100
    : null

  return (
    <div className="forecast-insight">
      <div className="forecast-header">
        <div>
          <div className="forecast-sublabel">Month-to-date</div>
          <div className="forecast-mtd">{formatCurrency(s.mtd, currency)}</div>
        </div>
        <div className="forecast-right">
          <div className="forecast-sublabel">On pace for</div>
          <div className="forecast-projection">{formatCurrency(s.projection, currency)}</div>
        </div>
      </div>

      <div className="trend-mini-stats">
        <div className="mini-stat">
          <div className="mini-stat-label">Avg/day (this wk)</div>
          <div className="mini-stat-value">{formatCompactCurrency(s.weekAvg, currency)}</div>
        </div>
        <div className="mini-stat">
          <div className="mini-stat-label">Yesterday</div>
          <div className="mini-stat-value">{formatCompactCurrency(s.yesterday, currency)}</div>
        </div>
        <div className="mini-stat">
          <div className="mini-stat-label">Last 7d</div>
          <div className="mini-stat-value">{formatCompactCurrency(s.weekTotal, currency)}</div>
        </div>
      </div>

      {prevDelta !== null && (
        <div className="trend-delta" style={{ marginTop: '10px' }}>
          <span className="trend-delta-arrow">{prevDelta >= 0 ? '↗' : '↘'}</span>
          {prevDelta >= 0 ? '+' : ''}{Math.round(prevDelta)}% vs last month
          ({formatCompactCurrency(s.previousMonthTotal!, currency)})
        </div>
      )}
    </div>
  )
}
