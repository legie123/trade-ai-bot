/**
 * FAZA 7c (2026-04-20) — SHORT LIVE conditional gate infrastructure.
 *
 * CONTEXT — validated in FAZA 5/6 (ledger post-cutoff 2026-04-19T17:45Z):
 *   • SHORT GROSS EV +0.1609% (t=+6.84) — real directional edge.
 *   • SHORT NET EV  +0.0209% (t=+0.89, p=0.37) — indistinguishable from zero after fees.
 *   • Stratified: session=OFF (UTC 21-23) EV_net +0.347% t=+10.74 (survives Bonferroni α=0.002).
 *                 session=ASIA (UTC 0-7)  EV_net -0.531% t=-32.0 (anti-edge).
 *                 symbol=SOL              EV_net +0.130% t=+4.80 (survives).
 *                 symbol=PYTH             EV_net -0.204% t=-5.02 (anti-edge).
 *
 * This file ONLY provides the decision helper + UTC session bucketer. It does NOT
 * wire into any path on its own — enabling happens exclusively at the call site
 * (dualMaster.arbitrate) and is guarded by SHORT_LIVE_GATE_ENABLED.
 *
 * ASSUMPTIONS THAT INVALIDATE THIS GATE IF BROKEN:
 *   (A1) UTC session buckets (ASIA 0-7, LONDON 8-12, NEWYORK 13-20, OFF 21-23) track
 *        real liquidity regimes. If BTC venue open/close schedules shift, buckets drift.
 *   (A2) In-sample OFF/SOL edge persists out-of-sample (≥3d holdout). Default SHADOW
 *        mode exists precisely to collect that holdout before enforcing.
 *   (A3) DIRECTION_LONG_DISABLED remains active — this gate is SHORT-only scope.
 *
 * KILL-SWITCHES (all reversible without redeploy, via Cloud Run env edit):
 *   SHORT_LIVE_GATE_ENABLED=0          → helper returns {admit:true, reason:'gate_off'} always
 *   SHORT_LIVE_GATE_SHADOW=1 (default) → classifies + counts, but admit stays true (no enforcement)
 *   SHORT_LIVE_GATE_SHADOW=0           → enforcement mode (admit reflects whitelist outcome)
 *   SHORT_LIVE_ALLOWED_SESSIONS=""     → empty list = no session filter (vacuous pass when enabled)
 *   SHORT_LIVE_ALLOWED_SYMBOLS=""      → empty list = no symbol filter
 *
 * RAIL: DIRECTION_SHORT_DISABLED=1 (pre-existing global kill) short-circuits upstream
 * and this gate never runs — acceptable, global kill is strictly stronger.
 */

import { metrics, safeInc } from '@/lib/observability/metrics';

export type TradingSession = 'ASIA' | 'LONDON' | 'NEWYORK' | 'OFF';

export interface ShortGateConfig {
  enabled: boolean;
  shadow: boolean;
  allowedSessions: TradingSession[];
  allowedSymbols: string[];
}

export interface ShortGateDecision {
  admit: boolean;
  reason:
    | 'gate_off'
    | 'session_block'
    | 'symbol_block'
    | 'passed'
    | 'shadow_would_block_session'
    | 'shadow_would_block_symbol';
  session: TradingSession;
  symbol: string;
  shadow: boolean;
}

/**
 * UTC hour → trading session bucket.
 * ASSUMPTION (A1): boundaries below match the empirical stratification in FAZA 6.
 * If changed, re-derive edges before rolling out.
 */
export function getSessionUTC(ts: number | Date = Date.now()): TradingSession {
  const h = (ts instanceof Date ? ts : new Date(ts)).getUTCHours();
  if (h >= 0 && h <= 7) return 'ASIA';
  if (h >= 8 && h <= 12) return 'LONDON';
  if (h >= 13 && h <= 20) return 'NEWYORK';
  return 'OFF';
}

/**
 * Reads env at call time (not at module load) so kill-switches flip without redeploy.
 */
export function readShortGateConfig(): ShortGateConfig {
  const parseList = (raw: string | undefined): string[] =>
    (raw || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

  return {
    enabled: process.env.SHORT_LIVE_GATE_ENABLED === '1',
    // Shadow defaults TRUE — explicit opt-in to enforcement via SHORT_LIVE_GATE_SHADOW=0
    shadow: process.env.SHORT_LIVE_GATE_SHADOW !== '0',
    allowedSessions: parseList(process.env.SHORT_LIVE_ALLOWED_SESSIONS) as TradingSession[],
    allowedSymbols: parseList(process.env.SHORT_LIVE_ALLOWED_SYMBOLS),
  };
}

/**
 * Pure decision function — call site owns the action (FLAT rewrite, log, etc.).
 * Increments Prometheus counters as a side-effect; the return value is the truth.
 *
 * Behavior matrix (enabled=true):
 *                   | session miss | symbol miss  | both pass
 *   shadow=true     | admit=true   | admit=true   | admit=true
 *                   | counter+shadow_would_block_*
 *   shadow=false    | admit=false  | admit=false  | admit=true
 *                   | counter+block reason
 */
export function shouldAdmitShortLive(
  symbolRaw: string | undefined,
  ts: number | Date = Date.now(),
  cfg: ShortGateConfig = readShortGateConfig(),
): ShortGateDecision {
  const symbol = (symbolRaw || 'UNKNOWN').toUpperCase();
  const session = getSessionUTC(ts);

  if (!cfg.enabled) {
    return { admit: true, reason: 'gate_off', session, symbol, shadow: cfg.shadow };
  }

  const sessionBlock = cfg.allowedSessions.length > 0 && !cfg.allowedSessions.includes(session);
  const symbolBlock = cfg.allowedSymbols.length > 0 && !cfg.allowedSymbols.includes(symbol);

  if (sessionBlock) {
    safeInc(metrics.shortLiveGateBlocked, {
      reason: cfg.shadow ? 'shadow_session' : 'session',
      session,
      symbol,
    });
    return {
      admit: cfg.shadow ? true : false,
      reason: cfg.shadow ? 'shadow_would_block_session' : 'session_block',
      session,
      symbol,
      shadow: cfg.shadow,
    };
  }

  if (symbolBlock) {
    safeInc(metrics.shortLiveGateBlocked, {
      reason: cfg.shadow ? 'shadow_symbol' : 'symbol',
      session,
      symbol,
    });
    return {
      admit: cfg.shadow ? true : false,
      reason: cfg.shadow ? 'shadow_would_block_symbol' : 'symbol_block',
      session,
      symbol,
      shadow: cfg.shadow,
    };
  }

  safeInc(metrics.shortLiveGateAdmitted, { session, symbol });
  return { admit: true, reason: 'passed', session, symbol, shadow: cfg.shadow };
}
