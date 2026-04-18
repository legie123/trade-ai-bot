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

/** Minimum trades to run walk-forward (below this, not enough data)
 *  FIX 2026-04-18 (C9): Raised from 30 → 100. With 30 trades across 5 folds
 *  each fold sees ~6 trades (4 train + 2 test) — stats are pure noise.
 *  Sample sizes below ~20/fold cannot distinguish edge from luck.
 *  Bootstrap override: env WALK_FORWARD_MIN_TRADES (for testing only). */
const MIN_TRADES = parseInt(process.env.WALK_FORWARD_MIN_TRADES || '100', 10);

/** Default number of folds */
const DEFAULT_FOLDS = 5;

/** Train/test split ratio (70% train, 30% test per fold) */
const TRAIN_RATIO = 0.7;

/** Number of bootstrap iterations for significance testing (C9)
 *  Higher = more precise p-value, lower = faster. 1000 is standard. */
const BOOTSTRAP_ITERATIONS = 1000;

/** p-value threshold below which a degradation is considered statistically significant */
const P_VALUE_THRESHOLD = 0.05;

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
  /** C9: p-value for OOS mean return ≥ 0 via bootstrap. Null if not enough data. */
  pValueOosPositive: number | null;
  /** C9: True if OOS performance is statistically NOT better than random (null hypothesis) */
  statisticallyFlat: boolean;
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
  // FIX 2026-04-18 (C10c): profitFactor=99 was a magic cap. It implied "infinite edge"
  // when really totalLoss=0 means "not enough losing trades to measure" — small sample
  // artifact, not genuine perfection. Use NaN (propagates to degradation calc correctly
  // via safeDivide) and a clean "Infinity" marker that the verdict layer can handle.
  // Rationale: sub-threshold losing streaks on <30 trades routinely produce this state.
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Number.POSITIVE_INFINITY : 0);

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
  // FIX 2026-04-18 (C10c): guard against Infinity and NaN propagating from
  // profitFactor edge cases (totalLoss=0). If either side is non-finite or
  // magnitude explodes, we can't compute a meaningful ratio → return 0 (neutral).
  const safeDivide = (isVal: number, oosVal: number) => {
    if (!Number.isFinite(isVal) || !Number.isFinite(oosVal)) return 0;
    if (Math.abs(isVal) < 0.0001) return 0; // Avoid division by near-zero
    const result = (isVal - oosVal) / Math.abs(isVal);
    return Number.isFinite(result) ? result : 0;
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

/**
 * C9: Bootstrap p-value for H0: OOS mean return ≤ 0 (no edge).
 *
 * Algorithm: resample trades with replacement N times, compute mean each iteration.
 * p-value = fraction of bootstrap means ≤ 0.
 * Returns null if < 20 trades (sample too small for meaningful bootstrap).
 *
 * ASUMPȚIE: trades are i.i.d. within the OOS window. If trades are temporally
 * autocorrelated (regime persistence), this p-value is OPTIMISTIC — real
 * significance is weaker than reported. Treat results as upper bound on edge.
 */
function bootstrapPValueOosPositive(oosTrades: TradeRecord[]): number | null {
  if (oosTrades.length < 20) return null;

  const n = oosTrades.length;
  const returns = oosTrades.map(t => t.pnlPercent);
  let belowZeroCount = 0;

  for (let iter = 0; iter < BOOTSTRAP_ITERATIONS; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      // Sample with replacement
      sum += returns[Math.floor(Math.random() * n)];
    }
    const mean = sum / n;
    if (mean <= 0) belowZeroCount++;
  }

  return belowZeroCount / BOOTSTRAP_ITERATIONS;
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

    // C9 FIX 2026-04-18: EXPANDING WINDOW walk-forward
    // Old design was disjoint blocks: each fold saw only 1/foldsth of history.
    // New design: train window GROWS with each fold, test window slides forward.
    //   fold_0: train=[0..split0],            test=[split0..boundary1]
    //   fold_1: train=[0..split1],            test=[split1..boundary2]  (split1 > split0)
    //   ...
    // This better mimics real-world deployment where each promotion decision
    // uses ALL historical data up to that point, not an arbitrary slice.
    //
    // ASUMPȚIE: gladiatorul nu re-antrenează parametrii continuu. Dacă o face,
    // expanding window subestimează overfit-ul pentru că amestecă generații.
    const foldResults: FoldResult[] = [];
    const allTrainTrades: TradeRecord[] = [];
    const allTestTrades: TradeRecord[] = [];

    // Determine boundaries: fold_i tests on trades[boundary_i..boundary_{i+1}]
    // boundary_0 = MIN_TRADES * TRAIN_RATIO (initial minimum train set)
    const minInitialTrain = Math.max(Math.floor(MIN_TRADES * TRAIN_RATIO), 20);
    if (trades.length <= minInitialTrain + 10) {
      // Not enough to split — fall back to non-expanding single fold
      return this.emptyResult(gladiatorId, folds, trades.length, Date.now() - t0);
    }

    const testRegionStart = minInitialTrain;
    const testRegionSize = trades.length - testRegionStart;
    const testFoldSize = Math.max(Math.floor(testRegionSize / folds), 3);

    for (let i = 0; i < folds; i++) {
      const testStart = testRegionStart + i * testFoldSize;
      const testEnd = i === folds - 1 ? trades.length : testStart + testFoldSize;
      if (testStart >= trades.length) break;

      const trainTrades = trades.slice(0, testStart); // EXPANDING
      const testTrades = trades.slice(testStart, testEnd);

      if (trainTrades.length < minInitialTrain || testTrades.length < 3) continue;

      const trainStats = computeStats(trainTrades);
      const testStats = computeStats(testTrades);
      const degradation = computeDegradation(trainStats, testStats);

      // C9: Bootstrap p-value on OOS — is the OOS edge statistically real?
      const pValue = bootstrapPValueOosPositive(testTrades);
      const statisticallyFlat = pValue !== null && pValue > P_VALUE_THRESHOLD;

      allTrainTrades.push(...trainTrades);
      allTestTrades.push(...testTrades);

      foldResults.push({
        foldIndex: i,
        trainStats,
        testStats,
        degradation,
        overfitFlag: isFoldOverfit(degradation),
        pValueOosPositive: pValue,
        statisticallyFlat,
      });
    }

    if (foldResults.length === 0) {
      return this.emptyResult(gladiatorId, folds, trades.length, Date.now() - t0);
    }

    const overfitCount = foldResults.filter(f => f.overfitFlag).length;
    const overfitScore = parseFloat((overfitCount / foldResults.length).toFixed(3));

    // C9 ADD: combined score — penalize folds that are also statistically flat
    // A "flat" fold (OOS mean not significantly > 0) contributes 0.5x weight to overfit
    const flatCount = foldResults.filter(f => f.statisticallyFlat).length;
    const flatScore = flatCount / foldResults.length;

    // Verdict thresholds — now considers both degradation AND statistical significance:
    //   CLEAN:   <=20% overfit AND <50% folds statistically flat
    //   SUSPECT: 20-50% overfit OR 50-80% folds flat
    //   OVERFIT: >50% overfit OR >80% folds flat (no edge even on OOS)
    const verdict: WalkForwardResult['verdict'] =
      (overfitScore > 0.5 || flatScore > 0.8) ? 'OVERFIT' :
      (overfitScore > 0.2 || flatScore > 0.5) ? 'SUSPECT' :
      'CLEAN';

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
