import type { MenubarPayload } from '../lib/payload'
import type { CurrencyState } from '../lib/currency'
import { formatCurrency } from '../lib/currency'

type Props = {
  payload: MenubarPayload
  currency: CurrencyState
}

export function HeroSection({ payload, currency }: Props) {
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const label = payload.current.label || 'Today'
  const caption = label === 'Today' ? `${label} · ${todayLabel}` : label

  return (
    <section className="hero">
      <div className="hero-label">
        <span className="hero-dot" /> {caption}
      </div>
      <div className="hero-amount">
        {formatCurrency(payload.current.cost, currency)}
      </div>
      <div className="hero-meta">
        <span>{payload.current.calls.toLocaleString()} calls</span>
        <span>{payload.current.sessions} sessions</span>
      </div>
    </section>
  )
}
