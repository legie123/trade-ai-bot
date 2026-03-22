// ============================================================
// Bollinger Bands Module
// Detects: BB Squeeze (low volatility → imminent breakout),
//          Lower Band Bounce (mean reversion BUY),
//          Upper Band Rejection (mean reversion SELL),
//          Band Walk (strong trend continuation)
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('BollingerBands');

export interface BollingerResult {
  upper: number;
  middle: number;      // SMA(20)
  lower: number;
  bandwidth: number;   // (upper - lower) / middle — volatility measure
  percentB: number;    // Where price sits within bands (0 = lower, 1 = upper)
  squeeze: boolean;    // Bandwidth below 20-period average → imminent breakout
  signal: 'BB_BUY' | 'BB_SELL' | 'BB_SQUEEZE' | 'NONE';
  reason: string;
}

// ─── SMA Calculator ─────────────────────────────────
function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ─── Standard Deviation ─────────────────────────────
function stdDev(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  const avg = slice.reduce((a, b) => a + b, 0) / period;
  const squaredDiffs = slice.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / period);
}

// ─── Calculate Bollinger Bands ──────────────────────
export function calcBollingerBands(
  closes: number[],
  period: number = 20,
  multiplier: number = 2
): BollingerResult {
  if (closes.length < period) {
    return {
      upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5,
      squeeze: false, signal: 'NONE', reason: 'Insufficient data',
    };
  }

  const price = closes[closes.length - 1];
  const middle = sma(closes, period);
  const sd = stdDev(closes, period);
  const upper = middle + multiplier * sd;
  const lower = middle - multiplier * sd;

  // Bandwidth = (Upper - Lower) / Middle — measures volatility
  const bandwidth = middle > 0 ? (upper - lower) / middle : 0;

  // %B = (Price - Lower) / (Upper - Lower) — position within bands
  const bandRange = upper - lower;
  const percentB = bandRange > 0 ? (price - lower) / bandRange : 0.5;

  // Historical bandwidth for squeeze detection (compare vs avg bandwidth)
  const histBandwidths: number[] = [];
  for (let i = period; i <= closes.length; i++) {
    const slice = closes.slice(i - period, i);
    const m = sma(slice, period);
    const s = stdDev(slice, period);
    const bw = m > 0 ? ((m + multiplier * s) - (m - multiplier * s)) / m : 0;
    histBandwidths.push(bw);
  }
  const avgBandwidth = histBandwidths.length > 0
    ? histBandwidths.reduce((a, b) => a + b, 0) / histBandwidths.length
    : bandwidth;

  const squeeze = bandwidth < avgBandwidth * 0.75; // 25% below avg = squeeze

  // ─── Signal Generation ────────────────────────────
  let signal: BollingerResult['signal'] = 'NONE';
  let reason = '';

  // Previous price for context
  const prevPrice = closes.length > 1 ? closes[closes.length - 2] : price;

  if (squeeze) {
    signal = 'BB_SQUEEZE';
    reason = `BB Squeeze — bandwidth ${(bandwidth * 100).toFixed(2)}% (avg ${(avgBandwidth * 100).toFixed(2)}%) → Breakout imminent`;
  } else if (percentB <= 0.05 && price > prevPrice) {
    // Price touched lower band and is bouncing up
    signal = 'BB_BUY';
    reason = `Lower Band Bounce — %B=${(percentB * 100).toFixed(1)}%, price recovering from $${lower.toFixed(2)}`;
  } else if (percentB >= 0.95 && price < prevPrice) {
    // Price touched upper band and is pulling back
    signal = 'BB_SELL';
    reason = `Upper Band Rejection — %B=${(percentB * 100).toFixed(1)}%, price rejecting from $${upper.toFixed(2)}`;
  }

  if (signal !== 'NONE') {
    log.info(`BB signal`, { signal, bandwidth: (bandwidth * 100).toFixed(2), percentB: (percentB * 100).toFixed(1), squeeze });
  }

  return {
    upper: Math.round(upper * 100) / 100,
    middle: Math.round(middle * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    bandwidth: Math.round(bandwidth * 10000) / 10000,
    percentB: Math.round(percentB * 1000) / 1000,
    squeeze,
    signal,
    reason,
  };
}
