const TTL = 300_000

interface CacheEntry<T> {
  data: T
  ts: number
}

export class PayloadCache<T> {
  private store = new Map<string, CacheEntry<T>>()
  private flights = new Set<string>()

  private key(period: string, provider: string): string {
    return `${period}:${provider}`
  }

  get(period: string, provider: string): T | null {
    const entry = this.store.get(this.key(period, provider))
    if (!entry) return null
    if (Date.now() - entry.ts > TTL) return null
    return entry.data
  }

  getStale(period: string, provider: string): T | null {
    const entry = this.store.get(this.key(period, provider))
    return entry ? entry.data : null
  }

  set(period: string, provider: string, data: T): void {
    this.store.set(this.key(period, provider), { data, ts: Date.now() })
  }

  isInFlight(period: string, provider: string): boolean {
    return this.flights.has(this.key(period, provider))
  }

  markInFlight(period: string, provider: string): void {
    this.flights.add(this.key(period, provider))
  }

  clearInFlight(period: string, provider: string): void {
    this.flights.delete(this.key(period, provider))
  }
}
