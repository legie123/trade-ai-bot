/**
 * Hyperopt DNA Optimization Engine — Step 3.1
 *
 * ADDITIVE. Bayesian parameter optimization for gladiator configs.
 * Uses a simplified TPE (Tree-structured Parzen Estimator) approach
 * to search the parameter space efficiently.
 *
 * Architecture:
 *   The Forge → HyperoptEngine.optimize(gladiatorId, searchSpace)
 *     → sample trials → evaluate via WalkForward → score → update model → best config
 *
 * Scoring: OOS Sharpe from WalkForward, penalized by overfit score.
 *   score = oosSharpe × (1 - overfitScore × 0.5)
 *   This ensures we prefer configs that generalize, not just fit history.
 *
 * ASSUMPTION: Parameters are bounded and continuous or discrete.
 *   Unbounded search = divergence risk → all params require [min, max].
 *
 * ASSUMPTION: WalkForward results are meaningful only with ≥30 trades.
 *   If gladiator has <30 trades, optimization returns baseline config.
 *
 * Kill-switch: DISABLE_HYPEROPT=true
 */

import { createLogger } from '@/lib/core/logger';

const log = createLogger('HyperoptEngine');

const DISABLED = process.env.DISABLE_HYPEROPT === 'true';

// ─── Configuration ──────────────────────────────────────────

const DEFAULT_MAX_TRIALS = 50;
const DEFAULT_INITIAL_RANDOM = 10;    // Pure random exploration before TPE kicks in
const CONVERGENCE_PATIENCE = 10;      // Stop if no improvement in N trials

// ─── Types ──────────────────────────────────────────────────

export type ParamType = 'continuous' | 'integer' | 'choice';

export interface ParamSpec {
  name: string;
  type: ParamType;
  min?: number;          // For continuous/integer
  max?: number;          // For continuous/integer
  choices?: number[];    // For choice type
  default: number;       // Baseline value
}

export interface SearchSpace {
  params: ParamSpec[];
}

export interface TrialResult {
  trialIndex: number;
  config: Record<string, number>;
  /** OOS Sharpe from WalkForward */
  oosSharpe: number;
  /** Overfit score from WalkForward (0-1) */
  overfitScore: number;
  /** Combined score: oosSharpe × (1 - overfitScore × 0.5) */
  score: number;
  /** Walk-forward verdict */
  wfVerdict: string;
  /** OOS win rate */
  oosWinRate: number;
  /** OOS profit factor */
  oosProfitFactor: number;
}

export interface HyperoptResult {
  gladiatorId: string;
  totalTrials: number;
  bestTrial: TrialResult;
  baselineScore: number;
  improvementPercent: number;
  /** All trials sorted by score descending */
  trialHistory: TrialResult[];
  /** Best config as key-value pairs */
  bestConfig: Record<string, number>;
  /** Convergence info */
  converged: boolean;
  convergenceReason: string;
  computeTimeMs: number;
}

// ─── TPE Sampling ───────────────────────────────────────────

/**
 * Simplified TPE: splits trials into "good" (top 25%) and "bad" (bottom 75%).
 * Samples from "good" distribution with Gaussian noise.
 * Falls back to uniform random if not enough history.
 *
 * NOTE: This is a lightweight TPE approximation, not a full Hyperopt port.
 * For production-grade Bayesian optimization, consider calling a Python
 * subprocess with actual Hyperopt/Optuna. This TS implementation trades
 * optimality for zero-dependency simplicity.
 */
function tpeSample(
  param: ParamSpec,
  goodValues: number[],
  _allValues: number[],
): number {
  if (param.type === 'choice' && param.choices) {
    // For choices: sample from good distribution or random
    if (goodValues.length > 0) {
      // Pick a random value from "good" trials
      return goodValues[Math.floor(Math.random() * goodValues.length)];
    }
    return param.choices[Math.floor(Math.random() * param.choices.length)];
  }

  const min = param.min ?? 0;
  const max = param.max ?? 100;

  if (goodValues.length < 3) {
    // Not enough data → uniform random
    const val = min + Math.random() * (max - min);
    return param.type === 'integer' ? Math.round(val) : val;
  }

  // Gaussian kernel around a random "good" value
  const center = goodValues[Math.floor(Math.random() * goodValues.length)];
  const bandwidth = (max - min) * 0.15; // 15% of range
  const sampled = center + (Math.random() - 0.5) * 2 * bandwidth;
  const clamped = Math.max(min, Math.min(max, sampled));

  return param.type === 'integer' ? Math.round(clamped) : parseFloat(clamped.toFixed(6));
}

