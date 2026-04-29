export type InsightMode = 'trend' | 'forecast' | 'pulse' | 'stats'

type Props = {
  selected: InsightMode
  onSelect: (m: InsightMode) => void
  modes: InsightMode[]
}

const LABELS: Record<InsightMode, string> = {
  trend: 'Trend',
  forecast: 'Forecast',
  pulse: 'Pulse',
  stats: 'Stats',
}

export function InsightPills({ selected, onSelect, modes }: Props) {
  return (
    <div className="insight-pills">
      {modes.map(m => (
        <button
          key={m}
          className={`insight-pill ${selected === m ? 'insight-pill-active' : ''}`}
          onClick={() => onSelect(m)}
        >
          {LABELS[m]}
        </button>
      ))}
    </div>
  )
}
