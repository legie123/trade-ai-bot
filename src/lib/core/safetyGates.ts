/**
 * Safety Gates — C1 wiring layer (2026-04-18)
 *
 * ADDITIVE. Bridges killSwitch limit-checking functions (checkDailyLossLimit,
 * checkExposureLimit, trackTradeVelocity, resetDailyTriggers) into the real
 * execution path. Before this module existed the limits were DECORATIVE —
 * defined but never invoked anywhere → kill switch auto-engagement impossible.
 *
 * Three entry points:
 *   - runPreTradeGates()   — before opening LIVE position. Returns allow/deny.
 *   - onTradeExecuted()    — after addLivePosition succeeds. Feeds velocity.
 *   - ensureDailyReset()   — idempotent per-UTC-day reset of daily triggers.
 *
 * ASSUMPTIONS which, if broken, invalidate the guarantees:
 *   - getLivePositions() returns all currently OPEN positions (not closed).
 *   - equityHistory balance field is in the same currency as position.quantity*price.
 *   - Initial account balance seeds from config.paperBalance or env.
 *   - Trade "spendPercent" is computed as notional / accountBalance * 100.
 *   - A single UTC-day boundary defines "day" for daily-loss aggregation.
 *
 * Kill-switch: DISABLE_SAFETY_GATES=true
 */

import { createLogger } from '@/lib/core/logger';
import {
  checkDailyLossLimit,
  checkExposureLimit,
  trackTradeVelocity,
  resetDailyTriggers,
  isKillSwitchEngaged,
} from '@/lib/core/killSwitch';
import { getLivePositions, getEquityCurve, getBotConfig } from '@/lib/store/db';
// RUFLO FAZA 3 Batch 7 (H5) 2026-04-19: Circuit-breaker on price feeds.
import { areFeedsHealthy } from '@/lib/cache/priceCache';

const log = createLogger('SafetyGates');

const DISABLED = process.env.DISABLE_SAFETY_GATES === 'true';

// Defaults chosen conservatively. Override via env.
const DAILY_LOSS_LIMIT_PCT = parseFloat(process.env.KILL_SWITCH_DAILY_LOSS_PCT || '5'); // 5%
const MAX_EXPOSURE_PCT = parseFloat(process.env.KILL_SWITCH_MAX_EXPOSURE_PCT || '30'); // 30%

// RUFLO FAZA 3 Batch 6 (C6) 2026-04-19: Open-position count hard cap.
// WHY: Exposure gate enforces NOTIONAL but not COUNT. Operational limits
// (MEXC rate-limits per symbol, cognitive load on positionManager, diversification
// failure mode where 20 positions = 20 correlated bets on same regime) justify
// a hard count cap independent of notional. Default 5 matches auto-promote
// maxLiveGladiators * ~1.6 safety factor (LIVE gladiators × ~1.6 positions/each).
// Override via env; kill-switch via DISABLE_SAFETY_GATES or setting very high.
// ASUMPȚIE: LIVE-only gate. PAPER positions are excluded via !isPaperTrade.
const MAX_OPEN_POSITIONS = parseInt(process.env.MAX_OPEN_POSITIONS || '5', 10);

// Track last UTC day we reset triggers to make ensureDailyReset idempotent.
// Using module-local state (survives warm Cloud Run instance).
let lastResetUtcDay: string | null = null;

/**
 * Compute today's loss % relative to start-of-day balance, for a given mode.
 *
 * WHY parameterized:
 *   Original was LIVE-only (correct for enforce path — PAPER must never engage
 *   real kill switch). But for pre-LIVE dry-run simulation we need to run the
 *   same math on PAPER equity without triggering enforce. `computeDailyLossPercent()`
 *   stays LIVE-only for the real enforce path; the *ForMode variant is the
 *   observer-path helper.
 *
 * ASSUMPTION: equityCurve mode tagging ('PAPER'|'LIVE') is already written
 * consistently by appendToEquityCurve (AUDIT FIX CRITIC-8). If that tagging
 * drifts, the dry-run numbers are meaningless.
 */
export function computeDailyLossPercentForMode(mode: 'PAPER' | 'LIVE'): number {
  const curve = getEquityCurve(mode);
  if (curve.length < 2) return 0;

  const now = new Date();
  const startOfDayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const sodMs = startOfDayUtc.getTime();

  let startBalance: number | null = null;
  for (const p of curve) {
    const ts = new Date(p.timestamp).getTime();
    if (ts < sodMs) {
      startBalance = p.balance;
    } else {
      break;
    }
  }

  if (startBalance === null) {
    startBalance = curve[0].balance;
  }
  const currentBalance = curve[curve.length - 1].balance;

  if (!startBalance || startBalance <= 0) return 0;

  const deltaPct = ((currentBalance - startBalance) / startBalance) * 100;
  return deltaPct < 0 ? -deltaPct : 0;
}

