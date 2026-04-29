// ============================================================
// Kill Switch — Global emergency halt, daily loss auto-stop,
// exposure limits, persisted to Supabase (Cloud Run safe)
// AUDIT FIX T2.3: Replaced filesystem persistence with Supabase
// ============================================================
import { supabase, SUPABASE_CONFIGURED } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('KillSwitch');

export interface KillSwitchState {
  engaged: boolean;
  engagedAt: string | null;
  reason: string | null;
  autoEngaged: boolean;        // true if system activated it
  manualOverride: boolean;     // true if user manually set it
  dailyLossTriggered: boolean;
  maxExposureTriggered: boolean;
  velocityTriggered: boolean;  // Faza 9: rapid-spend detection
  // RUFLO FAZA 3 / F3 fix — Balance at moment of auto-engage.
  // Used by resetDailyTriggers() to gate auto-disengage behind equity recovery.
  // null => not-set (manual engage, legacy state, or snapshot failed).
  engagedEquitySnapshot: number | null;
}

// ─── Velocity Kill Switch — Faza 9 ────────────────
// Tracks recent trade timestamps and spend deltas.
// IF trades happen faster than threshold AND spend acceleration exceeds limit → TRIGGER
interface VelocityEntry {
  timestamp: number;
  spendPercent: number;       // cumulative spend as % of equity
}
const velocityWindow: VelocityEntry[] = [];

// Override via env to tune velocity gates without redeploy.
const VELOCITY_CONFIG = {
  windowMinutes: Number(process.env.KS_VELOCITY_WINDOW_MIN) || 15,
  maxTradesInWindow: Number(process.env.KS_VELOCITY_MAX_TRADES) || 8,
  maxSpendDeltaPercent: Number(process.env.KS_VELOCITY_MAX_SPEND_PCT) || 5,
} as const;

// ─── Global singleton ─────────────────────────────
const g = globalThis as unknown as { __killSwitch?: KillSwitchState; __killSwitchHydrated?: boolean };
if (!g.__killSwitch) {
  g.__killSwitch = defaultState();
}
const state = g.__killSwitch;

function defaultState(): KillSwitchState {
  return {
    engaged: false,
    engagedAt: null,
    reason: null,
    autoEngaged: false,
    manualOverride: false,
    dailyLossTriggered: false,
    maxExposureTriggered: false,
    velocityTriggered: false,
    engagedEquitySnapshot: null,
  };
}

// AUDIT FIX T2.3: Hydrate from Supabase on first use (async, non-blocking init)
async function hydrateFromSupabase(): Promise<void> {
  if (g.__killSwitchHydrated || !SUPABASE_CONFIGURED) return;
  g.__killSwitchHydrated = true;
  try {
    const { data } = await supabase
      .from('json_store')
      .select('data')
      .eq('id', 'kill_switch')
      .single();
    if (data?.data) {
      const remote = data.data as KillSwitchState;
      Object.assign(state, remote);
      log.info('Kill switch state hydrated from Supabase', { engaged: state.engaged });
    }
  } catch (err) {
    log.warn('Failed to hydrate kill switch from Supabase', { error: (err as Error).message });
  }
}

// Fire-and-forget hydration at module load
hydrateFromSupabase().catch(() => {});

async function persistState(): Promise<void> {
  if (!SUPABASE_CONFIGURED) {
    log.warn('Kill switch state NOT persisted — Supabase not configured');
    return;
  }
  const { error } = await supabase
    .from('json_store')
    .upsert({ id: 'kill_switch', data: { ...state }, updated_at: new Date().toISOString() });
  if (error) log.error('Failed to persist kill switch to Supabase', { error: error.message });
  else log.debug('Kill switch state persisted to Supabase');
}

