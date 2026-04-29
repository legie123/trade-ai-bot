// ============================================================
// FAZA 3.15 — Brain Status composite gauge writer.
//
// Consumes the aggregator verdict from src/lib/polymarket/brainStatus.ts
// and emits it as two Prometheus gauges:
//
//   tradeai_polymarket_brain_status                   (composite 0..3)
//   tradeai_polymarket_brain_signal_status{source=*}  (per-source 0..3)
//
// Encoding:
//   UNKNOWN = 0    GREEN = 1    AMBER = 2    RED = 3
//   (higher = worse; mirrors tradeai_polymarket_settlement_status scale)
//
// Cadence:
//   Writer is invoked from the /api/metrics scrape tail (after poolGauges).
//   getBrainStatus() itself is cached 30s, so consecutive scrapes in the
//   same 30s window hit the cached verdict — refresh cost = O(one cache read).
//
// Fail-soft:
//   If getBrainStatus() throws, gauges keep their last value and the error
//   is logged but not re-thrown (instrumentation must never crash the scrape).
//
// Kill-switch:
//   BRAIN_STATUS_METRICS_ENABLED=0 → no-op (gauges become stale, Grafana
//   will see a flat line and the "probe dead" alert rule triggers).
// ============================================================

import { getBrainStatus, BrainVerdict, BrainSignal } from '@/lib/polymarket/brainStatus';
import { metrics, safeSet } from '@/lib/observability/metrics';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('BrainStatusGauges');

function verdictToNumber(v: BrainVerdict | BrainSignal['verdict']): number {
  // Normalise case — BrainVerdict is upper, BrainSignal.verdict is lower.
  const k = String(v).toUpperCase();
  switch (k) {
    case 'GREEN':   return 1;
    case 'AMBER':   return 2;
    case 'RED':     return 3;
    default:        return 0; // UNKNOWN / undefined / anything unexpected
  }
}

/**
 * Pull the aggregator verdict and mirror it into Prometheus gauges.
 * Best-effort: logs and swallows errors, never throws.
 */
export async function refreshBrainStatusGauges(): Promise<void> {
  const enabled = (process.env.BRAIN_STATUS_METRICS_ENABLED ?? '1') !== '0';
  if (!enabled) return;

  try {
    const status = await getBrainStatus();
    safeSet(metrics.polymarketBrainStatus, verdictToNumber(status.verdict));
    for (const sig of status.signals) {
      safeSet(metrics.polymarketBrainSignalStatus, verdictToNumber(sig.verdict), {
        source: sig.source,
      });
    }
  } catch (e) {
    log.warn('refresh failed', { error: (e as Error).message });
  }
}
