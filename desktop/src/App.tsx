import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { MenubarPayload } from './lib/payload'
import { placeholderPayload } from './lib/payload'
import type { CurrencyState } from './lib/currency'
import { USD } from './lib/currency'
import { PayloadCache } from './lib/cache'
import { AgentTabStrip } from './components/AgentTabStrip'
import type { Provider } from './components/AgentTabStrip'
import { ModelsSection } from './components/ModelsSection'
import { InsightPills, type InsightMode } from './components/InsightPills'
import { TrendInsight } from './components/TrendInsight'
import { ForecastInsight } from './components/ForecastInsight'
import { PulseInsight } from './components/PulseInsight'
import { StatsInsight } from './components/StatsInsight'
import { FindingsSection } from './components/FindingsSection'
import { ActivitySection } from './components/ActivitySection'
import { LoadingOverlay } from './components/LoadingOverlay'
import { EmptyProviderState } from './components/EmptyProviderState'
import { StarBanner } from './components/StarBanner'
import { HeroSection } from './components/HeroSection'
import { PeriodTabs, PERIOD_LABELS } from './components/PeriodTabs'
import type { Period } from './components/PeriodTabs'

const payloadCache = new PayloadCache<MenubarPayload>()

const REFRESH_INTERVAL_MS = 60_000

export function App() {
  const [payload, setPayload] = useState<MenubarPayload>(placeholderPayload)
  const [todayPayload, setTodayPayload] = useState<MenubarPayload>(placeholderPayload)
  const [period, setPeriod] = useState<Period>('today')
  const [provider, setProvider] = useState<Provider>('all')
  const [currency, setCurrency] = useState<CurrencyState>(USD)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insight, setInsight] = useState<InsightMode>('trend')

  const refresh = useCallback(async (includeOptimize: boolean) => {
    if (!includeOptimize) {
      const cached = payloadCache.get(period, provider)
      if (cached) {
        setPayload(cached)
        return
      }
    }

    if (payloadCache.isInFlight(period, provider)) return

    const stale = payloadCache.getStale(period, provider)
    if (stale) setPayload(stale)

    payloadCache.markInFlight(period, provider)
    setLoading(true)
    setError(null)
    try {
      const json = await invoke<MenubarPayload>('fetch_payload', {
        period,
        provider,
        includeOptimize,
      })
      payloadCache.set(period, provider, json)
      setPayload(json)
      if (period === 'today' && provider === 'all') {
        setTodayPayload(json)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      payloadCache.clearInFlight(period, provider)
      setLoading(false)
    }
  }, [period, provider])

  useEffect(() => {
    refresh(true)
    const id = setInterval(() => refresh(false), REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const unlisten = listen('codeburn://refresh', () => refresh(true))
    return () => { unlisten.then(fn => fn()) }
  }, [refresh])

  const applyCurrency = async (code: string) => {
    try {
      const applied = await invoke<CurrencyState>('set_currency', { code })
      setCurrency(applied)
    } catch (err) {
      console.error('set_currency failed', err)
    }
  }

  const openFullReport = () => {
    invoke('open_terminal_command', { args: ['report'] }).catch(console.error)
  }

  const exportData = (format: 'csv' | 'json') => {
    invoke('open_terminal_command', { args: ['export', '-f', format] }).catch(console.error)
  }

  const isFilteredEmpty = provider !== 'all' && payload.current.cost <= 0 && payload.current.calls === 0

  return (
    <div className="popover">
      <header className="header">
        <div className="brand">
          <span className="brand-primary">Code</span>
          <span className="brand-accent">Burn</span>
        </div>
        <div className="subhead">AI Coding Cost Tracker</div>
      </header>

      <AgentTabStrip
        selected={provider}
        onSelect={setProvider}
        payload={todayPayload}
        currency={currency}
      />

      <div className="main-content">
        <HeroSection payload={payload} currency={currency} />

        <PeriodTabs selected={period} onSelect={setPeriod} />

        {isFilteredEmpty ? (
          <EmptyProviderState provider={provider} period={period} />
        ) : (
          <>
            <div className="insight-area">
              <InsightPills
                selected={insight}
                onSelect={setInsight}
                modes={['trend', 'forecast', 'pulse', 'stats']}
              />
              {insight === 'trend' && (
                <TrendInsight days={payload.history.daily} currency={currency} />
              )}
              {insight === 'forecast' && (
                <ForecastInsight days={payload.history.daily} currency={currency} />
              )}
              {insight === 'pulse' && (
                <PulseInsight payload={payload} currency={currency} />
              )}
              {insight === 'stats' && (
                <StatsInsight payload={payload} currency={currency} />
              )}
            </div>

            {!loading && payload.current.calls === 0 && payload.current.sessions === 0 ? (
              <section className="empty-state">
                <h2 className="section-title">No session data yet</h2>
                <p>
                  CodeBurn reads local session logs from your AI coding tools. It looks like
                  none of the supported tools have written any sessions on this machine yet.
                </p>
                <p>Supported sources:</p>
                <ul>
                  <li><code>~/.claude/projects/</code> (Claude Code)</li>
                  <li><code>~/.codex/sessions/</code> (Codex CLI)</li>
                  <li>Cursor IDE local database</li>
                  <li>GitHub Copilot session events</li>
                </ul>
                <p>Run one of those tools for a session, then hit Refresh.</p>
              </section>
            ) : (
              <ActivitySection payload={payload} currency={currency} />
            )}

            <ModelsSection
              models={payload.current.topModels}
              inputTokens={payload.current.inputTokens}
              outputTokens={payload.current.outputTokens}
              cacheHitPercent={payload.current.cacheHitPercent}
              currency={currency}
            />

            <FindingsSection payload={payload} />
          </>
        )}

        {loading && <LoadingOverlay periodLabel={PERIOD_LABELS[period] ?? period} />}
      </div>

      <footer className="footer">
        <select
          className="currency-picker"
          value={currency.code}
          onChange={e => applyCurrency(e.target.value)}
        >
          {['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'NZD', 'JPY', 'CHF', 'INR', 'BRL', 'SEK', 'SGD', 'HKD', 'KRW', 'MXN', 'ZAR', 'DKK']
            .map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="refresh" onClick={() => refresh(true)} disabled={loading}>
          {loading ? '...' : '↻'}
        </button>
        <select
          className="export-picker"
          value=""
          onChange={e => { if (e.target.value) exportData(e.target.value as 'csv' | 'json'); e.target.value = '' }}
        >
          <option value="" disabled>Export</option>
          <option value="csv">CSV (folder)</option>
          <option value="json">JSON</option>
        </select>
        <button className="report" onClick={openFullReport}>Open Full Report</button>
        <button className="quit" onClick={() => invoke('quit_app').catch(console.error)} title="Quit CodeBurn">×</button>
      </footer>

      <StarBanner />

      {error && <div className="error-toast">{error}</div>}
    </div>
  )
}