// ─── Engage kill switch ─────────────────────────
export async function engageKillSwitch(reason: string, auto = false): Promise<void> {
  state.engaged = true;
  state.engagedAt = new Date().toISOString();
  state.reason = reason;
  state.autoEngaged = auto;
  state.manualOverride = !auto;

  // RUFLO FAZA 3 / F3 fix — Snapshot equity AT engagement time (auto only).
  // resetDailyTriggers() uses this as recovery threshold: auto-disengage ONLY if
  // current balance >= snapshot. Manual engage leaves snapshot=null (no gate).
  //
  // ASUMPȚIE: getEquityCurve() returns the most recent equity point. If curve is
  // empty (DB bootstrap / stale), snapshot=null → downstream check fails closed.
  if (auto) {
    try {
      const { getEquityCurve } = await import('@/lib/store/db');
      const curve = getEquityCurve();
      const last = curve.length > 0 ? curve[curve.length - 1] : null;
      state.engagedEquitySnapshot = last ? Number(last.balance) : null;
      log.info('[KillSwitch] Equity snapshot at auto-engage', { snapshot: state.engagedEquitySnapshot });
    } catch (err) {
      log.warn('[KillSwitch] Failed to snapshot equity on engage — fail-closed', { error: (err as Error).message });
      state.engagedEquitySnapshot = null;
    }
  } else {
    state.engagedEquitySnapshot = null;
  }

  await persistState();

  log.fatal(`KILL SWITCH ENGAGED: ${reason}`, { auto, reason });

  // RUFLO FAZA 3 / BATCH 8 / F9 fix (P1) — flash-crash hardening.
  //
  // BUG (pre-fix): sellAllAssetsToUsdt() runs market SELLs on `free` balance,
  // but `free` excludes quantity locked in open LIMIT / STOP_LOSS orders.
  // If we try to liquidate while SL orders are live, we sell only the
  // unlocked sliver and leave the rest exposed. Verify loop then ran at
  // 5min cadence — way too slow for a flash-crash context.
  //
  // FIX:
  //   1) Cancel-all-orders across every non-USDT symbol FIRST (emergency
  //      helper in mexcClient), unlocking balances before market-sell.
  //   2) Compress verify loop from 5min to 30s (maxAttempts kept at the
  //      same ~60min total).
  //
  // NOT IN SCOPE (honest — out of sniper edit):
  //   • Separate HTTP client with 3s timeout bypassing rate-limiter. Would
  //     need dedicated signing path; we'd be duplicating mexcClient. If
  //     live flash-crash proves the current mexcRequest rate-limiter
  //     stalls >3s on burst, spin up a separate HOT-PATH client as B8.5.
  //   • Exchange-side cancelAllAfter (dead-man's switch). MEXC SPOT API
  //     does NOT expose this (Binance has it, MEXC doesn't).
  //
  // Env rollback: KS_FLASH_GUARD_OFF=1 → legacy (no cancel-all, 5min poll).
  const flashGuardOff = process.env.KS_FLASH_GUARD_OFF === '1';

  if (!flashGuardOff) {
    try {
      const { cancelAllOpenOrdersEmergency } = await import('@/lib/exchange/mexcClient');
      const res = await cancelAllOpenOrdersEmergency();
      log.info(`[KILL SWITCH] Pre-liquidation cancel-all: cancelled=[${res.cancelled.join(',')}] failed=[${res.failed.join(',')}]`);
    } catch (err) {
      log.error('[KILL SWITCH] Pre-liquidation cancel-all threw — proceeding to market-sell anyway', { error: (err as Error).message });
    }
  }

  // CRITICAL: Actually close all positions on MEXC with retries and exponential backoff
  const { sellAllAssetsToUsdt } = await import('@/lib/exchange/mexcClient');
  const maxRetries = 3;
  const backoffMs = [1000, 2000, 4000];

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await sellAllAssetsToUsdt();
      log.info('KILL SWITCH: Liquidation successful');
      break;
    } catch (err) {
      lastError = err as Error;
      log.warn(`KILL SWITCH: Liquidation attempt ${attempt + 1}/${maxRetries} failed`, {
        error: lastError.message,
        nextRetryMs: backoffMs[attempt]
      });

      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoffMs[attempt]));
      }
    }
  }

  if (lastError) {
    log.fatal('KILL SWITCH: All liquidation retries exhausted — positions may still be open', {
      error: lastError.message
    });

    // RUFLO FAZA 3 / BATCH 8 — verify poll compressed from 5min → 30s.
    // Kill-switch: KS_FLASH_GUARD_OFF=1 → legacy 5min cadence.
    // Total verification window kept at ~60min via matching maxVerifyAttempts.
    let verifyAttempts = 0;
    const verifyInterval = flashGuardOff ? 5 * 60_000 : 30_000;
    const maxVerifyAttempts = flashGuardOff ? 12 : 120; // ~60 min either way

    const verifyLoop = setInterval(async () => {
      verifyAttempts++;
      try {
        const { getMexcOpenOrders } = await import('@/lib/exchange/mexcClient');
        const openPos = await getMexcOpenOrders();
        if (!openPos || openPos.length === 0) {
          log.info('KILL SWITCH VERIFICATION: All positions confirmed CLOSED on MEXC');
          clearInterval(verifyLoop);
          return;
        }
        const elapsedMin = (verifyAttempts * verifyInterval) / 60_000;
        log.warn(`[KILL SWITCH VERIFICATION] Still ${openPos.length} open position(s) on MEXC after ${elapsedMin.toFixed(1)}min`);
      } catch (err) {
        log.error(`[KILL SWITCH VERIFICATION] Query failed: ${(err as Error).message}`);
      }

      if (verifyAttempts >= maxVerifyAttempts) {
        clearInterval(verifyLoop);
        log.fatal('KILL SWITCH VERIFICATION: Timeout — Could not verify position closure after ~60 minutes. MANUAL INTERVENTION CRITICAL.');
      }
    }, verifyInterval);

    // Send Telegram alert about failed liquidation
    try {
      const { sendMessage } = await import('@/lib/alerts/telegram');
      await sendMessage(`🚨 *KILL SWITCH CRITICAL FAILURE*\nReason: ${reason}\nLiquidation FAILED after 3 retries.\nError: ${lastError.message}\nIMEDIATE MANUAL INTERVENTION REQUIRED\n\n[Verification Loop Running — checking MEXC every 5 min for position closure]`);
    } catch (err) {
      log.fatal('KILL SWITCH: Failed to send Telegram alert', { error: (err as Error).message });
    }
  }

  // Send Telegram alert for engagement
  try {
    const { sendMessage } = await import('@/lib/alerts/telegram');
    await sendMessage(`🚨 *KILL SWITCH ENGAGED*\nReason: ${reason}\nAuto: ${auto}\nAll positions being liquidated.`);
  } catch (err) {
    log.error('KILL SWITCH: Failed to send Telegram alert', { error: (err as Error).message });
  }
}

