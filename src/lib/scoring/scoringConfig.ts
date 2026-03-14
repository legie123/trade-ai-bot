// ============================================================
// Scoring Configuration — tunable weights
// ============================================================
import { ScoringWeights } from '@/lib/types';

export const SCORING_WEIGHTS: ScoringWeights = {
  deal: {
    liquidityQuality: 20,
    volumeAcceleration: 18,
    buySellImbalance: 15,
    priceVelocity: 12,
    boostConfirmation: 8,
    walletQuality: 8,
    executionViability: 7,
    launchFreshness: 7,
    multiProviderPresence: 5,
  },
  risk: {
    rugcheckWarnings: 25,
    lowLiquidity: 20,
    abnormalConcentration: 15,
    suspiciousVolume: 15,
    postLaunchSells: 10,
    fakeBoost: 10,
    unstablePool: 5,
  },
  conviction: {
    confidenceMultiplier: 1.2,
  },
};