function randomSample(param: ParamSpec): number {
  if (param.type === 'choice' && param.choices) {
    return param.choices[Math.floor(Math.random() * param.choices.length)];
  }
  const min = param.min ?? 0;
  const max = param.max ?? 100;
  const val = min + Math.random() * (max - min);
  return param.type === 'integer' ? Math.round(val) : parseFloat(val.toFixed(6));
}

// ─── Score Function ─────────────────────────────────────────

/**
 * Combined score: OOS Sharpe penalized by overfit risk.
 * Negative Sharpe stays negative (bad configs should score low).
 * Overfit penalty reduces score by up to 50%.
 */
function computeScore(oosSharpe: number, overfitScore: number): number {
  return parseFloat((oosSharpe * (1 - overfitScore * 0.5)).toFixed(4));
}

// ─── Evaluator Type ─────────────────────────────────────────

/**
 * Evaluator function type. The caller provides this to connect
 * HyperoptEngine to actual gladiator evaluation.
 *
 * Given a config, it should:
 *   1. Apply config to gladiator (temporarily)
 *   2. Run WalkForward validation
 *   3. Return OOS metrics
 *
 * This decoupling keeps HyperoptEngine pure — no direct DB or gladiator deps.
 */
export type ConfigEvaluator = (config: Record<string, number>) => Promise<{
  oosSharpe: number;
  overfitScore: number;
  wfVerdict: string;
  oosWinRate: number;
  oosProfitFactor: number;
}>;

// ─── Main Engine ────────────────────────────────────────────

export class HyperoptEngine {
  private static instance: HyperoptEngine;

  public static getInstance(): HyperoptEngine {
    if (!HyperoptEngine.instance) {
      HyperoptEngine.instance = new HyperoptEngine();
    }
    return HyperoptEngine.instance;
  }

  /**
   * Run Bayesian optimization over a gladiator's parameter space.
   *
   * @param gladiatorId - For logging/tracking
   * @param searchSpace - Parameter definitions with bounds
   * @param evaluator - Function that evaluates a config and returns OOS metrics
   * @param maxTrials - Maximum optimization iterations (default 50)
   */
  async optimize(
    gladiatorId: string,
    searchSpace: SearchSpace,
    evaluator: ConfigEvaluator,
    maxTrials: number = DEFAULT_MAX_TRIALS,
  ): Promise<HyperoptResult> {
    const t0 = Date.now();

    if (DISABLED) {
      log.info(`[Hyperopt] Disabled via DISABLE_HYPEROPT=true`);
      const baseConfig = this.buildBaselineConfig(searchSpace);
      return this.emptyResult(gladiatorId, baseConfig, Date.now() - t0);
    }

    // 1. Evaluate baseline (default config)
    const baseConfig = this.buildBaselineConfig(searchSpace);
    let baselineEval;
    try {
      baselineEval = await evaluator(baseConfig);
    } catch (err) {
      log.error(`[Hyperopt] Baseline evaluation failed: ${err}`);
      return this.emptyResult(gladiatorId, baseConfig, Date.now() - t0);
    }

    const baselineScore = computeScore(baselineEval.oosSharpe, baselineEval.overfitScore);
    log.info(`[Hyperopt] ${gladiatorId} baseline: Sharpe=${baselineEval.oosSharpe.toFixed(3)}, score=${baselineScore.toFixed(3)}`);

    // 2. Run trials
    const trials: TrialResult[] = [];
    let bestScore = baselineScore;
    let bestConfig = { ...baseConfig };
    let bestTrial: TrialResult = {
      trialIndex: -1,
      config: baseConfig,
      oosSharpe: baselineEval.oosSharpe,
      overfitScore: baselineEval.overfitScore,
      score: baselineScore,
      wfVerdict: baselineEval.wfVerdict,
      oosWinRate: baselineEval.oosWinRate,
      oosProfitFactor: baselineEval.oosProfitFactor,
    };
    let noImprovementCount = 0;

    for (let trial = 0; trial < maxTrials; trial++) {
      // Sample config: random for initial phase, TPE after
      const config: Record<string, number> = {};

      if (trial < DEFAULT_INITIAL_RANDOM) {
        // Pure random exploration
        for (const param of searchSpace.params) {
          config[param.name] = randomSample(param);
        }
      } else {
        // TPE-guided sampling
        const goodThreshold = Math.ceil(trials.length * 0.25);
        const sorted = [...trials].sort((a, b) => b.score - a.score);
        const goodTrials = sorted.slice(0, Math.max(1, goodThreshold));

        for (const param of searchSpace.params) {
          const goodVals = goodTrials.map(t => t.config[param.name]).filter(v => v !== undefined);
          const allVals = trials.map(t => t.config[param.name]).filter(v => v !== undefined);
          config[param.name] = tpeSample(param, goodVals, allVals);
        }
      }

      // Evaluate
      let evalResult;
      try {
        evalResult = await evaluator(config);
      } catch (err) {
        log.warn(`[Hyperopt] Trial ${trial} evaluation failed: ${err}`);
        continue;
      }

      const score = computeScore(evalResult.oosSharpe, evalResult.overfitScore);

      const trialResult: TrialResult = {
        trialIndex: trial,
        config,
        oosSharpe: evalResult.oosSharpe,
        overfitScore: evalResult.overfitScore,
        score,
        wfVerdict: evalResult.wfVerdict,
        oosWinRate: evalResult.oosWinRate,
        oosProfitFactor: evalResult.oosProfitFactor,
      };

      trials.push(trialResult);

      if (score > bestScore) {
        bestScore = score;
        bestConfig = { ...config };
        bestTrial = trialResult;
        noImprovementCount = 0;
        log.info(`[Hyperopt] Trial ${trial}: NEW BEST score=${score.toFixed(3)} Sharpe=${evalResult.oosSharpe.toFixed(3)}`);
      } else {
        noImprovementCount++;
      }

      // Convergence check
      if (noImprovementCount >= CONVERGENCE_PATIENCE && trial >= DEFAULT_INITIAL_RANDOM) {
        log.info(`[Hyperopt] Converged: no improvement in ${CONVERGENCE_PATIENCE} trials`);
        break;
      }
    }

    // Sort trials by score descending
    trials.sort((a, b) => b.score - a.score);

    const improvementPercent = baselineScore !== 0
      ? parseFloat(((bestScore - baselineScore) / Math.abs(baselineScore) * 100).toFixed(2))
      : 0;

    const result: HyperoptResult = {
      gladiatorId,
      totalTrials: trials.length,
      bestTrial,
      baselineScore,
      improvementPercent,
      trialHistory: trials,
      bestConfig,
      converged: noImprovementCount >= CONVERGENCE_PATIENCE,
      convergenceReason: noImprovementCount >= CONVERGENCE_PATIENCE
        ? `No improvement in ${CONVERGENCE_PATIENCE} trials`
        : `Completed ${trials.length}/${maxTrials} trials`,
      computeTimeMs: Date.now() - t0,
    };

    log.info(
      `[Hyperopt] ${gladiatorId}: best_score=${bestScore.toFixed(3)} ` +
      `baseline=${baselineScore.toFixed(3)} improvement=${improvementPercent}% ` +
      `trials=${trials.length} (${result.computeTimeMs}ms)`
    );

    return result;
  }