/**
 * Compute today's LIVE loss % relative to start-of-day balance.
 * Uses equityHistory. Returns 0 if no data or only gains.
 * Positive return value = loss magnitude (e.g. 3.5 means -3.5% drawdown).
 *
 * NB: Always LIVE. For PAPER dry-run use computeDailyLossPercentForMode('PAPER').
 */
export function computeDailyLossPercent(): number {
  return computeDailyLossPercentForMode('LIVE');
}

/**
 * Sum of open LIVE position notional (quantity * entryPrice).
 * Returns { totalExposure, accountBalance } for killSwitch.checkExposureLimit.
 */
export function computeExposure(): { totalExposure: number; accountBalance: number } {
  const open = getLivePositions().filter(p => p.status === 'OPEN' && !p.isPaperTrade);
  const totalExposure = open.reduce((sum, p) => {
    const entry = p.entryPrice || 0;
    const qty = p.quantity || 0;
    return sum + Math.abs(qty * entry);
  }, 0);

  const cfg = getBotConfig();
  // Use latest LIVE equity balance if available, else config paperBalance as fallback.
  const curve = getEquityCurve('LIVE');
  const accountBalance = curve.length > 0 ? curve[curve.length - 1].balance : (cfg.paperBalance || 1000);

  return { totalExposure, accountBalance };
}

/**
 * Pre-trade gate. Call BEFORE opening a live position.
 *
 * Order of checks is intentional — cheapest and most-critical first:
 *   1. Kill switch already engaged → hard block (no exception)
 *   2. Daily loss limit → engage kill switch if breached
 *   3. Exposure limit → engage kill switch if breached
 *
 * @param newNotional - optional new trade notional (currency). If provided,
 *   exposure check includes it. If null, checks only existing exposure.
 * @returns { allowed, reason } — allowed=false → DO NOT OPEN the position.
 */
export async function runPreTradeGates(newNotional: number | null = null): Promise<{ allowed: boolean; reason?: string }> {
  if (DISABLED) return { allowed: true };

  // (0) Idempotent daily reset — must run before any daily-loss check, else
  // a lingering flag from yesterday blocks all of today's trades.
  await ensureDailyReset();

  // (1) Hard block if kill switch engaged
  if (isKillSwitchEngaged()) {
    return { allowed: false, reason: 'Kill switch already engaged' };
  }

  // (2) Daily loss
  const dailyLoss = computeDailyLossPercent();
  if (dailyLoss > 0) {
    const triggered = await checkDailyLossLimit(dailyLoss, DAILY_LOSS_LIMIT_PCT);
    if (triggered) {
      log.fatal(`[SafetyGate] Daily loss gate TRIGGERED kill switch: ${dailyLoss.toFixed(2)}%`);
      return { allowed: false, reason: `Daily loss ${dailyLoss.toFixed(2)}% ≥ ${DAILY_LOSS_LIMIT_PCT}% limit` };
    }
  }

  // (3) Exposure (includes the candidate trade if notional provided)
  const { totalExposure, accountBalance } = computeExposure();
  const projectedExposure = totalExposure + (newNotional || 0);
  const triggeredExp = await checkExposureLimit(projectedExposure, accountBalance, MAX_EXPOSURE_PCT);
  if (triggeredExp) {
    log.fatal(`[SafetyGate] Exposure gate TRIGGERED kill switch: ${projectedExposure}/${accountBalance}`);
    return { allowed: false, reason: `Exposure ${(projectedExposure / accountBalance * 100).toFixed(1)}% ≥ ${MAX_EXPOSURE_PCT}% limit` };
  }

  // (3b) RUFLO FAZA 3 Batch 7 (H5) 2026-04-19: Price-feed circuit-breaker.
  // If all 5 sources have been failing consecutively, we cannot price risk
  // correctly — entry price, SL/TP, exposure math are all uncertain. Refuse
  // new positions until feeds recover. Existing positions are NOT auto-closed
  // (positionManager tolerates stale prices by skipping evaluation).
  // Kill-switch: env DISABLE_FEED_CIRCUIT_BREAKER=1 (in priceCache.ts).
  const feedHealth = areFeedsHealthy();
  if (!feedHealth.healthy) {
    return {
      allowed: false,
      reason: `Price feeds degraded — ${feedHealth.reason}. Position entry blocked until recovery.`,
    };
  }

  // (4) RUFLO FAZA 3 Batch 6 (C6) 2026-04-19: Open-position count cap.
  // Denies new positions if we would exceed MAX_OPEN_POSITIONS (LIVE only).
  // DOES NOT engage kill switch — this is a soft block, not a catastrophic
  // fault. Caller simply skips this tick and retries when a slot frees up.
  const openLiveCount = getLivePositions().filter(p => p.status === 'OPEN' && !p.isPaperTrade).length;
  if (openLiveCount >= MAX_OPEN_POSITIONS) {
    return {
      allowed: false,
      reason: `Open-position cap reached: ${openLiveCount}/${MAX_OPEN_POSITIONS} — skip tick, wait for a close`,
    };
  }

  return { allowed: true };
}

