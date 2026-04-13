// ============================================================
// Kill Switch — Global emergency halt, daily loss auto-stop,
// exposure limits, persisted to disk
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('KillSwitch');

const DATA_DIR = path.join(process.cwd(), 'data');
const KILL_SWITCH_FILE = path.join(DATA_DIR, 'kill-switch.json');

export interface KillSwitchState {
  engaged: boolean;
  engagedAt: string | null;
  reason: string | null;
  autoEngaged: boolean;        // true if system activated it
  manualOverride: boolean;     // true if user manually set it
  dailyLossTriggered: boolean;
  maxExposureTriggered: boolean;
  velocityTriggered: boolean;  // Faza 9: rapid-spend detection
}

// ─── Velocity Kill Switch — Faza 9 ────────────────
// Tracks recent trade timestamps and spend deltas.
// IF trades happen faster than threshold AND spend acceleration exceeds limit → TRIGGER
interface VelocityEntry {
  timestamp: number;
  spendPercent: number;       // cumulative spend as % of equity
}
const velocityWindow: VelocityEntry[] = [];

const VELOCITY_CONFIG = {
  windowMinutes: 15,          // Look-back window
  maxTradesInWindow: 8,       // Max trades allowed in window
  maxSpendDeltaPercent: 5,    // Max cumulative spend in window
} as const;

// ─── Global singleton ───────────────────────────────
const g = globalThis as unknown as { __killSwitch?: KillSwitchState };
if (!g.__killSwitch) {
  // Try to load from disk
  g.__killSwitch = loadFromDisk();
}
const state = g.__killSwitch;

function loadFromDisk(): KillSwitchState {
  try {
    if (fs.existsSync(KILL_SWITCH_FILE)) {
      const raw = fs.readFileSync(KILL_SWITCH_FILE, 'utf-8');
      return JSON.parse(raw) as KillSwitchState;
    }
  } catch {
    log.warn('Failed to load kill switch state from disk');
  }
  return {
    engaged: false,
    engagedAt: null,
    reason: null,
    autoEngaged: false,
    manualOverride: false,
    dailyLossTriggered: false,
    maxExposureTriggered: false,
    velocityTriggered: false,
  };
}

function saveToDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(KILL_SWITCH_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    log.error('Failed to persist kill switch state', { error: (err as Error).message });
  }
}

// ─── Engage kill switch ─────────────────────────────
export async function engageKillSwitch(reason: string, auto = false): Promise<void> {
  state.engaged = true;
  state.engagedAt = new Date().toISOString();
  state.reason = reason;
  state.autoEngaged = auto;
  state.manualOverride = !auto;
  saveToDisk();

  log.fatal(`KILL SWITCH ENGAGED: ${reason}`, { auto, reason });

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

    // VERIFICATION LOOP: Query MEXC every 5min to confirm positions are actually closed
    let isVerified = false;
    let verifyAttempts = 0;
    const maxVerifyAttempts = 12; // 60 minutes total
    const verifyInterval = 5 * 60_000; // 5 minutes

    const verifyLoop = setInterval(async () => {
      verifyAttempts++;
      try {
        const { getMexcOpenOrders } = await import('@/lib/exchange/mexcClient');
        const openPos = await getMexcOpenOrders();
        if (!openPos || openPos.length === 0) {
          log.info('KILL SWITCH VERIFICATION: All positions confirmed CLOSED on MEXC');
          isVerified = true;
          clearInterval(verifyLoop);
        } else {
          log.warn(`[KILL SWITCH VERIFICATION] Still ${openPos.length} open position(s) on MEXC after ${verifyAttempts * 5}min`);
        }
      } catch (err) {
        log.error(`[KILL SWITCH VERIFICATION] Query failed: ${(err as Error).message}`);
      }

      if (verifyAttempts >= maxVerifyAttempts) {
        clearInterval(verifyLoop);
        log.fatal('KILL SWITCH VERIFICATION: Timeout — Could not verify position closure after 60 minutes. MANUAL INTERVENTION CRITICAL.');
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

// ─── Disengage kill switch ──────────────────────────
export function disengageKillSwitch(): void {
  state.engaged = false;
  state.engagedAt = null;
  state.reason = null;
  state.autoEngaged = false;
  state.manualOverride = false;
  state.dailyLossTriggered = false;
  state.maxExposureTriggered = false;
  saveToDisk();

  log.info('Kill switch disengaged');
}

// ─── Check if trading is allowed ────────────────────
export function isKillSwitchEngaged(): boolean {
  return state.engaged;
}

// ─── Check daily loss limit ─────────────────────────
export function checkDailyLossLimit(dailyLossPercent: number, limitPercent: number): boolean {
  if (dailyLossPercent >= limitPercent && !state.dailyLossTriggered) {
    state.dailyLossTriggered = true;
    engageKillSwitch(
      `Daily loss limit hit: ${dailyLossPercent.toFixed(1)}% >= ${limitPercent}% limit`,
      true
    );
    return true; // kill switch activated
  }
  return false;
}

// ─── Check total exposure limit ─────────────────────
export function checkExposureLimit(
  totalExposure: number,
  accountBalance: number,
  maxExposurePercent: number = 30
): boolean {
  const exposurePercent = (totalExposure / accountBalance) * 100;
  if (exposurePercent >= maxExposurePercent && !state.maxExposureTriggered) {
    state.maxExposureTriggered = true;
    engageKillSwitch(
      `Exposure limit hit: ${exposurePercent.toFixed(1)}% >= ${maxExposurePercent}% of balance`,
      true
    );
    return true;
  }
  return false;
}

// ─── Velocity Kill Switch (Faza 9) ─────────────────
/**
 * Track a new trade execution for velocity monitoring.
 * Call this AFTER every trade (live or phantom promoted to live).
 * @param spendPercent - this trade's size as % of equity
 * @returns true if velocity kill switch was triggered
 */
export function trackTradeVelocity(spendPercent: number): boolean {
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
    engageKillSwitch(
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
    engageKillSwitch(
      `Velocity Kill Switch: ${totalSpend.toFixed(2)}% spend in ${VELOCITY_CONFIG.windowMinutes}min ` +
      `(limit: ${VELOCITY_CONFIG.maxSpendDeltaPercent}%)`,
      true,
    );
    return true;
  }

  return false;
}

// ─── Get state ──────────────────────────────────────
export function getKillSwitchState(): KillSwitchState {
  return { ...state };
}

// ─── Reset daily triggers (call at start of new day) ─
export function resetDailyTriggers(): void {
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
    disengageKillSwitch();
    log.info('Kill switch auto-disengaged on new day');
  }
  saveToDisk();
}
