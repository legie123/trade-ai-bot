/**
 * FAZA 3.13 — Polymarket Edge Watchdog (shadow mode).
 *
 * Closes the L5 observation → action loop. Reads realized edge from
 * learningLoop.buildWeeklyReport() OVERALL SettlementStats and classifies
 * the brain's realized profitability as UNKNOWN / HEALTHY / DEGRADED /
 * UNHEALTHY. In shadow mode (EDGE_WATCHDOG_ENFORCE=0) only surfaces the
 * verdict for UI + counters. In enforce mode (=1) the verdict can be
 * consumed by bet-gate code to block phantom/real bets on UNHEALTHY.
 *
 * CONTRACT:
 *   - Pure, cached, soft-fail. Never throws.
 *   - Returns UNKNOWN if disabled, on error, or sample < N_MIN.
 *   - 60s in-memory cache to avoid thrashing learningLoop on bet bursts.
 *
 * ENV (all optional, defaults given):
 *   EDGE_WATCHDOG_ENABLED       (default '1') — module on/off
 *   EDGE_WATCHDOG_ENFORCE       (default '0') — gate bets on UNHEALTHY
 *   EDGE_WATCHDOG_N_MIN         (default '10') — min nDecisive to trust
 *   EDGE_WATCHDOG_PF_UNHEALTHY  (default '0.9') — PF below → UNHEALTHY
 *   EDGE_WATCHDOG_PF_DEGRADED   (default '1.1') — PF below → DEGRADED
 *   EDGE_WATCHDOG_WR_HARD_FLOOR (default '0.40') — WR below + n>=30 → force UNHEALTHY
 *   EDGE_WATCHDOG_CACHE_MS      (default '60000') — verdict cache TTL
 *
 * KILL-SWITCH:
 *   EDGE_WATCHDOG_ENABLED=0 → getEdgeWatchdogState returns {enabled:false}
 *   EDGE_WATCHDOG_ENFORCE=0 → classifyCanBet always returns true (shadow)
 */
import { buildWeeklyReport, SettlementStats } from './learningLoop';

export type EdgeVerdict = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface EdgeWatchdogThresholds {
  nMin: number;
  pfUnhealthy: number;
  pfDegraded: number;
  wrHardFloor: number;
}

export interface EdgeWatchdogState {
  enabled: boolean;                        // EDGE_WATCHDOG_ENABLED !== '0'
  enforce: boolean;                        // EDGE_WATCHDOG_ENFORCE === '1'
  verdict: EdgeVerdict;
  reasons: string[];                       // human-readable explanations
  stats: SettlementStats | null;           // OVERALL row, or null if missing
  thresholds: EdgeWatchdogThresholds;
  windowDays: number | null;
  learningEnabled: boolean;                // POLY_LEARNING_ENABLED pass-through
  checkedAt: string;                       // ISO
  cacheHit: boolean;
  shadowBlockCount: number;                // cumulative process-local counter
  errorMsg: string | null;
}

/** Shadow counter — increments every call where verdict=UNHEALTHY and we're NOT enforcing. */
let shadowBlockCount = 0;

let cache: { state: EdgeWatchdogState; expiresAt: number } | null = null;

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getThresholds(): EdgeWatchdogThresholds {
  return {
    nMin: envInt('EDGE_WATCHDOG_N_MIN', 10),
    pfUnhealthy: envFloat('EDGE_WATCHDOG_PF_UNHEALTHY', 0.9),
    pfDegraded: envFloat('EDGE_WATCHDOG_PF_DEGRADED', 1.1),
    wrHardFloor: envFloat('EDGE_WATCHDOG_WR_HARD_FLOOR', 0.40),
  };
}

/**
 * Classify a SettlementStats row into a verdict. Pure, no I/O.
 * Exported for unit tests + /api/v2/polymarket/edge-health.
 */
