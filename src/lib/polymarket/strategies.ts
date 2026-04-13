// ============================================================
// Polymarket Strategy Layer — Signal generation + performance tracking
// Strategy A: Mispricing/Calibration
// Strategy B: Resolution Divergence
// ============================================================

import { PolyMarket, PolyOpportunity, PolyDivision } from './polyTypes';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyStrategies');

export interface StrategySignal {
  strategyId: string;
  strategyName: string;
  marketId: string;
  market: PolyMarket;
  division: PolyDivision;
  direction: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  confidence: number;   // 0-100
  edgeScore: number;    // 0-100
  reasoning: string;
  timestamp: string;
}

export interface StrategyPerformance {
  strategyId: string;
  totalBets: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  profitFactor: number;
  maxDrawdown: number;
  expectancy: number;  // avg pnl per bet
  sharpeRatio: number;
}

interface StrategyStats {
  bets: Array<{ pnl: number; isWin: boolean }>;
  peakPnL: number;
}

// ─── Module-level performance tracker ──────────────────────
const performanceTracker = new Map<string, StrategyStats>();

// ─── STRATEGY A: Mispricing / Calibration ─────────────────
export function evaluateStrategyA(opportunity: PolyOpportunity): StrategySignal | null {
  const strategyId = 'strategy-mispricing-v1';

  // Thresholds
  if (opportunity.edgeScore < 50) {
    return null; // No signal
  }

  if (opportunity.mispricingScore < 40) {
    return null; // No mispricing detected
  }

  // Direction follows scanner recommendation
  const direction = opportunity.recommendation;
  if (direction === 'SKIP') {
    return null;
  }

  // Confidence: weighted average of edge and mispricing
  const confidence = Math.round(
    opportunity.edgeScore * 0.6 + opportunity.mispricingScore * 0.4,
  );

  const reasoning = `
Mispricing detected. Edge: ${opportunity.edgeScore}/100, Mispricing: ${opportunity.mispricingScore}/100.
Market: ${opportunity.market.title}.
Recommendation: ${direction}.
`.trim();

  return {
    strategyId,
    strategyName: 'Mispricing / Calibration',
    marketId: opportunity.marketId,
    market: opportunity.market,
    division: opportunity.division,
    direction,
    confidence,
    edgeScore: opportunity.edgeScore,
    reasoning,
    timestamp: new Date().toISOString(),
  };
}

// ─── STRATEGY B: Resolution Divergence ─────────────────────
export function evaluateStrategyB(market: PolyMarket, division: PolyDivision): StrategySignal | null {
  const strategyId = 'strategy-resolution-v1';

  // Find YES/NO outcomes
  const yesOutcome = market.outcomes.find(o => o.name.toLowerCase() === 'yes');
  const noOutcome = market.outcomes.find(o => o.name.toLowerCase() === 'no');

  if (!yesOutcome || !noOutcome) {
    return null; // Not a binary market
  }

  const yesPrice = yesOutcome.price;
  const hoursToExpiry = getHoursToExpiry(market.endDate);

  // Must expire within 24 hours
  if (hoursToExpiry >= 24) {
    return null;
  }

  // Must not be too close to consensus
  if (yesPrice <= 0.15 || yesPrice >= 0.85) {
    return null; // Already very extreme
  }

  let direction: 'BUY_YES' | 'BUY_NO' | 'SKIP' = 'SKIP';
  let confidence = 0;
  let reasoning = '';

  // < 6 hours to expiry: stronger signals
  if (hoursToExpiry < 6) {
    if (yesPrice < 0.3) {
      direction = 'BUY_NO';
      confidence = Math.round(70 + (0.3 - yesPrice) * 100); // boost for more extreme
      reasoning = `
Near-expiry divergence. Market at ${(yesPrice * 100).toFixed(1)}% YES, expiring in ${hoursToExpiry.toFixed(1)}h.
Resolution likely NO. Price divergence suggests opportunity.
`.trim();
    } else if (yesPrice > 0.7) {
      direction = 'BUY_YES';
      confidence = Math.round(70 + (yesPrice - 0.7) * 100); // boost for more extreme
      reasoning = `
Near-expiry divergence. Market at ${(yesPrice * 100).toFixed(1)}% YES, expiring in ${hoursToExpiry.toFixed(1)}h.
Resolution likely YES. Price divergence suggests opportunity.
`.trim();
    }
  }
  // 6-24 hours: need stronger signals
  else {
    if (yesPrice < 0.2) {
      direction = 'BUY_NO';
      confidence = Math.round(60 + (0.2 - yesPrice) * 100);
      reasoning = `
Medium-term divergence. Market at ${(yesPrice * 100).toFixed(1)}% YES, expiring in ${(hoursToExpiry / 24).toFixed(1)}d.
Price extreme suggests NO resolution likely.
`.trim();
    } else if (yesPrice > 0.8) {
      direction = 'BUY_YES';
      confidence = Math.round(60 + (yesPrice - 0.8) * 100);
      reasoning = `
Medium-term divergence. Market at ${(yesPrice * 100).toFixed(1)}% YES, expiring in ${(hoursToExpiry / 24).toFixed(1)}d.
Price extreme suggests YES resolution likely.
`.trim();
    }
  }

  if (direction === 'SKIP') {
    return null;
  }

  return {
    strategyId,
    strategyName: 'Resolution Divergence',
    marketId: market.id,
    market,
    division,
    direction,
    confidence: Math.min(100, confidence),
    edgeScore: Math.round(confidence * 0.8), // slightly lower edge than confidence
    reasoning,
    timestamp: new Date().toISOString(),
  };
}