// ─── Disengage kill switch ──────────────────────
export async function disengageKillSwitch(): Promise<void> {
  state.engaged = false;
  state.engagedAt = null;
  state.reason = null;
  state.autoEngaged = false;
  state.manualOverride = false;
  state.dailyLossTriggered = false;
  state.maxExposureTriggered = false;
  state.engagedEquitySnapshot = null; // RUFLO FAZA 3 / F3 fix — clear snapshot on disengage
  await persistState();

  log.info('Kill switch disengaged');
}

// ─── Check if trading is allowed ────────────────
export function isKillSwitchEngaged(): boolean {
  return state.engaged;
}

// ─── Check daily loss limit ─────────────────────
// AUDIT FIX T3.1: Made async to await engageKillSwitch (liquidation must complete)
export async function checkDailyLossLimit(dailyLossPercent: number, limitPercent: number): Promise<boolean> {
  if (dailyLossPercent >= limitPercent && !state.dailyLossTriggered) {
    state.dailyLossTriggered = true;
    await engageKillSwitch(
      `Daily loss limit hit: ${dailyLossPercent.toFixed(1)}% >= ${limitPercent}% limit`,
      true
    );
    return true; // kill switch activated
  }
  return false;
}

// ─── Check total exposure limit ─────────────────
// AUDIT FIX T3.1: Made async to await engageKillSwitch
export async function checkExposureLimit(
  totalExposure: number,
  accountBalance: number,
  maxExposurePercent: number = Number(process.env.KS_MAX_EXPOSURE_PCT) || 30
): Promise<boolean> {
  const exposurePercent = (totalExposure / accountBalance) * 100;
  if (exposurePercent >= maxExposurePercent && !state.maxExposureTriggered) {
    state.maxExposureTriggered = true;
    await engageKillSwitch(
      `Exposure limit hit: ${exposurePercent.toFixed(1)}% >= ${maxExposurePercent}% of balance`,
      true
    );
    return true;
  }
  return false;
}

// ─── Velocity Kill Switch (Faza 9) ─────────────
/**
 * Track a new trade execution for velocity monitoring.
 * Call this AFTER every trade (live or phantom promoted to live).
 * @param spendPercent - this trade's size as % of equity
 * @returns true if velocity kill switch was triggered
 */
