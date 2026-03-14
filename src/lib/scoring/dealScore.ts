// ============================================================
// Deal Score Calculator
// ============================================================
import { NormalizedToken } from '@/lib/types';
import { SCORING_WEIGHTS } from './scoringConfig';

/**
 * Calculate deal score (0–100) based on positive signals.
 */
export function calculateDealScore(token: NormalizedToken): number {
  const w = SCORING_WEIGHTS.deal;
  let score = 0;
  let maxScore = 0;

  // 1. Liquidity quality (> $10k is decent, > $100k is great)
  maxScore += w.liquidityQuality;
  if (token.liquidity !== null) {
    if (token.liquidity >= 100_000) score += w.liquidityQuality;
    else if (token.liquidity >= 50_000) score += w.liquidityQuality * 0.8;
    else if (token.liquidity >= 10_000) score += w.liquidityQuality * 0.5;
    else if (token.liquidity >= 1_000) score += w.liquidityQuality * 0.2;
  }

  // 2. Volume acceleration (5m volume relative to 1h volume)
  maxScore += w.volumeAcceleration;
  if (token.volume5m !== null && token.volume1h !== null && token.volume1h > 0) {
    const ratio = (token.volume5m * 12) / token.volume1h; // annualized 5m vs 1h
    if (ratio > 3) score += w.volumeAcceleration;
    else if (ratio > 2) score += w.volumeAcceleration * 0.8;
    else if (ratio > 1.5) score += w.volumeAcceleration * 0.6;
    else if (ratio > 1) score += w.volumeAcceleration * 0.3;
  } else if (token.volume5m !== null && token.volume5m > 1000) {
    score += w.volumeAcceleration * 0.3;
  }

  // 3. Buy/sell imbalance (more buys = bullish)
  maxScore += w.buySellImbalance;
  if (token.buys5m !== null && token.sells5m !== null) {
    const total = token.buys5m + token.sells5m;
    if (total > 0) {
      const buyRatio = token.buys5m / total;
      if (buyRatio > 0.7) score += w.buySellImbalance;
      else if (buyRatio > 0.6) score += w.buySellImbalance * 0.7;
      else if (buyRatio > 0.5) score += w.buySellImbalance * 0.3;
    }
  }

  // 4. Price velocity (positive short-term momentum)
  maxScore += w.priceVelocity;
  if (token.priceChange5m !== null) {
    if (token.priceChange5m > 20) score += w.priceVelocity;
    else if (token.priceChange5m > 10) score += w.priceVelocity * 0.7;
    else if (token.priceChange5m > 5) score += w.priceVelocity * 0.4;
    else if (token.priceChange5m > 0) score += w.priceVelocity * 0.2;
  }

  // 5. Boost confirmation
  maxScore += w.boostConfirmation;
  if (token.boostLevel !== null && token.boostLevel > 0) {
    score += w.boostConfirmation * Math.min(token.boostLevel / 10, 1);
  }

  // 6. Wallet quality signals
  maxScore += w.walletQuality;
  if (token.smartMoneySignal) score += w.walletQuality * 0.7;
  if (token.freshWalletSignal) score += w.walletQuality * 0.3;

  // 7. Execution viability (Jupiter quote quality)
  maxScore += w.executionViability;
  if (token.jupiterQuoteQuality !== null) {
    score += w.executionViability * (token.jupiterQuoteQuality / 100);
  }

  // 8. Launch freshness (newer = more opportunity)
  maxScore += w.launchFreshness;
  if (token.launchedAt) {
    const ageMinutes = (Date.now() - new Date(token.launchedAt).getTime()) / 60_000;
    if (ageMinutes < 30) score += w.launchFreshness;
    else if (ageMinutes < 60) score += w.launchFreshness * 0.8;
    else if (ageMinutes < 360) score += w.launchFreshness * 0.5;
    else if (ageMinutes < 1440) score += w.launchFreshness * 0.2;
  }

  // 9. Multi-provider presence
  maxScore += w.multiProviderPresence;
  const providerCount = token.sourceOrigin.length;
  score += w.multiProviderPresence * Math.min(providerCount / 4, 1);

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}
