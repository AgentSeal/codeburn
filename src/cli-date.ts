import type { DateRange } from './types.js'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const END_OF_DAY_HOURS = 23
const END_OF_DAY_MINUTES = 59
const END_OF_DAY_SECONDS = 59
const END_OF_DAY_MS = 999

export type Period = 'today' | 'week' | '30days' | 'month' | 'all'

export const PERIODS: Period[] = ['today', 'week', '30days', 'month', 'all']
export const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: '7 Days',
  '30days': '30 Days',
  month: 'This Month',
  all: 'All Recorded Sessions',
}

export function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getDateRange(period: Period): { range: DateRange; label: string } {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), END_OF_DAY_HOURS, END_OF_DAY_MINUTES, END_OF_DAY_SECONDS, END_OF_DAY_MS)

  switch (period) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return { range: { start, end }, label: PERIOD_LABELS.today }
    }
    case 'week': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
      return { range: { start, end }, label: PERIOD_LABELS.week }
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { range: { start, end }, label: PERIOD_LABELS.month }
    }
    case '30days': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
      return { range: { start, end }, label: PERIOD_LABELS['30days'] }
    }
    case 'all':
      return { range: { start: new Date(0), end }, label: PERIOD_LABELS.all }
  }
}

export function formatCustomDateRangeLabel(from: string | undefined, to: string | undefined): string {
  return `${from ?? PERIOD_LABELS.all} to ${to ?? 'Today'}`
}

function parseLocalDate(s: string): Date {
  if (!ISO_DATE_RE.test(s)) {
    throw new Error(`Invalid date format "${s}": expected YYYY-MM-DD`)
  }
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

export function parseDateRangeFlags(from: string | undefined, to: string | undefined): DateRange | null {
  if (from === undefined && to === undefined) return null

  const now = new Date()
  const start = from !== undefined ? parseLocalDate(from) : new Date(0)

  const endDate = to !== undefined ? parseLocalDate(to) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
    END_OF_DAY_HOURS,
    END_OF_DAY_MINUTES,
    END_OF_DAY_SECONDS,
    END_OF_DAY_MS,
  )

  if (start > end) {
    throw new Error(`--from must not be after --to (got ${from} > ${to})`)
  }
  return { start, end }
}
