// ============================================================
// Risk Score Calculator
// ============================================================
import { NormalizedToken } from '@/lib/types';
import { SCORING_WEIGHTS } from './scoringConfig';

/**
 * Calculate risk score (0–100) based on negative signals.
 */
export function calculateRiskScore(token: NormalizedToken): number {
  const w = SCORING_WEIGHTS.risk;
  let score = 0;
  let maxScore = 0;

  // 1. Rugcheck warnings
  maxScore += w.rugcheckWarnings;
  if (token.rugWarnings.length > 0) {
    const warningPenalty = Math.min(token.rugWarnings.length / 5, 1);
    score += w.rugcheckWarnings * warningPenalty;
  }
  if (token.rugRisk === 'critical') score += w.rugcheckWarnings * 0.5;
  else if (token.rugRisk === 'high') score += w.rugcheckWarnings * 0.3;

  // 2. Low liquidity
  maxScore += w.lowLiquidity;
  if (token.liquidity !== null) {
    if (token.liquidity < 1_000) score += w.lowLiquidity;
    else if (token.liquidity < 5_000) score += w.lowLiquidity * 0.7;
    else if (token.liquidity < 10_000) score += w.lowLiquidity * 0.3;
  } else {
    score += w.lowLiquidity * 0.5; // Unknown liquidity is risky
  }

  // 3. Abnormal concentration (few holders = risky)
  maxScore += w.abnormalConcentration;
  if (token.holders !== null) {
    if (token.holders < 10) score += w.abnormalConcentration;
    else if (token.holders < 50) score += w.abnormalConcentration * 0.6;
    else if (token.holders < 100) score += w.abnormalConcentration * 0.3;
  }

  // 4. Suspicious volume (volume >> liquidity ratio)
  maxScore += w.suspiciousVolume;
  if (token.volume24h !== null && token.liquidity !== null && token.liquidity > 0) {
    const volLiqRatio = token.volume24h / token.liquidity;
    if (volLiqRatio > 100) score += w.suspiciousVolume;
    else if (volLiqRatio > 50) score += w.suspiciousVolume * 0.7;
    else if (volLiqRatio > 20) score += w.suspiciousVolume * 0.3;
  }

  // 5. Post-launch sells dominance
  maxScore += w.postLaunchSells;
  if (token.buys5m !== null && token.sells5m !== null) {
    const total = token.buys5m + token.sells5m;
    if (total > 0) {
      const sellRatio = token.sells5m / total;
      if (sellRatio > 0.8) score += w.postLaunchSells;
      else if (sellRatio > 0.65) score += w.postLaunchSells * 0.6;
      else if (sellRatio > 0.55) score += w.postLaunchSells * 0.2;
    }
  }

  // 6. Fake boost (boost without real volume)
  maxScore += w.fakeBoost;
  if (token.boostLevel !== null && token.boostLevel > 0) {
    if (token.volume5m !== null && token.volume5m < 100) {
      score += w.fakeBoost; // Boosted but no volume
    }
  }

  // 7. Unstable pool / no credible route
  maxScore += w.unstablePool;
  if (token.jupiterQuoteQuality !== null && token.jupiterQuoteQuality < 20) {
    score += w.unstablePool;
  } else if (token.poolAddress === null) {
    score += w.unstablePool * 0.5;
  }

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}
