import { getDecisions } from '@/lib/store/db';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { DecisionSnapshot } from '@/lib/types/radar';

export const OMEGA_WIN_THRESHOLD = 100;

export interface ForgeStats {
  totalWinsAssimilated: number;
  progressPercent: number;
  extractedBehaviors: Record<string, number>;
  projectedWinRate: number;
  lastAssimilatedSymbol: string | null;
}

/**
 * DNA Extractor reads the battle history of the Top 3 Gladiators.
 * It searches the local DB (`db.json` via getDecisions) to find winning trades
 * and computes the progress towards making the Omega Gladiator ready.
 */
export function extractWinningBehaviors(): ForgeStats {
  const allDecisions = getDecisions();
  
  // Filter for only WIN outcomes from the Top 3 (live) gladiators 
  // In V2, we might not always have gladiator ID attached to decisions from V1, 
  // so we take ALL winning decisions to feed the Omega initially for the bootstrap phase.
  const winningDecisions: DecisionSnapshot[] = allDecisions.filter(d => (d.outcome === 'WIN' && d.pnlPercent && d.pnlPercent > 0.5));

  const totalWinsAssimilated = winningDecisions.length;
  const progressPercent = Math.min(100, Math.round((totalWinsAssimilated / OMEGA_WIN_THRESHOLD) * 100));

  let totalWinRateAcc = 0;
  const extractedBehaviors: Record<string, number> = {};
  
  if (totalWinsAssimilated > 0) {
    winningDecisions.forEach(d => {
      // Analyze what indicator led to this win (EMA alignment, high volume, etc)
      // This is a placeholder for the ML behavior extraction mapping
      if (d.ema50 && d.ema200) {
        if (d.signal === 'BUY' && d.price > d.ema50) {
          extractedBehaviors['BULL_EMA_CONTINUATION'] = (extractedBehaviors['BULL_EMA_CONTINUATION'] || 0) + 1;
        } else if (d.signal === 'SELL' && d.price < d.ema50) {
          extractedBehaviors['BEAR_EMA_REJECTION'] = (extractedBehaviors['BEAR_EMA_REJECTION'] || 0) + 1;
        }
      }
      if (d.confidence > 80) {
        extractedBehaviors['HIGH_CONFIDENCE_GTC'] = (extractedBehaviors['HIGH_CONFIDENCE_GTC'] || 0) + 1;
      }
    });

    // Approximate a projected win rate based on the assimilated strategies
    // Starts at a theoretical 50% and improves as it extracts more behaviors
    totalWinRateAcc = 50 + Math.min(45, (totalWinsAssimilated * 0.45)); // Max 95%
  } else {
    totalWinRateAcc = 0;
  }

  const lastSymbol = winningDecisions.length > 0 ? winningDecisions[winningDecisions.length - 1].symbol : null;

  // Update the global Omega Gladiator Store status
  gladiatorStore.updateOmegaProgress(progressPercent, {
    winRate: totalWinRateAcc,
    totalTrades: totalWinsAssimilated,
  });

  return {
    totalWinsAssimilated,
    progressPercent,
    extractedBehaviors,
    projectedWinRate: totalWinRateAcc,
    lastAssimilatedSymbol: lastSymbol
  };
}
