export type Period = 'today' | 'week' | '30days' | 'month' | 'all'

export const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today', week: '7 Days', '30days': '30 Days', month: 'Month', all: 'All',
}

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'today',  label: 'Today'   },
  { id: 'week',   label: '7 Days'  },
  { id: '30days', label: '30 Days' },
  { id: 'month',  label: 'Month'   },
  { id: 'all',    label: 'All'     },
]

type Props = {
  selected: Period
  onSelect: (p: Period) => void
}

export function PeriodTabs({ selected, onSelect }: Props) {
  return (
    <nav className="period-tabs">
      {PERIODS.map(p => (
        <button
          key={p.id}
          className={`period ${selected === p.id ? 'period-active' : ''}`}
          onClick={() => onSelect(p.id)}
        >
          {p.label}
        </button>
      ))}
    </nav>
  )
}