// ─── Evaluate all strategies on an opportunity ─────────────
export function evaluateAllStrategies(opportunity: PolyOpportunity): StrategySignal[] {
  const signals: StrategySignal[] = [];

  // Strategy A: Mispricing
  const signalA = evaluateStrategyA(opportunity);
  if (signalA) {
    signals.push(signalA);
  }

  // Strategy B: Resolution Divergence
  const signalB = evaluateStrategyB(opportunity.market, opportunity.division);
  if (signalB) {
    signals.push(signalB);
  }

  return signals;
}

// ─── Record outcome for a strategy ─────────────────────────
export function recordStrategyOutcome(
  strategyId: string,
  pnl: number,
  isWin: boolean,
): void {
  if (!performanceTracker.has(strategyId)) {
    performanceTracker.set(strategyId, {
      bets: [],
      peakPnL: 0,
    });
  }

  const stats = performanceTracker.get(strategyId)!;
  stats.bets.push({ pnl, isWin });
  stats.peakPnL = Math.max(stats.peakPnL, pnl);

  log.info('Strategy outcome recorded', {
    strategyId,
    pnl: pnl.toFixed(2),
    isWin,
    totalBets: stats.bets.length,
  });
}

// ─── Get performance for a strategy ────────────────────────
export function getStrategyPerformance(strategyId: string): StrategyPerformance {
  const stats = performanceTracker.get(strategyId) || { bets: [], peakPnL: 0 };
  const bets = stats.bets;

  if (bets.length === 0) {
    return {
      strategyId,
      totalBets: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnL: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      expectancy: 0,
      sharpeRatio: 0,
    };
  }

  const wins = bets.filter(b => b.isWin).length;
  const losses = bets.length - wins;
  const winRate = wins / bets.length;

  const totalPnL = bets.reduce((sum, b) => sum + b.pnl, 0);
  const profitingBets = bets.filter(b => b.pnl > 0).reduce((sum, b) => sum + b.pnl, 0);
  const losingBets = Math.abs(bets.filter(b => b.pnl < 0).reduce((sum, b) => sum + b.pnl, 0));
  const profitFactor = losingBets > 0 ? profitingBets / losingBets : profitingBets > 0 ? 999 : 0;

  const expectancy = totalPnL / bets.length;

  // Max drawdown: cumulative decline from peak
  let maxDrawdown = 0;
  let peakVal = 0;
  let cumulativePnL = 0;
  for (const bet of bets) {
    cumulativePnL += bet.pnl;
    if (cumulativePnL > peakVal) {
      peakVal = cumulativePnL;
    } else {
      maxDrawdown = Math.max(maxDrawdown, peakVal - cumulativePnL);
    }
  }

  // Sharpe Ratio: (mean return) / (std dev of returns)
  const pnlValues = bets.map(b => b.pnl);
  const mean = pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length;
  const variance =
    pnlValues.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pnlValues.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? mean / stdDev : 0;

  return {
    strategyId,
    totalBets: bets.length,
    wins,
    losses,
    winRate: Math.round(winRate * 100) / 100,
    totalPnL: Math.round(totalPnL),
    profitFactor: Math.round(profitFactor * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown),
    expectancy: Math.round(expectancy),
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
  };
}

// ─── Helper: Calculate hours until market expiry ────────────
function getHoursToExpiry(endDate: string): number {
  const now = new Date();
  const end = new Date(endDate);
  return (end.getTime() - now.getTime()) / (1000 * 60 * 60);
}
