/**
 * settlementHealth.ts — observability probe for the FAZA 3.7 settlement loop.
 *
 * WHY THIS EXISTS
 * After FAZA 3.7 shipped, settleDecision writes settled_* back onto
 * polymarket_decisions. But there's no fast way to see "is the loop
 * actually working?" until buildWeeklyReport runs on a 7d window.
 * This probe exposes the operational state directly:
 *
 *   acted_count    — how many decisions triggered a position (7d + 30d)
 *   settled_count  — how many of those have a settled_at row
 *   coverage       — settled / max(1, acted)
 *   pending        — acted - settled (open positions + un-settled markets)
 *   oldest_pending — age of the oldest acted-but-unsettled decision
 *   horizon_p50/95 — ms from entry to settle (sanity bands)
 *   outcomes       — YES / NO / CANCEL counts
 *
 * INVARIANTS (health logic):
 * - "coverage=0 over 7d" is NORMAL: most Polymarket markets don't resolve
 *   within 7d. Don't treat as RED alone.
 * - horizon_p50 < 60s is SUSPICIOUS: either a bug in settle writeback
 *   (writing at t=open) or a rapid-close exit we didn't expect.
 * - oldest_pending > 30d + acted > 50 + settled=0 = RED (loop broken).
 *
 * SAFETY: pure read-side. Never writes. Soft-fails to { status:'unknown',
 * reason:'supabase_unavailable' } on DB outage. Coverage numbers are
 * lower-bound because Supabase fetch is capped at 10k rows (very large
 * operator but same cap as buildWeeklyReport for consistency).
 */
import { supabase as supa, SUPABASE_CONFIGURED } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { metrics, safeSet } from '@/lib/observability/metrics';

const log = createLogger('PolySettlementHealth');

/**
 * FAZA 3.9 — map HealthStatus to gauge numeric code for Prometheus.
 * -1 reserved for 'unknown' so alerts can distinguish "probe failed" from "idle".
 */
function statusCode(status: HealthStatus): number {
  switch (status) {
    case 'unknown': return -1;
    case 'idle':    return 0;
    case 'green':   return 1;
    case 'yellow':  return 2;
    case 'red':     return 3;
    default:        return -1;
  }
}

/**
 * FAZA 3.9 — emit settlement gauges so Grafana Cloud can scrape them.
 * Called from probeSettlementHealth tail. All writes via safeSet, so a
 * metrics-library failure cannot crash the observability probe itself.
 */
function emitSettlementGauges(windows: SettlementWindow[], status: HealthStatus) {
  for (const w of windows) {
    safeSet(metrics.polymarketSettlementCoverage, w.coverage, { window: w.label });
    safeSet(metrics.polymarketSettlementActed, w.acted, { window: w.label });
    safeSet(metrics.polymarketSettlementSettled, w.settled, { window: w.label });
    safeSet(metrics.polymarketSettlementPending, w.pending, { window: w.label });
  }
  safeSet(metrics.polymarketSettlementStatus, statusCode(status));
}

// Supabase client — shared singleton from db.ts

const FETCH_LIMIT = 10_000;

export type HealthStatus = 'idle' | 'green' | 'yellow' | 'red' | 'unknown';

export interface SettlementWindow {
  label: string;                 // '7d' | '30d'
  spanMs: number;
  acted: number;
  settled: number;
  coverage: number;              // settled / max(1, acted)
  pending: number;               // acted - settled
  oldestPendingAgeMs: number | null;
  horizonP50Ms: number | null;
  horizonP95Ms: number | null;
  outcomes: { YES: number; NO: number; CANCEL: number; other: number };
}

export interface SettlementHealth {
  status: HealthStatus;
  reason: string;
  nowIso: string;
  windows: SettlementWindow[];
  /** Tunables that shaped the health decision (for audit). */
  thresholds: {
    minActedForRed: number;
    staleDays: number;
    suspiciousHorizonMs: number;
  };
}

