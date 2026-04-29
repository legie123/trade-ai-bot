// ============================================================
// FAZA 3.16 — Decision Budget Gate gauge writer.
//
// Consumes getDecisionBudgetState() and mirrors the 24h LLM spend / cap /
// verdict into Prometheus so Grafana can:
//   (a) chart spend vs cap over time,
//   (b) page oncall the moment the gate flips to `block`.
//
// Gauges (all no-label, per-instance):
//   tradeai_polymarket_decision_budget_used_usd     (rolling 24h spend)
//   tradeai_polymarket_decision_budget_cap_usd      (configured cap)
//   tradeai_polymarket_decision_budget_verdict      (0/1/2/3 — see below)
//
// Verdict encoding (higher = worse, aligned with brain_status +
// settlement_status for operator mental model):
//   0 = unknown    1 = allow    2 = throttle    3 = block
//
// Cadence:
//   Writer invoked from /api/metrics scrape tail (after brainStatusGauges).
//   State is cached 15s inside decisionBudget.ts itself, so consecutive
//   scrapes within that window are essentially free.
//
// Fail-soft:
//   If getDecisionBudgetState() throws, gauges keep their last value and
//   the error is logged but not re-thrown. Instrumentation must never
//   crash the scrape.
//
// Kill-switch:
//   DECISION_BUDGET_METRICS_ENABLED=0 → writer no-op (gauges become stale,
//   which itself is a visible "probe dead" signal).
//
// Note: DECISION_BUDGET_ENABLED=0 (the upstream gate kill) does NOT
// suppress emission — when the gate is disabled the classifier returns
// verdict='allow' (code=1) and we still want that reflected on dashboards.
// ============================================================

import { getDecisionBudgetState, BudgetVerdict } from '@/lib/polymarket/decisionBudget';
import { metrics, safeSet } from '@/lib/observability/metrics';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('DecisionBudgetGauges');

function verdictToNumber(v: BudgetVerdict): number {
  switch (v) {
    case 'allow':    return 1;
    case 'throttle': return 2;
    case 'block':    return 3;
    default:         return 0; // 'unknown' / anything unexpected
  }
}

/**
 * Pull the current budget verdict and mirror into Prometheus gauges.
 * Best-effort: logs and swallows errors, never throws.
 */
export async function refreshDecisionBudgetGauges(): Promise<void> {
  const enabled = (process.env.DECISION_BUDGET_METRICS_ENABLED ?? '1') !== '0';
  if (!enabled) return;

  try {
    const st = await getDecisionBudgetState();
    safeSet(metrics.polymarketDecisionBudgetUsedUsd, Number(st.usedUsd) || 0);
    safeSet(metrics.polymarketDecisionBudgetCapUsd, Number(st.capUsd) || 0);
    safeSet(metrics.polymarketDecisionBudgetVerdict, verdictToNumber(st.verdict));
  } catch (e) {
    log.warn('refresh failed', { error: (e as Error).message });
  }
}
