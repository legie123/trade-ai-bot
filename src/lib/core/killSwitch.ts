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
}

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

    // Send Telegram alert about failed liquidation
    try {
      const { sendMessage } = await import('@/lib/alerts/telegram');
      await sendMessage(`🚨 *KILL SWITCH CRITICAL FAILURE*\nReason: ${reason}\nLiquidation FAILED after 3 retries.\nError: ${lastError.message}\nIMEDIATE MANUAL INTERVENTION REQUIRED`);
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

// ─── Get state ──────────────────────────────────────
export function getKillSwitchState(): KillSwitchState {
  return { ...state };
}

// ─── Reset daily triggers (call at start of new day) ─
export function resetDailyTriggers(): void {
  state.dailyLossTriggered = false;
  state.maxExposureTriggered = false;
  if (state.autoEngaged && !state.manualOverride) {
    disengageKillSwitch();
    log.info('Kill switch auto-disengaged on new day');
  }
  saveToDisk();
}
