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
  tradePnlPositiveSum: client.Counter<string>;
  tradePnlLossAbsSum: client.Counter<string>;
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
  washOverlap: client.Histogram<string>;
  washAbsCorr: client.Histogram<string>;
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

  // FAZA A Batch 5b — split into two monotonic Counters.
  // prom-client.Counter.inc() rejects negative values, so a single signed counter is impossible.
  // Net PnL% via PromQL: increase(tradePnlPositiveSum) - increase(tradePnlLossAbsSum).
  const tradePnlPositiveSum = new client.Counter({
    name: 'tradeai_trade_pnl_positive_sum',
    help: 'Cumulative sum of positive pnlPercent from closed trades (wins only).',
    labelNames: ['mode'] as const,
    registers: [registry],
  });

  const tradePnlLossAbsSum = new client.Counter({
    name: 'tradeai_trade_pnl_loss_abs_sum',
    help: 'Cumulative sum of |pnlPercent| from losing trades (absolute value of negative pnl).',
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
    // result=promoted|rejected_wilson|rejected_pf|rejected_sample|rejected_ruin|rejected_overfit
    //       |rejected_wash_cross|would_reject_wash_cross (FAZA 3/5 Batch 3/4 — wash guard)
    labelNames: ['result'] as const,
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

  // FAZA 3/5 BATCH 4/4 (2026-04-20) — Wash Guard distribution histograms.
  // Buckets cover [0,1] with extra resolution near typical danger zone (>0.5).
  // Calibration via Grafana: histogram_quantile(0.95, rate(tradeai_wash_overlap_bucket[24h]))
  // → if p95 << current threshold (0.70), thresholds are too permissive.
  const washBuckets = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0];
  const washOverlap = new client.Histogram({
    name: 'tradeai_wash_overlap',
    help: 'Distribution of cross-gladiator wash overlap ratio per promotion eval (shadow+enforce)',
    labelNames: ['mode'] as const, // mode=shadow|on
    buckets: washBuckets,
    registers: [registry],
  });
  const washAbsCorr = new client.Histogram({
    name: 'tradeai_wash_abs_corr',
    help: 'Distribution of cross-gladiator wash |Pearson(signed pnl)| per promotion eval (shadow+enforce)',
    labelNames: ['mode'] as const,
    buckets: washBuckets,
    registers: [registry],
  });

  return {
    registry,
    tradeExecutions, tradePnlPositiveSum, tradePnlLossAbsSum, tradeDuration,
    gladiatorKills, gladiatorForges, gladiatorPromotions,
    decisions,
    arenaPoolSize, arenaAlive, arenaKilled,
    selectionLiftPct, popWeightedPF, popWeightedWR,
    llmCostDollars, llmCalls,
    cronRuns, cronDuration,
    washOverlap, washAbsCorr,
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
