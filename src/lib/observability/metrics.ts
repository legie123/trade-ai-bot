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
  arenaZombieCount: client.Gauge<string>;
  selectionLiftPct: client.Gauge<string>;
  popWeightedPF: client.Gauge<string>;
  popWeightedWR: client.Gauge<string>;
  llmCostDollars: client.Counter<string>;
  llmCalls: client.Counter<string>;
  cronRuns: client.Counter<string>;
  cronDuration: client.Histogram<string>;
  washOverlap: client.Histogram<string>;
  washAbsCorr: client.Histogram<string>;
  polymarketSettlementCoverage: client.Gauge<string>;
  polymarketSettlementActed: client.Gauge<string>;
  polymarketSettlementSettled: client.Gauge<string>;
  polymarketSettlementPending: client.Gauge<string>;
  polymarketSettlementStatus: client.Gauge<string>;
  livePositionOldestAgeSec: client.Gauge<string>;
  livePositionOverMaxHold: client.Gauge<string>;
  polymarketBrainStatus: client.Gauge<string>;
  polymarketBrainSignalStatus: client.Gauge<string>;
  polymarketLastScanTimestamp: client.Gauge<string>;
  polymarketDecisionBudgetUsedUsd: client.Gauge<string>;
  polymarketDecisionBudgetCapUsd: client.Gauge<string>;
  polymarketDecisionBudgetVerdict: client.Gauge<string>;
  arenaGateDrops: client.Counter<string>;
  // AUDIT-R5 P0 — simulator close-outcome telemetry (SHADOW).
  simulatorCloseOutcomes: client.Counter<string>;
  simulatorHoldTime: client.Histogram<string>;
  simulatorCloseFinalPnl: client.Histogram<string>;
  // FAZA 7c — SHORT LIVE conditional gate (SHADOW by default).
  shortLiveGateAdmitted: client.Counter<string>;
  shortLiveGateBlocked: client.Counter<string>;
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

  // FAZA 3/4 2026-04-20 — Zombie Survey Gauge
  // Counts gladiators present in the ALIVE pool whose id also exists in the
  // graveyard. Expected steady-state: 0. A non-zero value (especially >15
  // sustained for >2h) signals a persistence race — killed gladiators
  // resurrecting in the json_store blob. This gauge intentionally does NOT
  // invoke the Butcher itself (that would introduce kill-rate volatility and
  // extra LLM cost). It is a SURVEY signal only. Grafana alert threshold:
  //   tradeai_arena_zombie_count > 15 for 2h → ops paging.
  //   Persistent drift → consider adding a scheduled arena:rotation cron.
  const arenaZombieCount = new client.Gauge({
    name: 'tradeai_arena_zombie_count',
    help: 'Gladiators in alive pool also present in graveyard. Steady-state=0; >15 for >2h indicates persistence race.',
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

  // FAZA 3.9 (2026-04-20) — Polymarket settlement observability gauges.
  // Source: probeSettlementHealth() in src/lib/polymarket/settlementHealth.ts
  // Freshness: depends on cadence of /api/v2/polymarket/settlement-health calls
  //   (manual poll, external alert, or Cloud Scheduler — not automatic).
  // Status encoding (gauge value):
  //   unknown=-1 (DB outage / not configured), idle=0 (no activity),
  //   green=1 (healthy or awaiting resolutions), yellow=2 (stale/suspicious),
  //   red=3 (settle loop likely broken).
  const polymarketSettlementCoverage = new client.Gauge({
    name: 'tradeai_polymarket_settlement_coverage',
    help: 'Polymarket settlement coverage: settled/acted ratio (0..1) per window.',
    labelNames: ['window'] as const, // '7d' | '30d'
    registers: [registry],
  });
  const polymarketSettlementActed = new client.Gauge({
    name: 'tradeai_polymarket_settlement_acted',
    help: 'Polymarket decisions that triggered a position per window.',
    labelNames: ['window'] as const,
    registers: [registry],
  });
  const polymarketSettlementSettled = new client.Gauge({
    name: 'tradeai_polymarket_settlement_settled',
    help: 'Polymarket acted decisions that reached a settled_at row per window.',
    labelNames: ['window'] as const,
    registers: [registry],
  });
  const polymarketSettlementPending = new client.Gauge({
    name: 'tradeai_polymarket_settlement_pending',
    help: 'Polymarket acted-but-unsettled decisions per window.',
    labelNames: ['window'] as const,
    registers: [registry],
  });
  const polymarketSettlementStatus = new client.Gauge({
    name: 'tradeai_polymarket_settlement_status',
    help: 'Polymarket settlement health status code (unknown=-1, idle=0, green=1, yellow=2, red=3).',
    registers: [registry],
  });

  // FAZA 3.12 (2026-04-20) — AUDIT-R4 shadow telemetry.
  // MAX_HOLD_SEC (default 3600s) is enforced only in simulator.ts (PAPER path).
  // The LIVE positionManager path (src/lib/v2/manager/positionManager.ts) has
  // NO time-based expiry — only TP / trailing / SL. These gauges expose the
  // gap empirically so operators can decide whether enforcement is warranted
  // BEFORE any execution-path mutation.
  //
  // SHADOW ONLY: read-side telemetry. Emitted from the positions cron tail
  // (1-minute cadence). No gladiator/position state is modified.
  const livePositionOldestAgeSec = new client.Gauge({
    name: 'tradeai_live_position_oldest_age_sec',
    help: 'Max hold age (seconds) across OPEN live positions at cron tick. 0 when pool empty. Shadow for AUDIT-R4.',
    registers: [registry],
  });
  const livePositionOverMaxHold = new client.Gauge({
    name: 'tradeai_live_position_over_max_hold',
    help: 'Count of OPEN live positions whose age >= MAX_HOLD_SEC (env; default 3600). Shadow for AUDIT-R4.',
    registers: [registry],
  });

  // FAZA 3.15 (2026-04-20) — Brain Status composite gauge.
  // Promotes the getBrainStatus() rollup into a Prometheus number so Grafana
  // alerting can page oncall the moment the brain flips to RED.
  //
  // Encoding (aligned with polymarket_settlement_status for operator memory):
  //   UNKNOWN = 0   (cache-miss / kill-switch / all sub-probes UNKNOWN)
  //   GREEN   = 1   (ready to place money)
  //   AMBER   = 2   (degraded — watch, don't page)
  //   RED     = 3   (broken — page)
  //
  // Alert rules (recommended):
  //   tradeai_polymarket_brain_status >= 3                  for 5m → sev-2 page
  //   tradeai_polymarket_brain_status == 2                  for 30m → sev-3 warn
  //   max_over_time(brain_status[1h]) == 0                  → probe dead
  //
  // Kill-switch: BRAIN_STATUS_METRICS_ENABLED=0 → writer no-op (gauge stale).
  const polymarketBrainStatus = new client.Gauge({
    name: 'tradeai_polymarket_brain_status',
    help: 'Brain Status composite verdict (0=unknown, 1=green, 2=amber, 3=red). Strictest-wins over edge/settlement/feed/ops signals.',
    registers: [registry],
  });
  const polymarketBrainSignalStatus = new client.Gauge({
    name: 'tradeai_polymarket_brain_signal_status',
    help: 'Per-signal status code feeding the Brain Status rollup (0=unknown, 1=green, 2=amber, 3=red).',
    labelNames: ['source'] as const, // source=edge|settlement|feed|ops
    registers: [registry],
  });

  // FAZA 4.2 — POLY SECTOR scan freshness observability for "opportunities disappear" diagnosis.
  // Root hypothesis: Cloud Run multi-instance in-memory lastScanResults drifts — the
  // instance that just scanned advances this gauge while sibling instances serving GET
  // /api/v2/polymarket status report lastScans=0. Gauge is set at setLastScans() time;
  // age derived in PromQL as time() - value. Persist-failure counter is NOT added in this
  // batch because savePolyLastScansToCloud is fire-and-forget (wraps debounced syncToCloud);
  // failures are already logged by processSyncQueue. Future batch (4.3) can add a
  // per-sync-target error counter if needed.
  const polymarketLastScanTimestamp = new client.Gauge({
    name: 'tradeai_polymarket_lastscan_timestamp_seconds',
    help: 'Unix epoch seconds of last completed Polymarket scan per division (per-instance). Age = time() - value. Stale = UI loses opportunities.',
    labelNames: ['division'] as const,
    registers: [registry],
  });

  // FAZA 3.16 (2026-04-20) — Decision Budget Gate gauges.
  // Shadow-only: gauges expose 24h LLM spend vs configured cap so operators can
  // tune thresholds before wiring `canMakeDecision()` into polySyndicate.
  //
  // Verdict encoding (higher=worse; aligned with brain_status + settlement_status):
  //   0 = unknown   1 = allow   2 = throttle   3 = block
  //
  // Source: getDecisionBudgetState() → pulls from llmCostTracker snapshot (local
  // per-instance 24h window). For fleet-wide caps aggregate via PromQL:
  //   increase(tradeai_llm_cost_dollars_total[24h])
  //
  // Kill: DECISION_BUDGET_ENABLED=0 → verdict forced to 'allow' (gauge = 1).
  const polymarketDecisionBudgetUsedUsd = new client.Gauge({
    name: 'tradeai_polymarket_decision_budget_used_usd',
    help: 'Rolling 24h LLM spend tracked by llmCostTracker in USD (per-instance).',
    registers: [registry],
  });
  const polymarketDecisionBudgetCapUsd = new client.Gauge({
    name: 'tradeai_polymarket_decision_budget_cap_usd',
    help: 'Configured daily LLM budget cap in USD (DECISION_BUDGET_USD_DAY).',
    registers: [registry],
  });
  const polymarketDecisionBudgetVerdict = new client.Gauge({
    name: 'tradeai_polymarket_decision_budget_verdict',
    help: 'Decision Budget Gate verdict code (0=unknown, 1=allow, 2=throttle, 3=block). Higher=worse.',
    registers: [registry],
  });

  // AUDIT-R2 FAZA B (2026-04-20) — Arena direction gate drop counter.
  // Counts phantom distributions blocked at ArenaSimulator.distributeSignalToGladiators
  // because pool-wide DIRECTION_{LONG,SHORT}_DISABLED policy is active. Distinct from
  // dualMaster LONG→FLAT rewrites: this one runs in the PAPER/simulator layer.
  //
  // Labels:
  //   direction = LONG | SHORT  (the dropped signal's normalized direction)
  //   reason    = disabled_long | disabled_short  (which kill-switch fired)
  //
  // Kill: DIRECTION_GATE_ENABLED=0 bypasses both branches → this counter stays flat.
  //       Per-direction: DIRECTION_LONG_DISABLED=0 / DIRECTION_SHORT_DISABLED=0.
  const arenaGateDrops = new client.Counter({
    name: 'tradeai_arena_gate_drops_total',
    help: 'Signals dropped by arena direction gate before phantom distribution (AUDIT-R2 FAZA B).',
    labelNames: ['direction', 'reason'] as const,
    registers: [registry],
  });

  // AUDIT-R5 P0 (2026-04-20) — Simulator close-outcome telemetry (SHADOW).
  // Purpose: reconstruct the empirical TP-hit vs SL-hit vs MAX_HOLD vs NEUTRAL
  // distribution per direction so that TP/SL thresholds (currently hardcoded
  // 1.0% / -0.5% in simulator.ts:186-187) can be re-tuned on empirical MFE/MAE,
  // not on the 2026-04-18 volatility-split heuristic.
  //
  // Kill-switch: SIMULATOR_TELEMETRY_ENABLED=0 → no observations written.
  // Costs: ~3 metric writes per closed phantom trade × ~O(100) closes/tick
  //        → negligible (<1ms per tick at the Prom client pooled layer).
  //
  // ASSUMPTIONS (if broken → labels drift from code semantics, NOT PnL impact):
  //   (1) simulator.ts:246-248 keeps hitTP/hitSL/isExpired boolean semantics
  //   (2) NEUTRAL_ZONE formula stays |pnl| < |SL|/2 at line 280
  //   (3) label `direction` stays LONG|SHORT (FLAT never reaches simulator)
  const simulatorCloseOutcomes = new client.Counter({
    name: 'tradeai_simulator_close_outcome_total',
    help: 'Phantom-trade close outcomes by direction. outcome=tp_hit|sl_hit|max_hold_close|neutral. SHADOW — use for TP/SL retune (AUDIT-R5 P0).',
    labelNames: ['direction', 'outcome'] as const,
    registers: [registry],
  });

  const simulatorHoldTime = new client.Histogram({
    name: 'tradeai_simulator_hold_time_seconds',
    help: 'Hold time of phantom trade at close, by direction × outcome. Buckets aligned with MAX_HOLD_SEC=3600 upper bound.',
    labelNames: ['direction', 'outcome'] as const,
    // Buckets: < 1min, 1-5, 5-15, 15-30, 30-60, 60-90, 90-120min.
    // MAX_HOLD_SEC=3600 forces most closes ≤3600; wider buckets reveal stragglers.
    buckets: [60, 300, 900, 1800, 3600, 5400, 7200],
    registers: [registry],
  });

  const simulatorCloseFinalPnl = new client.Histogram({
    name: 'tradeai_simulator_close_final_pnl_pct',
    help: 'Final pnlPercent (gross, clamped to TP/SL on hit) at close, by direction × outcome. Use to verify TP/SL clamping and MAX_HOLD pnl distribution.',
    labelNames: ['direction', 'outcome'] as const,
    // Buckets spanning realistic PnL% range. TP hits cluster at 1.0, SL at -0.5,
    // MAX_HOLD closes should distribute around 0 if symmetric alpha, biased if not.
    buckets: [-2, -1, -0.5, -0.25, 0, 0.25, 0.5, 1.0, 2.0],
    registers: [registry],
  });

  // FAZA 7c (2026-04-20) — SHORT LIVE conditional gate (session + symbol whitelist).
  // Tracks dualMaster LIVE-path outcomes only; PAPER/phantom continues unchanged
  // via ArenaSimulator.distributeSignalToGladiators → that lane is the holdout sampler.
  //
  // admitted labels: session=ASIA|LONDON|NEWYORK|OFF, symbol=BTC|SOL|PYTH|...
  // blocked labels : reason=session|symbol (enforcement) | shadow_session|shadow_symbol (shadow);
  //                  session + symbol as above.
  //
  // Kill: SHORT_LIVE_GATE_ENABLED=0 → counters stay flat (gate_off bypasses Counter inc
  // by design, so admitted counts remain meaningful as "pass through whitelist").
  const shortLiveGateAdmitted = new client.Counter({
    name: 'tradeai_short_live_gate_admitted_total',
    help: 'SHORT LIVE signals admitted through session+symbol whitelist gate (FAZA 7c).',
    labelNames: ['session', 'symbol'] as const,
    registers: [registry],
  });
  const shortLiveGateBlocked = new client.Counter({
    name: 'tradeai_short_live_gate_blocked_total',
    help: 'SHORT LIVE signals blocked by session+symbol gate; shadow_* variants count but do not enforce (FAZA 7c).',
    labelNames: ['reason', 'session', 'symbol'] as const,
    registers: [registry],
  });

  return {
    registry,
    tradeExecutions, tradePnlPositiveSum, tradePnlLossAbsSum, tradeDuration,
    gladiatorKills, gladiatorForges, gladiatorPromotions,
    decisions,
    arenaPoolSize, arenaAlive, arenaKilled, arenaZombieCount,
    selectionLiftPct, popWeightedPF, popWeightedWR,
    llmCostDollars, llmCalls,
    cronRuns, cronDuration,
    washOverlap, washAbsCorr,
    polymarketSettlementCoverage, polymarketSettlementActed,
    polymarketSettlementSettled, polymarketSettlementPending,
    polymarketSettlementStatus,
    livePositionOldestAgeSec, livePositionOverMaxHold,
    polymarketBrainStatus, polymarketBrainSignalStatus,
    polymarketLastScanTimestamp,
    polymarketDecisionBudgetUsedUsd, polymarketDecisionBudgetCapUsd,
    polymarketDecisionBudgetVerdict,
    arenaGateDrops,
    simulatorCloseOutcomes, simulatorHoldTime, simulatorCloseFinalPnl,
    shortLiveGateAdmitted, shortLiveGateBlocked,
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
