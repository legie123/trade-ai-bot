// ============================================================
// Gladiator Metrics Engine — AUDIT BUILD: Sharpe, Expectancy, Consistency
// Single source of truth for gladiator evaluation
// ============================================================

export interface GladiatorMetrics {
  sharpeRatio: number;       // Risk-adjusted return (annualized)
  expectancy: number;        // E[trade] = WR×AvgWin - (1-WR)×AvgLoss
  consistency: number;       // Coefficient of Variation of returns (lower = better)
  consecutiveLosses: number; // Current max consecutive loss streak
  readinessScore: number;    // Composite 0-100 score
  isEligibleForTop3: boolean;
}

export interface TradeRecord {
  pnlPercent: number;
  isWin: boolean;
  timestamp: number;
}

/**
 * Compute Sharpe Ratio from array of trade returns
 * Annualized assuming ~250 trading days, ~5 trades/day average
 */
export function computeSharpeRatio(returns: number[]): number {
  if (returns.length < 5) return 0;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize: assume ~1250 trades/year (5/day × 250 days)
  const annualizationFactor = Math.sqrt(Math.min(returns.length, 1250));
  return (mean / stdDev) * annualizationFactor;
}

/**
 * Compute Expectancy: expected value per trade
 * E = (WR × AvgWin) - ((1-WR) × AvgLoss)
 */
export function computeExpectancy(trades: TradeRecord[]): number {
  if (trades.length === 0) return 0;

  const wins = trades.filter(t => t.isWin);
  const losses = trades.filter(t => !t.isWin);

  const winRate = wins.length / trades.length;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlPercent, 0) / losses.length) : 0;

  return (winRate * avgWin) - ((1 - winRate) * avgLoss);
}

/**
 * Coefficient of Variation of monthly returns
 * Lower = more consistent. Target < 0.5
 */
export function computeConsistency(trades: TradeRecord[]): number {
  if (trades.length < 10) return 999; // Not enough data

  // Group by week (simulated "periods")
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const firstTs = sorted[0].timestamp;

  const periodReturns: number[] = [];
  let currentPeriod = 0;
  let periodPnl = 0;

  for (const t of sorted) {
    const period = Math.floor((t.timestamp - firstTs) / weekMs);
    if (period !== currentPeriod) {
      periodReturns.push(periodPnl);
      periodPnl = 0;
      currentPeriod = period;
    }
    periodPnl += t.pnlPercent;
  }
  periodReturns.push(periodPnl);

  if (periodReturns.length < 3) return 999;

  const mean = periodReturns.reduce((s, r) => s + r, 0) / periodReturns.length;
  if (mean === 0) return 999;

  const stdDev = Math.sqrt(periodReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / periodReturns.length);
  return Math.abs(stdDev / mean);
}

/**
 * Compute max consecutive losses
 */
export function computeConsecutiveLosses(trades: TradeRecord[]): number {
  let maxStreak = 0;
  let currentStreak = 0;

  for (const t of trades) {
    if (!t.isWin) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  return maxStreak;
}

/**
 * CANONICAL READINESS SCORE — Single source of truth
 * Used by: getLeaderboard(), auto-promote, arena API, butcher
 *
 * readiness = (
 *   wrScore × 0.30 +
 *   pfScore × 0.25 +
 *   sharpeScore × 0.20 +
 *   consistencyScore × 0.15 +
 *   maxDD_adj × 0.10
 * )
 */
export function computeReadinessScore(params: {
  winRate: number;         // 0-100
  profitFactor: number;    // typically 0-5
  sharpeRatio: number;     // typically -2 to 5
  consistency: number;     // CoV, lower = better
  maxDrawdown: number;     // 0-100 percent
  totalTrades: number;
  consecutiveLosses: number;
}): { score: number; eligible: boolean } {
  const { winRate, profitFactor, sharpeRatio, consistency, maxDrawdown, totalTrades, consecutiveLosses } = params;

  // Normalize each metric to 0-100 scale
  const wrScore = Math.min(100, Math.max(0, winRate));
  const pfScore = Math.min(100, Math.max(0, profitFactor * 25)); // PF 4.0 = 100
  const sharpeScore = Math.min(100, Math.max(0, (sharpeRatio + 1) * 33)); // Sharpe 2.0 = ~100
  const consistencyScore = Math.min(100, Math.max(0, 100 - consistency * 100)); // CoV 0 = 100, CoV 1 = 0
  const maxDD_adj = Math.max(0, 100 - maxDrawdown * 3); // DD 33% = 0

  const score = (
    wrScore * 0.30 +
    pfScore * 0.25 +
    sharpeScore * 0.20 +
    consistencyScore * 0.15 +
    maxDD_adj * 0.10
  );

  const eligible = (
    score >= 70 &&
    totalTrades >= 30 &&
    maxDrawdown < 15 &&
    consecutiveLosses < 5 &&
    sharpeRatio > 0.5
  );

  return { score: Math.round(score * 100) / 100, eligible };
}

/**
 * Compute ALL metrics for a gladiator from trade history
 */
export function computeAllMetrics(trades: TradeRecord[], winRate: number, profitFactor: number, maxDrawdown: number): GladiatorMetrics {
  const returns = trades.map(t => t.pnlPercent);
  const sharpeRatio = computeSharpeRatio(returns);
  const expectancy = computeExpectancy(trades);
  const consistency = computeConsistency(trades);
  const consecutiveLosses = computeConsecutiveLosses(trades);

  const { score, eligible } = computeReadinessScore({
    winRate,
    profitFactor,
    sharpeRatio,
    consistency,
    maxDrawdown,
    totalTrades: trades.length,
    consecutiveLosses,
  });

  return {
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    consistency: Math.round(consistency * 100) / 100,
    consecutiveLosses,
    readinessScore: score,
    isEligibleForTop3: eligible,
  };
}
