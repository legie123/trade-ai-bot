// ============================================================
// Backtest Analytics — Phase 4
// Pure functions for computing strategy performance metrics.
// ============================================================

/**
 * Wilson 95% CI for win rate.
 * More robust than normal approximation, especially for small N
 * or extreme proportions (closer to 0 or 1).
 */
export function computeWilsonCI(
  wins: number,
  total: number,
  confidence = 0.95,
): { lower: number; upper: number; point: number } {
  if (total === 0) return { lower: 0, upper: 0, point: 0 };
  const p = wins / total;
  const z = confidence >= 0.99 ? 2.576 : confidence >= 0.95 ? 1.96 : 1.645;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    lower: Math.max(0, (center - margin) / denom),
    upper: Math.min(1, (center + margin) / denom),
    point: p,
  };
}

/**
 * Sharpe-like ratio: mean(pnl) / std(pnl).
 * Annualization deferred (need bar-period assumption).
 * Returns 0 for empty or zero-variance samples.
 */
export function computeSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0;
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance =
    pnls.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (pnls.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0 || !Number.isFinite(std)) return 0;
  return mean / std;
}

/**
 * Profit factor: gross_wins / gross_losses.
 * PF > 1 means net profitable.
 * Returns Infinity if no losses (only wins).
 */
export function computeProfitFactor(pnls: number[]): number {
  let grossWin = 0;
  let grossLoss = 0;
  for (const p of pnls) {
    if (p > 0) grossWin += p;
    else if (p < 0) grossLoss += -p;
  }
  if (grossLoss === 0) return grossWin > 0 ? Infinity : 0;
  return grossWin / grossLoss;
}

/**
 * Max drawdown as a percentage of peak equity.
 * Input: chronologically-ordered PnL series.
 * Returns 0-100.
 */
export function computeMaxDrawdown(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  for (const p of pnls) {
    cum += p;
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (peak - cum) / Math.abs(peak) : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd * 100;
}

/**
 * Bootstrap win rate confidence: resample N decisions with replacement,
 * report 5th and 95th percentile of resampled win rates.
 * Useful when N is small or wins distribution is skewed.
 */
export function bootstrapWinRate(
  outcomes: Array<0 | 1>,
  iterations = 1000,
): { wrLower: number; wrUpper: number; wrMean: number } {
  if (outcomes.length === 0) return { wrLower: 0, wrUpper: 0, wrMean: 0 };
  const n = outcomes.length;
  const wrs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let w = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(Math.random() * n);
      if (outcomes[idx] === 1) w++;
    }
    wrs.push(w / n);
  }
  wrs.sort((a, b) => a - b);
  const wrMean = wrs.reduce((a, b) => a + b, 0) / iterations;
  return {
    wrLower: wrs[Math.floor(0.05 * iterations)],
    wrUpper: wrs[Math.floor(0.95 * iterations)],
    wrMean,
  };
}