/**
 * Post-trade hook. Call AFTER addLivePosition succeeds for a LIVE trade.
 * Feeds trackTradeVelocity (rapid-fire / spend-cluster detection).
 *
 * @param notional - trade notional in quote currency (entryPrice * quantity)
 */
export async function onTradeExecuted(notional: number): Promise<void> {
  if (DISABLED) return;

  const { accountBalance } = computeExposure();
  if (!accountBalance || accountBalance <= 0) return;

  const spendPercent = (notional / accountBalance) * 100;
  const triggered = await trackTradeVelocity(spendPercent);
  if (triggered) {
    log.fatal(`[SafetyGate] Velocity gate TRIGGERED kill switch: spendPct=${spendPercent.toFixed(2)}%`);
  }
}

/**
 * PAPER dry-run safety-gate observer.
 *
 * WHY this exists:
 *   runPreTradeGates() and the LIVE-only daily-loss watcher in cron never fire
 *   in PAPER because getEquityCurve('LIVE') returns empty. Before flipping
 *   TRADING_MODE=LIVE we need empirical evidence that:
 *     (a) PAPER equity curve has consistent mode tagging
 *     (b) computeDailyLossPercent math matches intuition on real data
 *     (c) threshold crossing is detected *before* real capital is at risk
 *
 *   This function runs the same math on PAPER equity and LOGS a "WOULD-TRIGGER"
 *   event when the limit is breached — never calls engageKillSwitch, never
 *   liquidates, never writes to Supabase kill-switch state. Zero operational
 *   impact in PAPER.
 *
 * WHY NOT just call the real path:
 *   killSwitch.engage() writes Supabase, triggers MEXC liquidation (no-op in
 *   PAPER but still attempts auth), and blocks all subsequent trades. A
 *   PAPER-mode accidental trigger would halt the paper validation run → we
 *   lose the observation window we're trying to build.
 *
 * ASSUMPTIONS (if any breaks, dry-run is misleading):
 *   - TRADING_MODE env is set to 'PAPER' when this runs. If LIVE, skip — real
 *     gates are authoritative.
 *   - SAFETY_GATES_PAPER_SIMULATE=true is explicitly set (default OFF, opt-in).
 *   - PAPER equity curve receives appendToEquityCurve ticks with mode:'PAPER'
 *     (verified in db.ts CRITIC-8 fix).
 *
 * Output: log lines tagged [SafetyGate:PAPER-SIM] for easy grep.
 */
export function monitorPaperSafetyGates(): void {
  // Opt-in only — default OFF so the observer never surprises anyone.
  if (process.env.SAFETY_GATES_PAPER_SIMULATE !== 'true') return;

  // If actually LIVE, skip — real path handles it.
  const mode = (process.env.TRADING_MODE || 'PAPER').toUpperCase();
  if (mode === 'LIVE') return;

  try {
    const paperLoss = computeDailyLossPercentForMode('PAPER');
    if (paperLoss <= 0) return;

    // Use same threshold as real path so simulation is directly comparable.
    if (paperLoss >= DAILY_LOSS_LIMIT_PCT) {
      log.warn(
        `[SafetyGate:PAPER-SIM] WOULD-TRIGGER daily-loss kill switch: ` +
        `paperLoss=${paperLoss.toFixed(2)}% >= limit=${DAILY_LOSS_LIMIT_PCT}% ` +
        `(observer only — no engage, no liquidate)`
      );
    } else if (paperLoss >= DAILY_LOSS_LIMIT_PCT * 0.7) {
      // Early-warning band: 70% of limit → surfaces trend before breach
      log.info(
        `[SafetyGate:PAPER-SIM] approaching daily-loss threshold: ` +
        `paperLoss=${paperLoss.toFixed(2)}% (${((paperLoss / DAILY_LOSS_LIMIT_PCT) * 100).toFixed(0)}% of ${DAILY_LOSS_LIMIT_PCT}% limit)`
      );
    }
  } catch (err) {
    // Observer must NEVER throw — it is instrumentation, not control flow.
    log.warn('[SafetyGate:PAPER-SIM] observer error (ignored)', { error: (err as Error).message });
  }
}

/**
 * Idempotent per-UTC-day reset. Safe to call every cron tick.
 * Resets dailyLossTriggered/maxExposureTriggered/velocityTriggered flags
 * at the UTC day boundary so yesterday's trigger doesn't block today.
 */
export async function ensureDailyReset(): Promise<void> {
  if (DISABLED) return;

  const now = new Date();
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  if (lastResetUtcDay === today) return; // already reset today

  // First call of a new UTC day → reset
  try {
    await resetDailyTriggers();
    lastResetUtcDay = today;
    log.info(`[SafetyGate] Daily triggers reset for UTC day ${today}`);
  } catch (err) {
    log.warn('[SafetyGate] resetDailyTriggers failed', { error: (err as Error).message });
  }
}