export function classifyEdge(
  stats: SettlementStats | null,
  th: EdgeWatchdogThresholds,
): { verdict: EdgeVerdict; reasons: string[] } {
  const reasons: string[] = [];
  if (!stats || stats.nSettled === 0) {
    return { verdict: 'UNKNOWN', reasons: ['no settled rows'] };
  }
  if (stats.nDecisive < th.nMin) {
    reasons.push(`nDecisive=${stats.nDecisive} < N_MIN=${th.nMin} (noise regime)`);
    return { verdict: 'UNKNOWN', reasons };
  }

  // Hard WR floor only activates with enough statistical power (n>=30).
  if (
    stats.nDecisive >= 30 &&
    stats.winRate != null &&
    stats.winRate < th.wrHardFloor
  ) {
    reasons.push(
      `WR ${(stats.winRate * 100).toFixed(1)}% < hard floor ${(th.wrHardFloor * 100).toFixed(0)}% on n=${stats.nDecisive}`,
    );
    return { verdict: 'UNHEALTHY', reasons };
  }

  // null PF = no losing rows at all in window. Treat as HEALTHY only if we
  // also have at least N_MIN wins and totalPnlUsd > 0.
  if (stats.profitFactor == null) {
    if (stats.wins >= th.nMin && stats.totalPnlUsd > 0) {
      reasons.push('no losses in window + positive PnL');
      return { verdict: 'HEALTHY', reasons };
    }
    reasons.push('null PF (no losses) + insufficient wins');
    return { verdict: 'UNKNOWN', reasons };
  }

  if (stats.profitFactor < th.pfUnhealthy) {
    reasons.push(
      `PF ${stats.profitFactor.toFixed(2)} < unhealthy threshold ${th.pfUnhealthy.toFixed(2)}`,
    );
    return { verdict: 'UNHEALTHY', reasons };
  }
  if (stats.profitFactor < th.pfDegraded) {
    reasons.push(
      `PF ${stats.profitFactor.toFixed(2)} in degraded band [${th.pfUnhealthy.toFixed(2)}, ${th.pfDegraded.toFixed(2)})`,
    );
    return { verdict: 'DEGRADED', reasons };
  }
  reasons.push(`PF ${stats.profitFactor.toFixed(2)} ≥ degraded threshold ${th.pfDegraded.toFixed(2)}`);
  return { verdict: 'HEALTHY', reasons };
}

/**
 * Get current watchdog state. Cached for EDGE_WATCHDOG_CACHE_MS (60s default).
 * Soft-fail: errors collapse to verdict=UNKNOWN with errorMsg populated.
 */
export async function getEdgeWatchdogState(): Promise<EdgeWatchdogState> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return { ...cache.state, cacheHit: true, shadowBlockCount };
  }

  const enabled = (process.env.EDGE_WATCHDOG_ENABLED ?? '1') !== '0';
  const enforce = process.env.EDGE_WATCHDOG_ENFORCE === '1';
  const thresholds = getThresholds();

  if (!enabled) {
    const state: EdgeWatchdogState = {
      enabled: false,
      enforce,
      verdict: 'UNKNOWN',
      reasons: ['EDGE_WATCHDOG_ENABLED=0'],
      stats: null,
      thresholds,
      windowDays: null,
      learningEnabled: (process.env.POLY_LEARNING_ENABLED ?? '1') !== '0',
      checkedAt: new Date().toISOString(),
      cacheHit: false,
      shadowBlockCount,
      errorMsg: null,
    };
    cache = { state, expiresAt: now + envInt('EDGE_WATCHDOG_CACHE_MS', 60_000) };
    return state;
  }

  let state: EdgeWatchdogState;
  try {
    const report = await buildWeeklyReport();
    const overall = report.settlementStats.find((s) => s.scope === 'OVERALL') ?? null;
    const { verdict, reasons } = classifyEdge(overall, thresholds);
    if (verdict === 'UNHEALTHY' && !enforce) shadowBlockCount++;
    state = {
      enabled: true,
      enforce,
      verdict,
      reasons,
      stats: overall,
      thresholds,
      windowDays: report.windowDays,
      learningEnabled: report.enabled,
      checkedAt: new Date().toISOString(),
      cacheHit: false,
      shadowBlockCount,
      errorMsg: null,
    };
  } catch (err) {
    state = {
      enabled: true,
      enforce,
      verdict: 'UNKNOWN',
      reasons: ['learningLoop error'],
      stats: null,
      thresholds,
      windowDays: null,
      learningEnabled: (process.env.POLY_LEARNING_ENABLED ?? '1') !== '0',
      checkedAt: new Date().toISOString(),
      cacheHit: false,
      shadowBlockCount,
      errorMsg: err instanceof Error ? err.message : 'unknown',
    };
  }

  cache = { state, expiresAt: now + envInt('EDGE_WATCHDOG_CACHE_MS', 60_000) };
  return state;
}

/**
 * Bet-path integration helper. Returns true if bet should proceed.
 *   - enforce=0 → always true (shadow mode, for counters only)
 *   - enforce=1 + verdict=UNHEALTHY → false (bet blocked)
 *   - any other verdict → true
 *
 * Callers should log the returned `blocked` state for audit attribution.
 */
export async function canPlaceBet(): Promise<{ allowed: boolean; verdict: EdgeVerdict; reason: string }> {
  const st = await getEdgeWatchdogState();
  if (!st.enabled) return { allowed: true, verdict: st.verdict, reason: 'watchdog disabled' };
  if (!st.enforce) return { allowed: true, verdict: st.verdict, reason: 'shadow mode' };
  if (st.verdict === 'UNHEALTHY') {
    return { allowed: false, verdict: st.verdict, reason: st.reasons.join('; ') || 'unhealthy' };
  }
  return { allowed: true, verdict: st.verdict, reason: `verdict=${st.verdict}` };
}

/** Test hook — reset the cache + counters. Not exported to production paths. */
export function __resetEdgeWatchdogForTests(): void {
  cache = null;
  shadowBlockCount = 0;
}