interface Row {
  acted: boolean;
  decided_at: string;
  settled_at: string | null;
  settled_outcome: string | null;
  horizon_ms: number | null;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function buildWindow(rows: Row[], label: string, spanMs: number, now: number): SettlementWindow {
  const cutoff = now - spanMs;
  const inWindow = rows.filter(r => {
    const t = new Date(r.decided_at).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  const acted = inWindow.filter(r => r.acted);
  const settled = acted.filter(r => r.settled_at != null);
  const pending = acted.filter(r => r.settled_at == null);

  // Oldest pending = min(decided_at) over pending rows
  let oldestPendingAgeMs: number | null = null;
  if (pending.length > 0) {
    const oldestMs = pending
      .map(r => new Date(r.decided_at).getTime())
      .filter(t => Number.isFinite(t))
      .reduce((m, t) => Math.min(m, t), Number.POSITIVE_INFINITY);
    if (Number.isFinite(oldestMs)) oldestPendingAgeMs = now - oldestMs;
  }

  // Horizon distribution (settled only, valid non-negative ms)
  const horizons = settled
    .map(r => r.horizon_ms)
    .filter((h): h is number => typeof h === 'number' && Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b);

  const outcomes = { YES: 0, NO: 0, CANCEL: 0, other: 0 };
  for (const r of settled) {
    const o = (r.settled_outcome ?? '').toUpperCase();
    if (o === 'YES') outcomes.YES++;
    else if (o === 'NO') outcomes.NO++;
    else if (o === 'CANCEL') outcomes.CANCEL++;
    else outcomes.other++;
  }

  return {
    label,
    spanMs,
    acted: acted.length,
    settled: settled.length,
    coverage: acted.length > 0 ? settled.length / acted.length : 0,
    pending: pending.length,
    oldestPendingAgeMs,
    horizonP50Ms: quantile(horizons, 0.5),
    horizonP95Ms: quantile(horizons, 0.95),
    outcomes,
  };
}

/**
 * Health classifier. Order matters: checks are in decreasing severity so a
 * single window triggering RED wins over a greener window.
 *
 * Why asymmetric thresholds between 7d and 30d windows:
 *   7d  → freshness. "Is the loop firing?"
 *   30d → coverage. "Are we accumulating settled data?"
 */
function classify(
  windows: SettlementWindow[],
  thresholds: SettlementHealth['thresholds'],
): { status: HealthStatus; reason: string } {
  const w30 = windows.find(w => w.label === '30d');
  const w7 = windows.find(w => w.label === '7d');

  // No activity at all → idle (not a problem, just nothing to observe)
  if (!w30 || w30.acted === 0) {
    return { status: 'idle', reason: 'no acted decisions in 30d window' };
  }

  // Suspicious fast settlements → yellow (possible bug in writeback timing)
  for (const w of windows) {
    if (w.horizonP50Ms != null && w.horizonP50Ms < thresholds.suspiciousHorizonMs && w.settled >= 5) {
      return {
        status: 'yellow',
        reason: `suspicious fast settlements: ${w.label} horizon_p50=${w.horizonP50Ms}ms < ${thresholds.suspiciousHorizonMs}ms (n_settled=${w.settled})`,
      };
    }
  }

  const staleMs = thresholds.staleDays * 86_400_000;

  // Broken loop: plenty of acted, zero settled, oldest pending stale
  if (
    w30.acted >= thresholds.minActedForRed &&
    w30.settled === 0 &&
    w30.oldestPendingAgeMs != null &&
    w30.oldestPendingAgeMs > staleMs
  ) {
    return {
      status: 'red',
      reason: `settle loop likely broken: 30d acted=${w30.acted}, settled=0, oldest_pending_age=${(w30.oldestPendingAgeMs / 86_400_000).toFixed(1)}d > ${thresholds.staleDays}d`,
    };
  }

  // Stale pending but not RED yet
  if (w30.oldestPendingAgeMs != null && w30.oldestPendingAgeMs > staleMs) {
    return {
      status: 'yellow',
      reason: `stale pending: oldest acted-unsettled age=${(w30.oldestPendingAgeMs / 86_400_000).toFixed(1)}d > ${thresholds.staleDays}d`,
    };
  }

  // All green — settled rows present and horizons look plausible
  if (w30.settled > 0) {
    return {
      status: 'green',
      reason: `settlement loop healthy: 30d settled=${w30.settled}/${w30.acted} coverage=${(w30.coverage * 100).toFixed(1)}%`,
    };
  }

  // Acted but not settled yet, and pending is fresh — normal pre-resolution state
  return {
    status: 'green',
    reason: `awaiting market resolutions: 30d acted=${w30.acted}, pending ${w7?.pending ?? 0} in 7d`,
  };
}

export async function probeSettlementHealth(): Promise<SettlementHealth> {
  const nowIso = new Date().toISOString();
  const now = Date.now();
  const thresholds = {
    minActedForRed: Number.parseInt(process.env.POLY_SETTLEMENT_HEALTH_MIN_RED ?? '50', 10),
    staleDays: Number.parseFloat(process.env.POLY_SETTLEMENT_HEALTH_STALE_DAYS ?? '30'),
    suspiciousHorizonMs: Number.parseInt(process.env.POLY_SETTLEMENT_HEALTH_FAST_MS ?? '60000', 10),
  };

  if (!SUPABASE_CONFIGURED) {
    emitSettlementGauges([], 'unknown');
    return { status: 'unknown', reason: 'supabase_unconfigured', nowIso, windows: [], thresholds };
  }

  try {
    // Fetch last 30d of rows in a single pass; slice 7d client-side.
    // Caps at FETCH_LIMIT rows — with >10k decisions in 30d this becomes
    // a lower-bound but the warning is still directionally correct.
    const since = new Date(now - 30 * 86_400_000).toISOString();
    const { data, error } = await supa
      .from('polymarket_decisions')
      .select('acted, decided_at, settled_at, settled_outcome, horizon_ms')
      .gte('decided_at', since)
      .order('decided_at', { ascending: false })
      .limit(FETCH_LIMIT);
    if (error) {
      log.warn('probeSettlementHealth fetch failed', { error: error.message });
      emitSettlementGauges([], 'unknown');
      return { status: 'unknown', reason: `supabase_error: ${error.message}`, nowIso, windows: [], thresholds };
    }
    const rows = (data || []) as Row[];

    const windows: SettlementWindow[] = [
      buildWindow(rows, '7d', 7 * 86_400_000, now),
      buildWindow(rows, '30d', 30 * 86_400_000, now),
    ];

    const { status, reason } = classify(windows, thresholds);

    // FAZA 3.9 — emit gauges for Grafana Cloud scrape.
    // Safe: safeSet swallows metric lib failures.
    emitSettlementGauges(windows, status);

    return { status, reason, nowIso, windows, thresholds };
  } catch (err) {
    log.warn('probeSettlementHealth threw', { error: String(err) });
    emitSettlementGauges([], 'unknown');
    return { status: 'unknown', reason: `exception: ${String(err)}`, nowIso, windows: [], thresholds };
  }
}
