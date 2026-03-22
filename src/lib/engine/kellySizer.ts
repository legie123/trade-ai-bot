// ============================================================
// Kelly Criterion Position Sizer
// Dynamically calculates optimal risk% per trade based on:
//   - Historical win rate
//   - Average win/loss ratio (R:R)
//   - Half-Kelly for safety (prevents over-betting)
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('KellySizer');

export interface KellyResult {
  fullKelly: number;      // Full Kelly fraction (%)
  halfKelly: number;      // Half Kelly — conservative bet (%)
  suggestedRisk: number;  // Final suggested risk% per trade
  winRate: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number;    // avgWin / avgLoss
  sampleSize: number;
  confident: boolean;     // Enough data to trust Kelly?
}

export function calculateKellyRisk(
  trades: { pnlPercent: number; outcome: 'WIN' | 'LOSS' | 'NEUTRAL' }[],
  minRisk: number = 0.5,
  maxRisk: number = 3.0
): KellyResult {
  // Filter only resolved trades
  const resolved = trades.filter(t => t.outcome === 'WIN' || t.outcome === 'LOSS');

  if (resolved.length < 10) {
    log.info('Insufficient trade history for Kelly, using default 1.5%', { trades: resolved.length });
    return {
      fullKelly: 1.5,
      halfKelly: 0.75,
      suggestedRisk: 1.5, // Default
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      payoffRatio: 0,
      sampleSize: resolved.length,
      confident: false,
    };
  }

  const wins = resolved.filter(t => t.outcome === 'WIN');
  const losses = resolved.filter(t => t.outcome === 'LOSS');

  const winRate = wins.length / resolved.length;
  const lossRate = 1 - winRate;

  // Average win and loss magnitudes
  const avgWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + Math.abs(t.pnlPercent), 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? losses.reduce((sum, t) => sum + Math.abs(t.pnlPercent), 0) / losses.length
    : 1; // Prevent division by zero

  // Payoff ratio (R:R)
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

  // Kelly Formula: f* = (p * b - q) / b
  // Where: p = winRate, q = lossRate, b = payoffRatio
  let fullKelly = 0;
  if (payoffRatio > 0) {
    fullKelly = ((winRate * payoffRatio) - lossRate) / payoffRatio;
  }

  // Half Kelly (standard institutional practice for safety)
  const halfKelly = fullKelly / 2;

  // Clamp between min and max risk
  const suggestedRisk = Math.max(minRisk, Math.min(maxRisk, halfKelly * 100));

  // Confidence check: need >= 30 trades for reliable Kelly
  const confident = resolved.length >= 30;

  log.info('Kelly Criterion calculated', {
    winRate: `${(winRate * 100).toFixed(1)}%`,
    payoffRatio: payoffRatio.toFixed(2),
    fullKelly: `${(fullKelly * 100).toFixed(2)}%`,
    halfKelly: `${(halfKelly * 100).toFixed(2)}%`,
    suggestedRisk: `${suggestedRisk.toFixed(2)}%`,
    sampleSize: resolved.length,
    confident,
  });

  return {
    fullKelly: Math.round(fullKelly * 10000) / 100,
    halfKelly: Math.round(halfKelly * 10000) / 100,
    suggestedRisk: Math.round(suggestedRisk * 100) / 100,
    winRate: Math.round(winRate * 1000) / 10,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    payoffRatio: Math.round(payoffRatio * 100) / 100,
    sampleSize: resolved.length,
    confident,
  };
}

// ─── Dynamic Kelly Cache (10-min TTL) ─────────────
const gk = globalThis as unknown as { __kellyCache?: { result: KellyResult; at: number } };
const KELLY_CACHE_TTL = 10 * 60_000;

export async function getKellyRiskCached(): Promise<KellyResult> {
  const now = Date.now();
  if (gk.__kellyCache && now - gk.__kellyCache.at < KELLY_CACHE_TTL) {
    return gk.__kellyCache.result;
  }

  // Fetch fresh trades and recalculate
  try {
    const { getDecisions } = await import('@/lib/store/db');
    const decisions = getDecisions();
    const trades = decisions
      .filter((d: { outcome: string }) => d.outcome !== 'PENDING')
      .map((d: { pnlPercent: number | null; outcome: string }) => ({
        pnlPercent: d.pnlPercent || 0,
        outcome: d.outcome as 'WIN' | 'LOSS' | 'NEUTRAL',
      }));
    const result = calculateKellyRisk(trades);
    gk.__kellyCache = { result, at: now };
    log.info('Kelly cache refreshed', { suggestedRisk: result.suggestedRisk, sampleSize: result.sampleSize });
    return result;
  } catch {
    return calculateKellyRisk([]);
  }
}
