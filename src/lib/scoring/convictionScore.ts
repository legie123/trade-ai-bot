// ============================================================
// Conviction Score Calculator
// ============================================================
import { NormalizedToken } from '@/lib/types';
import { SCORING_WEIGHTS } from './scoringConfig';

/**
 * Conviction = Deal - Risk × confidence multiplier.
 * Confidence is based on cross-provider agreement.
 */
export function calculateConvictionScore(token: NormalizedToken): number {
  const { confidenceMultiplier } = SCORING_WEIGHTS.conviction;

  // Provider agreement ratio (how many providers agree on this token)
  const providerCount = token.sourceOrigin.length;
  const agreementRatio = Math.min(providerCount / 4, 1); // Max at 4 providers

  // Base conviction: deal minus risk
  const base = token.dealScore - token.riskScore;

  // Apply confidence multiplier boosted by provider agreement
  const conviction = base * (1 + (agreementRatio * (confidenceMultiplier - 1)));

  // Clamp to 0–100
  return Math.max(0, Math.min(100, Math.round(conviction + 50)));
}
