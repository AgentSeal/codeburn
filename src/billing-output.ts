import { CREDITS_PER_DOLLAR, type BillingConfig } from './billing.js'
import type { ParsedApiCall, ProjectSummary, SessionSummary } from './types.js'

export type BillingAggregate = {
  costEstimateUsd: number
  creditsAugment: number | null
  creditsSynthesizedCalls: number
  baseCostUsd: number | null
  surchargeUsd: number | null
  billedAmountUsd: number | null
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function addNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return null
  return (a ?? 0) + (b ?? 0)
}

export function emptyBillingAggregate(): BillingAggregate {
  return {
    costEstimateUsd: 0,
    creditsAugment: null,
    creditsSynthesizedCalls: 0,
    baseCostUsd: null,
    surchargeUsd: null,
    billedAmountUsd: null,
  }
}

export function addBillingAggregate(target: BillingAggregate, source: BillingAggregate): BillingAggregate {
  target.costEstimateUsd += source.costEstimateUsd
  target.creditsAugment = addNullable(target.creditsAugment, source.creditsAugment)
  target.creditsSynthesizedCalls += source.creditsSynthesizedCalls
  target.baseCostUsd = addNullable(target.baseCostUsd, source.baseCostUsd)
  target.surchargeUsd = addNullable(target.surchargeUsd, source.surchargeUsd)
  target.billedAmountUsd = addNullable(target.billedAmountUsd, source.billedAmountUsd)
  return target
}

export function billingAggregateFromCall(call: ParsedApiCall): BillingAggregate {
  return {
    costEstimateUsd: call.costUSD,
    creditsAugment: call.billing?.creditsAugment ?? call.credits ?? null,
    creditsSynthesizedCalls: call.billing?.synthesized ? 1 : 0,
    baseCostUsd: call.billing?.baseCostUsd ?? null,
    surchargeUsd: call.billing?.surchargeUsd ?? null,
    billedAmountUsd: call.billing?.billedAmountUsd ?? null,
  }
}

export function aggregateCallsBilling(calls: ParsedApiCall[]): BillingAggregate {
  return calls.reduce((agg, call) => addBillingAggregate(agg, billingAggregateFromCall(call)), emptyBillingAggregate())
}

export function billingAggregateFromSession(session: SessionSummary): BillingAggregate {
  const fromCalls = aggregateCallsBilling(session.turns.flatMap(turn => turn.assistantCalls))
  return {
    costEstimateUsd: session.totalCostUSD,
    creditsAugment: session.totalCredits ?? fromCalls.creditsAugment,
    creditsSynthesizedCalls: session.creditsSynthesizedCount ?? fromCalls.creditsSynthesizedCalls,
    baseCostUsd: session.totalBaseCostUsd ?? fromCalls.baseCostUsd,
    surchargeUsd: session.totalSurchargeUsd ?? fromCalls.surchargeUsd,
    billedAmountUsd: session.totalBilledAmountUsd ?? fromCalls.billedAmountUsd,
  }
}

export function aggregateSessionsBilling(sessions: SessionSummary[]): BillingAggregate {
  return sessions.reduce((agg, session) => addBillingAggregate(agg, billingAggregateFromSession(session)), emptyBillingAggregate())
}

export function billingAggregateFromProject(project: ProjectSummary): BillingAggregate {
  return aggregateSessionsBilling(project.sessions)
}

export function billingMetricValue(aggregate: BillingAggregate, config: BillingConfig): number {
  if (config.mode === 'credits') return aggregate.creditsAugment ?? 0
  return aggregate.billedAmountUsd ?? aggregate.costEstimateUsd
}

export function buildBillingMetadata(config: BillingConfig): Record<string, unknown> {
  if (config.mode === 'credits') {
    return {
      mode: 'credits',
      creditsPerDollar: CREDITS_PER_DOLLAR,
      amountFields: {
        cost: 'not_applicable',
        creditsAugment: 'augment_credits_or_synthesized_when_ground_truth_unavailable',
        creditsSynthesizedCalls: 'count_of_calls_with_synthesized_credits',
        costEstimateUsd: 'token_pricing_estimate_usd_not_authoritative_billing',
      },
    }
  }
  return {
    mode: 'token_plus',
    surchargeRate: config.surchargeRate,
    amountFields: {
      cost: 'legacy_alias_for_billedAmountUsd',
      baseCostUsd: 'token_pricing_base_usd',
      surchargeUsd: 'token_plus_surcharge_usd',
      billedAmountUsd: 'baseCostUsd_plus_surchargeUsd',
    },
  }
}

export function billingJsonFields(aggregate: BillingAggregate, config: BillingConfig): Record<string, unknown> {
  if (config.mode === 'credits') {
    return {
      cost: null,
      creditsAugment: aggregate.creditsAugment,
      creditsSynthesizedCalls: aggregate.creditsSynthesizedCalls,
      costEstimateUsd: round2(aggregate.costEstimateUsd),
    }
  }
  const billedAmountUsd = aggregate.billedAmountUsd !== null ? round2(aggregate.billedAmountUsd) : null
  return {
    baseCostUsd: aggregate.baseCostUsd !== null ? round2(aggregate.baseCostUsd) : null,
    surchargeUsd: aggregate.surchargeUsd !== null ? round2(aggregate.surchargeUsd) : null,
    billedAmountUsd,
    cost: billedAmountUsd ?? round2(aggregate.costEstimateUsd),
  }
}

export function billingCsvFields(aggregate: BillingAggregate, config: BillingConfig): Record<string, string | number> {
  if (config.mode === 'credits') {
    return {
      'Credits (Augment)': aggregate.creditsAugment ?? '',
      'Synthesized Credit Calls': aggregate.creditsSynthesizedCalls,
      'Cost Estimate (USD)': round2(aggregate.costEstimateUsd),
    }
  }
  return {
    'Billed Amount (USD)': aggregate.billedAmountUsd !== null ? round2(aggregate.billedAmountUsd) : '',
    'Base Cost (USD)': aggregate.baseCostUsd !== null ? round2(aggregate.baseCostUsd) : '',
    'Surcharge (USD)': aggregate.surchargeUsd !== null ? round2(aggregate.surchargeUsd) : '',
  }
}