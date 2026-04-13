/**
 * Monte Carlo Backtesting Engine — Faza 9
 *
 * Runs N simulated paths from historical gladiator battle results.
 * For each path, randomly resamples (with replacement) from past trade outcomes.
 * Produces confidence intervals for equity curve, max drawdown, and final PnL.
 *
 * Used by:
 *   - GET /api/v2/backtest?gladiatorId=X&simulations=1000
 *   - Orchestrator for risk assessment before promoting gladiators to LIVE
 */

import { createLogger } from '@/lib/core/logger';
import { getGladiatorBattles } from '@/lib/store/db';

const log = createLogger('MonteCarloEngine');

export interface TradeOutcome {
  pnlPercent: number;    // e.g. +1.2 or -0.8
  symbol: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;
}

export interface MonteCarloResult {
  gladiatorId: string;
  simulations: number;
  sampleSize: number;
  /** Percentile-based equity curve projections after `sampleSize` trades */
  equityPaths: {
    p5: number;      // 5th percentile (worst case)
    p25: number;
    p50: number;     // Median
    p75: number;
    p95: number;     // Best case
  };
  /** Max drawdown distribution */
  maxDrawdown: {
    p5: number;      // Worst 5% of simulations
    p50: number;
    p95: number;
    mean: number;
  };
  /** Win rate stability */
  winRateDistribution: {
    mean: number;
    stdDev: number;
    p5: number;
    p95: number;
  };
  /** Risk of ruin: % of simulations that hit -30% drawdown */
  ruinProbability: number;
  /** Profit factor distribution */
  profitFactor: {
    mean: number;
    p5: number;
    p95: number;
  };
  computeTimeMs: number;
}

export class MonteCarloEngine {
  private static readonly RUIN_THRESHOLD = -30; // -30% equity → ruin

  /**
   * Run Monte Carlo simulation for a specific gladiator.
   * @param gladiatorId - ID of the gladiator to backtest
   * @param simulations - Number of random paths (default 1000)
   * @param startingEquity - Starting equity in % terms (100 = 100%)
   */
  public static async run(
    gladiatorId: string,
    simulations = 1000,
    startingEquity = 100,
  ): Promise<MonteCarloResult> {
    const t0 = Date.now();

    // Fetch historical battles
    const rawBattles = await getGladiatorBattles(gladiatorId, 2000);

    const outcomes: TradeOutcome[] = rawBattles
      .filter((b): b is Record<string, unknown> & { result: string } =>
        typeof b.result === 'string' && typeof b.pnl_percent === 'number'
      )
      .map(b => ({
        pnlPercent: b.pnl_percent as number,
        symbol: (b.symbol as string) ?? 'UNKNOWN',
        direction: ((b.direction as string) ?? 'LONG') as 'LONG' | 'SHORT',
        confidence: (b.confidence as number) ?? 0.5,
      }));

    if (outcomes.length < 10) {
      log.warn(`[MC] Insufficient data for ${gladiatorId}: ${outcomes.length} trades`);
      return this.emptyResult(gladiatorId, simulations, outcomes.length, Date.now() - t0);
    }

    const pathLength = outcomes.length; // simulate same # of trades as history

    // Run simulations
    const finalEquities: number[] = [];
    const maxDrawdowns: number[] = [];
    const winRates: number[] = [];
    const profitFactors: number[] = [];
    let ruinCount = 0;

    for (let sim = 0; sim < simulations; sim++) {
      let equity = startingEquity;
      let peak = equity;
      let maxDD = 0;
      let wins = 0;
      let totalProfit = 0;
      let totalLoss = 0;

      for (let t = 0; t < pathLength; t++) {
        // Random resample with replacement
        const trade = outcomes[Math.floor(Math.random() * outcomes.length)];
        const pnl = equity * (trade.pnlPercent / 100);
        equity += pnl;

        if (pnl > 0) { wins++; totalProfit += pnl; }
        else { totalLoss += Math.abs(pnl); }

        if (equity > peak) peak = equity;
        const dd = ((peak - equity) / peak) * 100;
        if (dd > maxDD) maxDD = dd;
      }

      finalEquities.push(equity);
      maxDrawdowns.push(maxDD);
      winRates.push((wins / pathLength) * 100);
      profitFactors.push(totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 99 : 1);

      if ((equity - startingEquity) / startingEquity * 100 <= this.RUIN_THRESHOLD) {
        ruinCount++;
      }
    }

    // Sort for percentiles
    finalEquities.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);
    winRates.sort((a, b) => a - b);
    profitFactors.sort((a, b) => a - b);

    const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p / 100)] ?? 0;
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const stdDev = (arr: number[]) => {
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    };

    return {
      gladiatorId,
      simulations,
      sampleSize: outcomes.length,
      equityPaths: {
        p5: parseFloat(pct(finalEquities, 5).toFixed(2)),
        p25: parseFloat(pct(finalEquities, 25).toFixed(2)),
        p50: parseFloat(pct(finalEquities, 50).toFixed(2)),
        p75: parseFloat(pct(finalEquities, 75).toFixed(2)),
        p95: parseFloat(pct(finalEquities, 95).toFixed(2)),
      },
      maxDrawdown: {
        p5: parseFloat(pct(maxDrawdowns, 5).toFixed(2)),
        p50: parseFloat(pct(maxDrawdowns, 50).toFixed(2)),
        p95: parseFloat(pct(maxDrawdowns, 95).toFixed(2)),
        mean: parseFloat(mean(maxDrawdowns).toFixed(2)),
      },
      winRateDistribution: {
        mean: parseFloat(mean(winRates).toFixed(2)),
        stdDev: parseFloat(stdDev(winRates).toFixed(2)),
        p5: parseFloat(pct(winRates, 5).toFixed(2)),
        p95: parseFloat(pct(winRates, 95).toFixed(2)),
      },
      ruinProbability: parseFloat(((ruinCount / simulations) * 100).toFixed(2)),
      profitFactor: {
        mean: parseFloat(mean(profitFactors).toFixed(2)),
        p5: parseFloat(pct(profitFactors, 5).toFixed(2)),
        p95: parseFloat(pct(profitFactors, 95).toFixed(2)),
      },
      computeTimeMs: Date.now() - t0,
    };
  }

  private static emptyResult(
    gladiatorId: string, simulations: number, sampleSize: number, ms: number,
  ): MonteCarloResult {
    return {
      gladiatorId, simulations, sampleSize,
      equityPaths: { p5: 100, p25: 100, p50: 100, p75: 100, p95: 100 },
      maxDrawdown: { p5: 0, p50: 0, p95: 0, mean: 0 },
      winRateDistribution: { mean: 0, stdDev: 0, p5: 0, p95: 0 },
      ruinProbability: 0,
      profitFactor: { mean: 1, p5: 1, p95: 1 },
      computeTimeMs: ms,
    };
  }
}
