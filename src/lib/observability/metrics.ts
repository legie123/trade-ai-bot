// ============================================================
// FAZA A BATCH 1 — Prometheus Metrics Substrate
// Single source of truth for domain metrics exported to Grafana.
//
// RUFLO FAZA A 2026-04-19:
// - prom-client singleton Registry (survives hot-reloads via globalThis)
// - Domain counters/gauges/histograms for: trades, gladiators, pool, LLM cost
// - Scraped via /api/metrics (Bearer METRICS_TOKEN)
//
// NODE RUNTIME ONLY. Do NOT import from Edge routes / middleware.
// ============================================================

import client from 'prom-client';

// Singleton registry — survives Next.js dev hot-reloads
const g = globalThis as unknown as { __tradeAiMetrics?: {
  registry: client.Registry;
  tradeExecutions: client.Counter<string>;
  tradePnlSum: client.Counter<string>;
  tradeDuration: client.Histogram<string>;
  gladiatorKills: client.Counter<string>;
  gladiatorForges: client.Counter<string>;
  gladiatorPromotions: client.Counter<string>;
  decisions: client.Counter<string>;
  arenaPoolSize: client.Gauge<string>;
  arenaAlive: client.Gauge<string>;
  arenaKilled: client.Gauge<string>;
  selectionLiftPct: client.Gauge<string>;
  popWeightedPF: client.Gauge<string>;
  popWeightedWR: client.Gauge<string>;
  llmCostDollars: client.Counter<string>;
  llmCalls: client.Counter<string>;
  cronRuns: client.Counter<string>;
  cronDuration: client.Histogram<string>;
} };

function build() {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: 'trade-ai' });
  client.collectDefaultMetrics({ register: registry, prefix: 'tradeai_' });

  const tradeExecutions = new client.Counter({
    name: 'tradeai_trade_executions_total',
    help: 'Total trade executions',
    labelNames: ['mode', 'side', 'result'] as const, // mode=paper|live, side=LONG|SHORT, result=win|loss|open
    registers: [registry],
  });

  const tradePnlSum = new client.Counter({
    name: 'tradeai_trade_pnl_percent_sum',
    help: 'Sum of closed-trade pnlPercent (net of fees+slippage). Can go negative via gauge trick — use increase() cautiously.',
    labelNames: ['mode'] as const,
    registers: [registry],
  });

  const tradeDuration = new client.Histogram({
    name: 'tradeai_trade_duration_seconds',
    help: 'Trade hold duration (open→close)',
    labelNames: ['mode'] as const,
    buckets: [60, 300, 900, 1800, 3600, 7200, 14400, 28800, 86400],
    registers: [registry],
  });

  const gladiatorKills = new client.Counter({
    name: 'tradeai_gladiator_kills_total',
    help: 'Butcher kill events',
    labelNames: ['reason', 'mode'] as const, // reason=pf|winrate|consecutive_losses|..., mode=shadow|live
    registers: [registry],
  });

  const gladiatorForges = new client.Counter({
    name: 'tradeai_gladiator_forges_total',
    help: 'Forge spawn attempts',
    labelNames: ['outcome'] as const, // outcome=accepted|rejected_duplicate|rejected_minibacktest|rejected_edge
    registers: [registry],
  });

  const gladiatorPromotions = new client.Counter({
    name: 'tradeai_gladiator_promotions_total',
    help: 'Auto-promote transitions shadow→live',
    labelNames: ['result'] as const, // result=promoted|rejected_wilson|rejected_pf|rejected_sample
    registers: [registry],
  });

  const decisions = new client.Counter({
    name: 'tradeai_decisions_total',
    help: 'addDecision invocations (signal → outcome record)',
    labelNames: ['verdict'] as const, // verdict=buy|sell|flat
    registers: [registry],
  });

  const arenaPoolSize = new client.Gauge({
    name: 'tradeai_arena_pool_size',
    help: 'Total gladiator pool size',
    registers: [registry],
  });

  const arenaAlive = new client.Gauge({
    name: 'tradeai_arena_alive_total',
    help: 'Alive gladiators (active, not in graveyard)',
    registers: [registry],
  });

  const arenaKilled = new client.Gauge({
    name: 'tradeai_arena_killed_total',
    help: 'Cumulative killed (graveyard residents)',
    registers: [registry],
  });

  const selectionLiftPct = new client.Gauge({
    name: 'tradeai_selection_lift_pct',
    help: 'Selection lift: (alive pool avg WR - random baseline) × 100. Negative = pool worse than random.',
    registers: [registry],
  });

  const popWeightedPF = new client.Gauge({
    name: 'tradeai_pop_weighted_pf',
    help: 'Population-weighted profit factor (alive pool aggregate)',
    registers: [registry],
  });

  const popWeightedWR = new client.Gauge({
    name: 'tradeai_pop_weighted_winrate',
    help: 'Population-weighted win rate (alive pool aggregate, 0..1)',
    registers: [registry],
  });

  const llmCostDollars = new client.Counter({
    name: 'tradeai_llm_cost_dollars_total',
    help: 'Cumulative LLM API spend (USD)',
    labelNames: ['provider', 'model'] as const,
    registers: [registry],
  });

  const llmCalls = new client.Counter({
    name: 'tradeai_llm_calls_total',
    help: 'LLM API calls',
    labelNames: ['provider', 'model', 'status'] as const, // status=ok|error|timeout
    registers: [registry],
  });

  const cronRuns = new client.Counter({
    name: 'tradeai_cron_runs_total',
    help: 'Cron job invocations',
    labelNames: ['job', 'result'] as const, // result=ok|error|skipped
    registers: [registry],
  });

  const cronDuration = new client.Histogram({
    name: 'tradeai_cron_duration_seconds',
    help: 'Cron job runtime',
    labelNames: ['job'] as const,
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
    registers: [registry],
  });

  return {
    registry,
    tradeExecutions, tradePnlSum, tradeDuration,
    gladiatorKills, gladiatorForges, gladiatorPromotions,
    decisions,
    arenaPoolSize, arenaAlive, arenaKilled,
    selectionLiftPct, popWeightedPF, popWeightedWR,
    llmCostDollars, llmCalls,
    cronRuns, cronDuration,
  };
}

if (!g.__tradeAiMetrics) {
  g.__tradeAiMetrics = build();
}

export const metrics = g.__tradeAiMetrics!;
export const registry = metrics.registry;

// Safe increment helpers — never throw, log + swallow on error so instrumentation can't crash domain code
export function safeInc(counter: client.Counter<string>, labels?: Record<string, string | number>, value = 1) {
  try {
    if (labels) counter.inc(labels as never, value);
    else counter.inc(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[metrics] inc failed', (e as Error).message);
  }
}

export function safeSet(gauge: client.Gauge<string>, value: number, labels?: Record<string, string | number>) {
  try {
    if (labels) gauge.set(labels as never, value);
    else gauge.set(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[metrics] set failed', (e as Error).message);
  }
}

export function safeObserve(histogram: client.Histogram<string>, value: number, labels?: Record<string, string | number>) {
  try {
    if (labels) histogram.observe(labels as never, value);
    else histogram.observe(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[metrics] observe failed', (e as Error).message);
  }
}
