/**
 * Walk-Forward Validation Engine — Step 2.3
 *
 * ADDITIVE. Splits gladiator trade history into rolling train/test windows.
 * Compares in-sample vs out-of-sample performance to detect overfitting.
 *
 * Architecture:
 *   The Butcher / Promotion Gate → WalkForwardEngine.validate(gladiatorId)
 *     → fetch trades → split into folds → compute IS/OOS stats → overfit score
 *
 * ASSUMPTION: Trades from DB are time-ordered (oldest first).
 *   If this breaks, the entire walk-forward result is invalid.
 *
 * ASSUMPTION: Gladiator behavior is stationary within each window.
 *   Regime shifts mid-window will appear as degradation even if the
 *   gladiator correctly adapted. Cross-reference with regime data.
 *
 * Kill-switch: DISABLE_WALK_FORWARD=true
 */

import { createLogger } from '@/lib/core/logger';
import { getGladiatorBattles } from '@/lib/store/db';

const log = createLogger('WalkForwardEngine');

const DISABLED = process.env.DISABLE_WALK_FORWARD === 'true';

// ─── Configuration ──────────────────────────────────────────

/** Minimum trades to run walk-forward (below this, not enough data) */
const MIN_TRADES = 30;

/** Default number of folds */
const DEFAULT_FOLDS = 5;

/** Train/test split ratio (70% train, 30% test per fold) */
const TRAIN_RATIO = 0.7;

/**
 * Degradation thresholds — if OOS metric drops by more than this
 * fraction relative to IS, it counts as an overfit signal.
 * E.g., 0.25 means >25% drop in WR from IS to OOS = overfit flag.
 */
const DEGRADATION_THRESHOLDS = {
  winRate: 0.20,       // 20% relative drop
  profitFactor: 0.30,  // 30% relative drop
  sharpe: 0.40,        // 40% relative drop (Sharpe is noisy)
  avgPnl: 0.25,        // 25% relative drop
} as const;

// ─── Types ──────────────────────────────────────────────────

interface TradeRecord {
  pnlPercent: number;
  timestamp: string | number;
}

export interface FoldStats {
  winRate: number;
  profitFactor: number;
  sharpe: number;
  avgPnl: number;
  tradeCount: number;
}

export interface FoldResult {
  foldIndex: number;
  trainStats: FoldStats;
  testStats: FoldStats;
  /** Per-metric degradation: (IS - OOS) / IS. Positive = OOS worse. */
  degradation: {
    winRate: number;
    profitFactor: number;
    sharpe: number;
    avgPnl: number;
  };
  /** True if ANY metric degradation exceeds its threshold */
  overfitFlag: boolean;
}

export interface WalkForwardResult {
  gladiatorId: string;
  folds: number;
  totalTrades: number;
  foldResults: FoldResult[];
  /** 0-1 score: fraction of folds flagged as overfit */
  overfitScore: number;
  /** Aggregate out-of-sample stats across all test windows */
  aggregateOOS: FoldStats;
  /** Aggregate in-sample stats across all train windows */
  aggregateIS: FoldStats;
  /** Verdict based on overfitScore */
  verdict: 'CLEAN' | 'SUSPECT' | 'OVERFIT';
  computeTimeMs: number;
}

// ─── Stats Computation ──────────────────────────────────────

function computeStats(trades: TradeRecord[]): FoldStats {
  if (trades.length === 0) {
    return { winRate: 0, profitFactor: 0, sharpe: 0, avgPnl: 0, tradeCount: 0 };
  }

  const wins = trades.filter(t => t.pnlPercent > 0);
  const losses = trades.filter(t => t.pnlPercent <= 0);

  const winRate = wins.length / trades.length;

  const totalProfit = wins.reduce((s, t) => s + t.pnlPercent, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPercent, 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? 99 : 1);

  const avgPnl = trades.reduce((s, t) => s + t.pnlPercent, 0) / trades.length;

  // Sharpe: mean / stdDev of returns (not annualized — relative comparison only)
  const returns = trades.map(t => t.pnlPercent / 100);
  const meanRet = returns.reduce((s, r) => s + r, 0) / returns.length;
  const retStd = Math.sqrt(
    returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / returns.length
  );
  const sharpe = retStd > 0 ? meanRet / retStd : 0;

  return {
    winRate: parseFloat(winRate.toFixed(4)),
    profitFactor: parseFloat(profitFactor.toFixed(3)),
    sharpe: parseFloat(sharpe.toFixed(3)),
    avgPnl: parseFloat(avgPnl.toFixed(4)),
    tradeCount: trades.length,
  };
}

function computeDegradation(is: FoldStats, oos: FoldStats) {
  // Relative degradation: (IS - OOS) / |IS|. Positive = OOS worse.
  const safeDivide = (isVal: number, oosVal: number) => {
    if (Math.abs(isVal) < 0.0001) return 0; // Avoid division by near-zero
    return (isVal - oosVal) / Math.abs(isVal);
  };

  return {
    winRate: parseFloat(safeDivide(is.winRate, oos.winRate).toFixed(4)),
    profitFactor: parseFloat(safeDivide(is.profitFactor, oos.profitFactor).toFixed(4)),
    sharpe: parseFloat(safeDivide(is.sharpe, oos.sharpe).toFixed(4)),
    avgPnl: parseFloat(safeDivide(is.avgPnl, oos.avgPnl).toFixed(4)),
  };
}

