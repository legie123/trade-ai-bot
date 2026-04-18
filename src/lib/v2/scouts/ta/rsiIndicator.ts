// ============================================================
// RSI Indicator Module
// Calculates RSI (Relative Strength Index) with:
//   - Standard RSI(14) for momentum direction
//   - Divergence detection (bearish/bullish)
//   - Overbought/Oversold zones
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('RSI');

export interface RSIResult {
  rsi: number;
  zone: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' | 'BULLISH' | 'BEARISH';
  divergence: 'BULL_DIV' | 'BEAR_DIV' | 'NONE';
  confirmsSignal: boolean;   // Does RSI confirm the proposed signal?
  reason: string;
}

// ─── Classic RSI Calculation ────────────────────────
export function calcRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50; // Neutral if insufficient data

  // Calculate gains and losses
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Initial average gain/loss (SMA of first `period` values)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed RSI (Wilder's method)
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── Divergence Detection ───────────────────────────
function detectDivergence(closes: number[], rsiValues: number[]): 'BULL_DIV' | 'BEAR_DIV' | 'NONE' {
  if (closes.length < 30 || rsiValues.length < 30) return 'NONE';

  const len = closes.length;
  const recentPrice = closes[len - 1];
  // AUDIT FIX BUG-7: Increased lookback from 15 to 25 bars for more reliable divergence detection
  const lookback = 25;
  const prevPrice = closes[len - lookback];
  const recentRSI = rsiValues[rsiValues.length - 1];
  const prevRSI = rsiValues[rsiValues.length - lookback];

  // Bearish divergence: price makes higher high, but RSI makes lower high
  if (recentPrice > prevPrice && recentRSI < prevRSI && recentRSI > 60) {
    return 'BEAR_DIV';
  }

  // Bullish divergence: price makes lower low, but RSI makes higher low
  if (recentPrice < prevPrice && recentRSI > prevRSI && recentRSI < 40) {
    return 'BULL_DIV';
  }

  return 'NONE';
}

// ─── Full RSI Analysis ──────────────────────────────
export function analyzeRSI(
  closes: number[],
  proposedSignal: 'BUY' | 'SELL'
): RSIResult {
  const rsi = calcRSI(closes, 14);

  // Calculate RSI over time for divergence
  const rsiValues: number[] = [];
  for (let i = 20; i <= closes.length; i++) {
    rsiValues.push(calcRSI(closes.slice(0, i), 14));
  }

  const divergence = detectDivergence(closes, rsiValues);

  // Determine zone
  let zone: RSIResult['zone'];
  if (rsi >= 70) zone = 'OVERBOUGHT';
  else if (rsi <= 30) zone = 'OVERSOLD';
  else if (rsi > 55) zone = 'BULLISH';
  else if (rsi < 45) zone = 'BEARISH';
  else zone = 'NEUTRAL';

  // Confirmation logic
  let confirmsSignal = false;
  let reason = '';

  // FIX 2026-04-18: PAPER=LIVE parity. Unified RSI thresholds.
  const BUY_RSI_MIN = 45;
  const SELL_RSI_MAX = 55;
  const BUY_RSI_MAX = 70;

  if (proposedSignal === 'BUY') {
    if (rsi > BUY_RSI_MIN && rsi < BUY_RSI_MAX) {
      confirmsSignal = true;
      reason = `RSI ${Math.round(rsi)} — Bullish momentum, room to run`;
    } else if (rsi <= 30) {
      confirmsSignal = true;
      reason = `RSI ${Math.round(rsi)} — Oversold bounce potential`;
    } else if (rsi >= BUY_RSI_MAX) {
      confirmsSignal = false;
      reason = `RSI ${Math.round(rsi)} — OVERBOUGHT, BUY risky`;
    } else {
      confirmsSignal = false;
      reason = `RSI ${Math.round(rsi)} — Weak momentum for BUY`;
    }

    // Bearish divergence kills BUY
    if (divergence === 'BEAR_DIV') {
      confirmsSignal = false;
      reason = `RSI ${Math.round(rsi)} — BEARISH DIVERGENCE detected, reversal likely`;
    }
    // Bullish divergence confirms BUY
    if (divergence === 'BULL_DIV') {
      confirmsSignal = true;
      reason = `RSI ${Math.round(rsi)} — Bullish divergence, strong reversal signal`;
    }
  } else {
    // SELL confirmation
    if (rsi < SELL_RSI_MAX && rsi > 30) {
      confirmsSignal = true;
      reason = `RSI ${Math.round(rsi)} — Bearish momentum confirmed`;
    } else if (rsi >= 70) {
      confirmsSignal = true;
      reason = `RSI ${Math.round(rsi)} — Overbought, SELL confirmed`;
    } else if (rsi <= 30) {
      confirmsSignal = false;
      reason = `RSI ${Math.round(rsi)} — Already oversold, SELL risky`;
    } else {
      confirmsSignal = false;
      reason = `RSI ${Math.round(rsi)} — Momentum doesn't confirm SELL`;
    }

    if (divergence === 'BULL_DIV') {
      confirmsSignal = false;
      reason = `RSI ${Math.round(rsi)} — BULLISH DIVERGENCE, reversal likely`;
    }
    if (divergence === 'BEAR_DIV') {
      confirmsSignal = true;
      reason = `RSI ${Math.round(rsi)} — Bearish divergence, confirms sell`;
    }
  }

  log.info(`RSI analysis`, { rsi: Math.round(rsi), zone, divergence, proposedSignal, confirmsSignal });

  return {
    rsi: Math.round(rsi * 10) / 10,
    zone,
    divergence,
    confirmsSignal,
    reason,
  };
}