// AUDIT FIX T3.1: Made async to await engageKillSwitch
export async function trackTradeVelocity(spendPercent: number): Promise<boolean> {
  const now = Date.now();
  const cutoff = now - VELOCITY_CONFIG.windowMinutes * 60_000;

  // Add entry
  velocityWindow.push({ timestamp: now, spendPercent });

  // Prune old entries
  while (velocityWindow.length > 0 && velocityWindow[0].timestamp < cutoff) {
    velocityWindow.shift();
  }

  // Check trade frequency
  if (velocityWindow.length > VELOCITY_CONFIG.maxTradesInWindow) {
    state.velocityTriggered = true;
    await engageKillSwitch(
      `Velocity Kill Switch: ${velocityWindow.length} trades in ${VELOCITY_CONFIG.windowMinutes}min ` +
      `(limit: ${VELOCITY_CONFIG.maxTradesInWindow})`,
      true,
    );
    return true;
  }

  // Check cumulative spend delta
  const totalSpend = velocityWindow.reduce((s, e) => s + e.spendPercent, 0);
  if (totalSpend > VELOCITY_CONFIG.maxSpendDeltaPercent) {
    state.velocityTriggered = true;
    await engageKillSwitch(
      `Velocity Kill Switch: ${totalSpend.toFixed(2)}% spend in ${VELOCITY_CONFIG.windowMinutes}min ` +
      `(limit: ${VELOCITY_CONFIG.maxSpendDeltaPercent}%)`,
      true,
    );
    return true;
  }

  return false;
}

// ─── Get state ──────────────────────────────
export function getKillSwitchState(): KillSwitchState {
  return { ...state };
}

// ─── Reset daily triggers (call at start of new day) ─
export async function resetDailyTriggers(): Promise<void> {
  state.dailyLossTriggered = false;
  state.maxExposureTriggered = false;
  state.velocityTriggered = false;
  // SHIFT velocity window by 24h instead of clearing — carry metrics forward to prevent midnight attacks
  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60_000;
  while (velocityWindow.length > 0 && velocityWindow[0].timestamp < cutoff24h) {
    velocityWindow.shift();
  }
  if (state.autoEngaged && !state.manualOverride) {
    // RUFLO FAZA 3 / F3 fix — Equity-recovery gate.
    // Previously: new UTC day → auto-disengage unconditional (even mid-drawdown).
    // Now: disengage ONLY if current balance >= engagedEquitySnapshot (flat/up vs engage).
    //
    // Rollback: env KILL_SWITCH_AUTO_RECOVERY_OFF=1 → legacy unconditional behavior.
    //
    // ASUMPȚII care, dacă se rup, invalidează gate-ul:
    //   1) getEquityCurve() reflects REALIZED equity (not mid-trade mark-to-market).
    //      If curve is bootstrapped during DB cold-start, we may read stale value.
    //      Fail-closed: curve empty / snapshot null → deny auto-disengage, require manual.
    //   2) Snapshot taken at engagement time. If bot crashed pre-persist, snapshot=null → fail-closed.
    //   3) PAPER vs LIVE bifurcation NOT handled here — uses raw curve (all modes).
    //      Acceptable because kill-switch is mode-agnostic by design (blocks everything).
    const recoveryOff = process.env.KILL_SWITCH_AUTO_RECOVERY_OFF === '1';
    let canAutoDisengage = recoveryOff; // env override → legacy behavior

    if (!recoveryOff) {
      try {
        const { getEquityCurve } = await import('@/lib/store/db');
        const curve = getEquityCurve();
        const last = curve.length > 0 ? curve[curve.length - 1] : null;
        const current = last ? Number(last.balance) : null;
        const snapshot = state.engagedEquitySnapshot;

        if (current !== null && snapshot !== null && current >= snapshot) {
          canAutoDisengage = true;
          log.info('[KillSwitch] Equity recovered — auto-disengage permitted', { current, snapshot });
        } else {
          log.warn('[KillSwitch] Equity NOT recovered — auto-disengage DENIED, manual override required', {
            current, snapshot,
          });
        }
      } catch (err) {
        log.warn('[KillSwitch] Equity-recovery check failed — fail-closed (manual unlock required)', {
          error: (err as Error).message,
        });
      }
    }

    if (canAutoDisengage) {
      await disengageKillSwitch();
      log.info('Kill switch auto-disengaged on new day');
    }
  }
  await persistState();
}