function isFoldOverfit(degradation: FoldResult['degradation']): boolean {
  return (
    degradation.winRate > DEGRADATION_THRESHOLDS.winRate ||
    degradation.profitFactor > DEGRADATION_THRESHOLDS.profitFactor ||
    degradation.sharpe > DEGRADATION_THRESHOLDS.sharpe ||
    degradation.avgPnl > DEGRADATION_THRESHOLDS.avgPnl
  );
}

// ─── Aggregate Stats (merge multiple windows) ───────────────

function aggregateStats(allTrades: TradeRecord[]): FoldStats {
  return computeStats(allTrades);
}

// ─── Main Engine ────────────────────────────────────────────

export class WalkForwardEngine {
  private static instance: WalkForwardEngine;

  public static getInstance(): WalkForwardEngine {
    if (!WalkForwardEngine.instance) {
      WalkForwardEngine.instance = new WalkForwardEngine();
    }
    return WalkForwardEngine.instance;
  }

  /**
   * Run walk-forward validation for a gladiator.
   *
   * @param gladiatorId - Gladiator to validate
   * @param folds - Number of rolling windows (default 5)
   * @returns WalkForwardResult with overfit score and per-fold breakdown
   */
  async validate(
    gladiatorId: string,
    folds: number = DEFAULT_FOLDS,
  ): Promise<WalkForwardResult> {
    const t0 = Date.now();

    if (DISABLED) {
      log.info(`[WF] Disabled via DISABLE_WALK_FORWARD=true`);
      return this.emptyResult(gladiatorId, folds, 0, Date.now() - t0);
    }

    // Fetch all battles for this gladiator, time-ordered
    const rawBattles = await getGladiatorBattles(gladiatorId, 5000);

    const trades: TradeRecord[] = rawBattles
      .filter((b): b is Record<string, unknown> & { pnl_percent: number } =>
        typeof b.pnl_percent === 'number'
      )
      .map(b => ({
        pnlPercent: b.pnl_percent as number,
        timestamp: (b.timestamp as string | number) ?? 0,
      }));

    if (trades.length < MIN_TRADES) {
      log.warn(`[WF] Insufficient data for ${gladiatorId}: ${trades.length} trades (min ${MIN_TRADES})`);
      return this.emptyResult(gladiatorId, folds, trades.length, Date.now() - t0);
    }

    // Split into rolling windows using expanding/sliding approach
    // Each fold uses a contiguous block of trades:
    //   fold_i train = trades[start..split], test = trades[split..end]
    //   Windows overlap and slide forward
    const foldSize = Math.floor(trades.length / folds);
    const foldResults: FoldResult[] = [];
    const allTrainTrades: TradeRecord[] = [];
    const allTestTrades: TradeRecord[] = [];

    for (let i = 0; i < folds; i++) {
      const foldStart = i * foldSize;
      const foldEnd = i === folds - 1 ? trades.length : (i + 1) * foldSize;
      const foldTrades = trades.slice(foldStart, foldEnd);

      if (foldTrades.length < 6) continue; // Need at least 6 trades for meaningful split

      const splitIdx = Math.floor(foldTrades.length * TRAIN_RATIO);
      const trainTrades = foldTrades.slice(0, splitIdx);
      const testTrades = foldTrades.slice(splitIdx);

      if (trainTrades.length < 3 || testTrades.length < 3) continue;

      const trainStats = computeStats(trainTrades);
      const testStats = computeStats(testTrades);
      const degradation = computeDegradation(trainStats, testStats);

      allTrainTrades.push(...trainTrades);
      allTestTrades.push(...testTrades);

      foldResults.push({
        foldIndex: i,
        trainStats,
        testStats,
        degradation,
        overfitFlag: isFoldOverfit(degradation),
      });
    }

    if (foldResults.length === 0) {
      return this.emptyResult(gladiatorId, folds, trades.length, Date.now() - t0);
    }

    const overfitCount = foldResults.filter(f => f.overfitFlag).length;
    const overfitScore = parseFloat((overfitCount / foldResults.length).toFixed(3));

    // Verdict thresholds:
    //   CLEAN:   <= 20% of folds overfit
    //   SUSPECT: 21-50% of folds overfit
    //   OVERFIT: > 50% of folds overfit
    const verdict: WalkForwardResult['verdict'] =
      overfitScore <= 0.2 ? 'CLEAN' :
      overfitScore <= 0.5 ? 'SUSPECT' :
      'OVERFIT';

    const result: WalkForwardResult = {
      gladiatorId,
      folds: foldResults.length,
      totalTrades: trades.length,
      foldResults,
      overfitScore,
      aggregateOOS: aggregateStats(allTestTrades),
      aggregateIS: aggregateStats(allTrainTrades),
      verdict,
      computeTimeMs: Date.now() - t0,
    };

    log.info(
      `[WF] ${gladiatorId}: ${verdict} (overfit=${(overfitScore * 100).toFixed(0)}%, ` +
      `${foldResults.length} folds, ${trades.length} trades, ${result.computeTimeMs}ms)`
    );

    return result;
  }

  private emptyResult(
    gladiatorId: string, folds: number, totalTrades: number, ms: number,
  ): WalkForwardResult {
    const emptyStats: FoldStats = { winRate: 0, profitFactor: 0, sharpe: 0, avgPnl: 0, tradeCount: 0 };
    return {
      gladiatorId,
      folds,
      totalTrades,
      foldResults: [],
      overfitScore: 0,
      aggregateOOS: emptyStats,
      aggregateIS: emptyStats,
      verdict: 'CLEAN',
      computeTimeMs: ms,
    };
  }
}