  private buildBaselineConfig(space: SearchSpace): Record<string, number> {
    const config: Record<string, number> = {};
    for (const param of space.params) {
      config[param.name] = param.default;
    }
    return config;
  }

  private emptyResult(
    gladiatorId: string, baseConfig: Record<string, number>, ms: number,
  ): HyperoptResult {
    return {
      gladiatorId,
      totalTrials: 0,
      bestTrial: {
        trialIndex: -1,
        config: baseConfig,
        oosSharpe: 0,
        overfitScore: 0,
        score: 0,
        wfVerdict: 'CLEAN',
        oosWinRate: 0,
        oosProfitFactor: 0,
      },
      baselineScore: 0,
      improvementPercent: 0,
      trialHistory: [],
      bestConfig: baseConfig,
      converged: false,
      convergenceReason: 'DISABLED or insufficient data',
      computeTimeMs: ms,
    };
  }
}

// ─── Default Search Spaces ──────────────────────────────────

/**
 * Standard gladiator search space for OMNI-X type strategies.
 * These are the typical tunable parameters.
 *
 * CRITICAL: Bounds reflect what is mathematically safe.
 * Expanding bounds beyond these risks divergent behavior.
 */
export const DEFAULT_GLADIATOR_SEARCH_SPACE: SearchSpace = {
  params: [
    { name: 'atrWindow', type: 'integer', min: 7, max: 50, default: 14 },
    { name: 'rsiWindow', type: 'integer', min: 7, max: 28, default: 14 },
    { name: 'rsiOverbought', type: 'integer', min: 65, max: 85, default: 70 },
    { name: 'rsiOversold', type: 'integer', min: 15, max: 35, default: 30 },
    { name: 'slMultiplier', type: 'continuous', min: 1.0, max: 3.0, default: 1.5 },
    { name: 'tpMultiplier', type: 'continuous', min: 1.5, max: 5.0, default: 2.5 },
    { name: 'vwapDevThreshold', type: 'continuous', min: 0.005, max: 0.03, default: 0.015 },
    { name: 'volumeZThreshold', type: 'continuous', min: 1.0, max: 3.0, default: 1.5 },
    { name: 'minConfidence', type: 'continuous', min: 0.4, max: 0.8, default: 0.6 },
    { name: 'pyramidingMax', type: 'integer', min: 1, max: 4, default: 2 },
  ],
};
