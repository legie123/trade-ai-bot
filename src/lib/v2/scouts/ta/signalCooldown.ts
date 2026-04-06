// ============================================================
// Signal Cooldown Manager
// Prevents duplicate signals on the same symbol within a time window.
// Calibration #1: BTC was generating BUY every 2 min → now 30 min minimum
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Cooldown');

// ─── Cooldown Config per Asset Category ────────────
const COOLDOWN_MS: Record<string, number> = {
  BTC:     30 * 60_000,   // 30 min — BTC moves slowly, no spam
  ETH:     20 * 60_000,   // 20 min
  SOL:     15 * 60_000,   // 15 min
  DEFAULT: 10 * 60_000,   // 10 min for altcoins
};

// ─── In-memory cooldown tracker ────────────────────
// Key: "SYMBOL:DIRECTION" → last signal timestamp
const cooldowns: Map<string, number> = new Map();

/**
 * Check if a signal is allowed (not in cooldown).
 * Returns true if signal can proceed, false if it should be blocked.
 */
export function isSignalAllowed(symbol: string, direction: string): boolean {
  const key = `${symbol.toUpperCase()}:${direction.toUpperCase()}`;
  const now = Date.now();
  const lastSignal = cooldowns.get(key);
  const cooldownMs = COOLDOWN_MS[symbol.toUpperCase()] || COOLDOWN_MS.DEFAULT;

  if (lastSignal && (now - lastSignal) < cooldownMs) {
    const remainingSec = Math.round((cooldownMs - (now - lastSignal)) / 1000);
    log.info(`COOLDOWN BLOCKED: ${key} — ${remainingSec}s remaining`);
    return false;
  }

  return true;
}

/**
 * Record that a signal was just emitted for this symbol+direction.
 */
export function recordSignal(symbol: string, direction: string): void {
  const key = `${symbol.toUpperCase()}:${direction.toUpperCase()}`;
  cooldowns.set(key, Date.now());
  log.info(`COOLDOWN SET: ${key} for ${(COOLDOWN_MS[symbol.toUpperCase()] || COOLDOWN_MS.DEFAULT) / 60000}min`);
}

/**
 * Combined: check + record if allowed.
 * Returns true if signal was allowed and recorded.
 */
export function trySignal(symbol: string, direction: string): boolean {
  if (!isSignalAllowed(symbol, direction)) return false;
  recordSignal(symbol, direction);
  return true;
}

/**
 * Get current cooldown status for monitoring.
 */
export function getCooldownStatus(): Record<string, number> {
  const now = Date.now();
  const status: Record<string, number> = {};
  for (const [key, ts] of cooldowns.entries()) {
    const remaining = Math.max(0, Math.round((ts + (COOLDOWN_MS.DEFAULT) - now) / 1000));
    if (remaining > 0) status[key] = remaining;
  }
  return status;
}
