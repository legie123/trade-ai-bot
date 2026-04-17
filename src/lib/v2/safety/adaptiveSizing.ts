// ============================================================
// Regime-Adaptive Position Sizing — Step 1.3
//
// ADDITIVE. Adjusts position size based on market regime,
// current drawdown, volatility, and loss streak.
// Wraps the base risk fraction from RiskVote.
//
// Kill-switch: DISABLE_ADAPTIVE_SIZING=true → returns base fraction unchanged
//
// ASSUMPTION: Regime multipliers are conservative defaults.
// If they prove too aggressive or too timid, recalibrate
// based on actual equity curve behavior (tracked via Audit Trail).
// ============================================================

import { createLogger } from '@/lib/core/logger';

const log = createLogger('AdaptiveSizing');

// ─── Configuration ──────────────────────────────────────────

const DISABLED = process.env.DISABLE_ADAPTIVE_SIZING === 'true';

// ─── Types ──────────────────────────────────────────────────

/**
 * Supported market regimes — aligned with both OmegaEngine and
 * the intelligence/agents/marketRegime classifications.
 */
type RegimeKey = 'BULL' | 'BEAR' | 'RANGE' | 'HIGH_VOL' | 'TRANSITION'
  | 'trend_up' | 'trend_down' | 'range' | 'volatile' | 'illiquid' | 'unknown';

export interface SizingInput {
  /** Base risk fraction from RiskVote / SentinelGuard (e.g., 0.02 = 2%) */
  baseRiskFraction: number;
  /** Current market regime */
  regime: RegimeKey | string;
  /** Current Maximum Drawdown (0.0 - 1.0) from equity curve */
  currentMDD: number;
  /** Volatility score (0-100) from OmegaEngine or market regime agent */
  volatilityScore: number;
  /** Number of consecutive losing trades */
  consecutiveLosses: number;
}

export interface SizingOutput {
  /** Final adjusted risk fraction (always between MIN_FRACTION and baseRiskFraction) */
  adjustedFraction: number;
  /** Individual multiplier components for transparency */
  regimeMultiplier: number;
  drawdownMultiplier: number;
  volatilityPenalty: number;
  streakPenalty: number;
  /** Human-readable explanation */
  reasoning: string;
}

// ─── Regime Multiplier Map ──────────────────────────────────
// Maps both OmegaEngine regimes (BULL/BEAR/etc) and
// marketRegime agent regimes (trend_up/trend_down/etc)

const REGIME_MULTIPLIERS: Record<string, number> = {
  // OmegaEngine regimes
  BULL: 1.0,
  BEAR: 0.5,
  RANGE: 0.7,
  HIGH_VOL: 0.4,
  TRANSITION: 0.6,
  // marketRegime agent regimes
  trend_up: 1.0,
  trend_down: 0.5,
  range: 0.7,
  volatile: 0.4,
  illiquid: 0.3,    // illiquid = very dangerous, reduce heavily
  unknown: 0.6,
};

/** Absolute minimum risk fraction — never go below this */
const MIN_FRACTION = 0.003; // 0.3%

// ─── Core Logic ─────────────────────────────────────────────

/**
 * Calculate regime-adaptive position size.
 *
 * Formula: adjusted = base × regime × drawdown × volatility × streak
 * Clamped to [MIN_FRACTION, baseRiskFraction]
 */
export function calculateAdaptiveSize(input: SizingInput): SizingOutput {
  // Kill-switch: return base fraction unchanged
  if (DISABLED) {
    return {
      adjustedFraction: input.baseRiskFraction,
      regimeMultiplier: 1.0,
      drawdownMultiplier: 1.0,
      volatilityPenalty: 1.0,
      streakPenalty: 1.0,
      reasoning: 'DISABLED — using base fraction',
    };
  }

  // 1. Regime multiplier
  const regimeMul = REGIME_MULTIPLIERS[input.regime] ?? 0.6;

  // 2. Drawdown multiplier — exponential reduction after 5% MDD
  //    At 5% MDD: mul = 1.0
  //    At 10% MDD: mul = 0.75
  //    At 15% MDD: mul = 0.50
  //    At 20%+ MDD: mul = 0.25 (floor)
  let ddMul = 1.0;
  if (input.currentMDD > 0.05) {
    ddMul = Math.max(0.25, 1.0 - (input.currentMDD - 0.05) * 5);
  }

  // 3. Volatility penalty — reduce if volatility > 70 (out of 100)
  //    Linear reduction: vol=70 → 1.0, vol=100 → 0.7
  let volPenalty = 1.0;
  if (input.volatilityScore > 70) {
    volPenalty = Math.max(0.3, 1.0 - (input.volatilityScore - 70) / 100);
  }

  // 4. Streak penalty — reduce 15% per consecutive loss after 2
  //    2 losses: mul = 0.85
  //    3 losses: mul = 0.70
  //    4+ losses: mul = 0.55 (floor at 0.3)
  let streakMul = 1.0;
  if (input.consecutiveLosses >= 2) {
    streakMul = Math.max(0.3, 1.0 - (input.consecutiveLosses - 1) * 0.15);
  }

  // 5. Combine all multipliers
  const raw = input.baseRiskFraction * regimeMul * ddMul * volPenalty * streakMul;

  // Clamp: never go above base, never go below MIN_FRACTION
  const adjusted = Math.max(MIN_FRACTION, Math.min(input.baseRiskFraction, raw));

  const reasoning = [
    `regime=${input.regime}(×${regimeMul.toFixed(2)})`,
    `mdd=${(input.currentMDD * 100).toFixed(1)}%(×${ddMul.toFixed(2)})`,
    `vol=${input.volatilityScore.toFixed(0)}(×${volPenalty.toFixed(2)})`,
    `streak=${input.consecutiveLosses}(×${streakMul.toFixed(2)})`,
    `→ ${(adjusted * 100).toFixed(2)}%`,
  ].join(' | ');

  if (adjusted < input.baseRiskFraction * 0.9) {
    log.info(`[AdaptiveSizing] REDUCED: ${reasoning}`);
  }

  return {
    adjustedFraction: adjusted,
    regimeMultiplier: regimeMul,
    drawdownMultiplier: ddMul,
    volatilityPenalty: volPenalty,
    streakPenalty: streakMul,
    reasoning,
  };
}
