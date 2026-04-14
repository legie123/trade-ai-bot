// ============================================================
// Polymarket Gladiator System — Prediction market warriors
// Evaluates markets, makes predictions, tracks phantom bets
// ============================================================

import { Gladiator } from '@/lib/types/gladiator';
import { PolyDivision, PolyMarket, PolyOpportunity } from './polyTypes';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyGladiators');

export interface PolyGladiator extends Gladiator {
  division: PolyDivision;
  specialty: string;
  readinessScore: number; // 0-100, probability of next win
  phantomBets: PolyBet[];
  cumulativeEdge: number; // Sum of mispricing detected
  divisionExpertise: number; // 0-100, depth of knowledge in division
}

export interface PolyBet {
  id: string;
  marketId: string;
  direction: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  outcomeId?: string;
  entryPrice: number; // Probability when bet placed
  currentPrice?: number; // Current market price
  shares?: number;
  pnl?: number;
  confidence: number; // 0-100, how sure gladiator was
  reasoning: string;
  placedAt: string;
  resolvedAt?: string;
  outcome?: 'WIN' | 'LOSS' | 'SKIP';
}

// ─── Spawn new gladiator ──────────────────────────────
export function spawnPolyGladiator(
  division: PolyDivision,
  specialty: string,
  name?: string,
): PolyGladiator {
  const id = `poly-${division.toLowerCase()}-${Date.now()}`;
  return {
    id,
    name: name || `${division} Specialist #${Math.random().toString(36).slice(2, 8)}`,
    arena: 'SWING', // Prediction markets are medium-term
    division,
    specialty,
    rank: Math.floor(Math.random() * 10) + 1, // 1-10
    isLive: false, // Starts in training
    stats: {
      winRate: 0,
      profitFactor: 1.0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      totalTrades: 0,
    },
    status: 'IN_TRAINING',
    trainingProgress: 10,
    phantomBets: [],
    readinessScore: 10, // Low readiness initially
    cumulativeEdge: 0,
    divisionExpertise: 20,
    lastUpdated: Date.now(),
  };
}

// ─── Evaluate market for prediction ────────────────────
export interface MarketEvaluation {
  direction: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  confidence: number; // 0-100
  reasoning: string;
  edgeScore: number; // Mispricing magnitude
}

export function evaluateMarket(
  gladiator: PolyGladiator,
  market: PolyMarket,
  opportunity?: PolyOpportunity,
): MarketEvaluation {
  const isPolitics = gladiator.division === PolyDivision.POLITICS;
  const isCrypto = gladiator.division === PolyDivision.CRYPTO;
  const isBreaking = gladiator.division === PolyDivision.BREAKING;

  // No live market = skip
  if (!market.active) {
    return {
      direction: 'SKIP',
      confidence: 0,
      reasoning: 'Market inactive',
      edgeScore: 0,
    };
  }

  // If opportunity provided, use its scores
  if (opportunity) {
    const totalEdge =
      (opportunity.mispricingScore * 0.35 +
        opportunity.momentumScore * 0.25 +
        opportunity.volumeAnomalyScore * 0.2 +
        opportunity.liquidityScore * 0.15 +
        opportunity.timeDecayScore * 0.05) /
      100;

    const baseConfidence = Math.min(
      95,
      opportunity.edgeScore * 0.7 + gladiator.divisionExpertise * 0.3,
    );

    // Break on liquidity or risk
    if (opportunity.liquidityScore < 20 || opportunity.riskLevel === 'HIGH') {
      return {
        direction: 'SKIP',
        confidence: baseConfidence * 0.5,
        reasoning: `Poor liquidity (${opportunity.liquidityScore}) or high risk`,
        edgeScore: 0,
      };
    }

    const direction = opportunity.recommendation || determineDirection(market);
    return {
      direction,
      confidence: Math.round(baseConfidence),
      reasoning: `${opportunity.mispricingScore} mispricing, ${opportunity.momentumScore} momentum`,
      edgeScore: Math.round(totalEdge * 100),
    };
  }

  // Fallback: evaluate without opportunity data
  const direction = determineDirection(market);

  // Specialty boost
  let confidenceBoost = 0;
  if (isPolitics && market.category?.toLowerCase().includes('politics'))
    confidenceBoost = 15;
  if (isCrypto && market.category?.toLowerCase().includes('crypto'))
    confidenceBoost = 15;
  if (isBreaking && !market.category)
    confidenceBoost = 10; // Breaking news often uncategorized

  const hasLiquidity = (market.liquidityUSD || 0) > 1000;
  const hasVolume = (market.volume24h || 0) > 500;
  const timeToExpiry = new Date(market.endDate).getTime() - Date.now();
  const isDecaying = timeToExpiry < 24 * 60 * 60 * 1000; // < 24h

  let confidence = 40 + gladiator.divisionExpertise * 0.3;
  if (hasLiquidity) confidence += 10;
  if (hasVolume) confidence += 10;
  if (!isDecaying) confidence += 15; // More time = better signal
  confidence += confidenceBoost;

  return {
    direction,
    confidence: Math.min(90, Math.round(confidence)),
    reasoning: `${direction} on ${market.title || 'market'}, liquidity=${hasLiquidity}, volume=${hasVolume}`,
    edgeScore: hasLiquidity && hasVolume ? 50 : 30,
  };
}

// ─── Determine buy/sell direction ──────────────────────
function determineDirection(market: PolyMarket): 'BUY_YES' | 'BUY_NO' | 'SKIP' {
  if (!market.outcomes || market.outcomes.length === 0) return 'SKIP';

  // YES outcome is typically the first
  const yesOutcome = market.outcomes[0];
  const noOutcome = market.outcomes[1];

  if (!yesOutcome || !noOutcome) return 'SKIP';

  // If YES is cheap (<0.4), buy YES. If expensive (>0.6), buy NO.
  const yesPrice = yesOutcome.price;
  if (yesPrice < 0.35) return 'BUY_YES';
  if (yesPrice > 0.65) return 'BUY_NO';

  // Neutral: skip
  return 'SKIP';
}

// ─── Record outcome of phantom bet ────────────────────
export function recordPolyOutcome(
  gladiator: PolyGladiator,
  marketId: string,
  actualOutcome: 'YES' | 'NO' | 'CANCEL',
): void {
  const bet = gladiator.phantomBets.find(b => b.marketId === marketId);
  if (!bet) {
    log.warn('Bet not found for market', { marketId, gladiator: gladiator.id });
    return;
  }

  const isCorrect =
    (bet.direction === 'BUY_YES' && actualOutcome === 'YES') ||
    (bet.direction === 'BUY_NO' && actualOutcome === 'NO');

  const pnl = isCorrect ? 1.0 - bet.entryPrice : -(bet.entryPrice);
  const outcome = actualOutcome === 'CANCEL' ? 'SKIP' : isCorrect ? 'WIN' : 'LOSS';

  bet.outcome = outcome;
  bet.resolvedAt = new Date().toISOString();
  bet.pnl = pnl;

  // Update gladiator stats
  if (outcome !== 'SKIP') {
    gladiator.stats.totalTrades += 1;
    if (outcome === 'WIN') {
      const winRate =
        (gladiator.stats.winRate * (gladiator.stats.totalTrades - 1) + 1) /
        gladiator.stats.totalTrades;
      gladiator.stats.winRate = Math.min(1, winRate);

      // Boost readiness score on wins
      gladiator.readinessScore = Math.min(
        95,
        gladiator.readinessScore + Math.round(bet.confidence * 0.1),
      );
    } else {
      const winRate =
        (gladiator.stats.winRate * (gladiator.stats.totalTrades - 1)) /
        gladiator.stats.totalTrades;
      gladiator.stats.winRate = Math.max(0, winRate);

      // Penalty on losses
      gladiator.readinessScore = Math.max(
        10,
        gladiator.readinessScore - Math.round(bet.confidence * 0.15),
      );
    }
  }

  // Update cumulative edge (only real profit, not abs value of losses)
  gladiator.cumulativeEdge += pnl;

  // Update profit factor (gross wins / gross losses)
  if (outcome === 'WIN') {
    gladiator.stats.grossWins = (gladiator.stats.grossWins || 0) + pnl;
  } else if (outcome === 'LOSS') {
    gladiator.stats.grossLosses = (gladiator.stats.grossLosses || 0) + Math.abs(pnl);
  }
  const grossLosses = gladiator.stats.grossLosses || 0;
  gladiator.stats.profitFactor = grossLosses > 0
    ? parseFloat(((gladiator.stats.grossWins || 0) / grossLosses).toFixed(2))
    : (gladiator.stats.grossWins || 0) > 0 ? 99.0 : 0;

  gladiator.lastUpdated = Date.now();

  log.info('Recorded poly outcome', {
    gladiator: gladiator.id,
    marketId,
    outcome,
    pnl: pnl.toFixed(3),
  });
}

// ─── Leaderboard by division ───────────────────────────
export function getPolyLeaderboard(
  gladiators: PolyGladiator[],
  division?: PolyDivision,
): PolyGladiator[] {
  const filtered = division
    ? gladiators.filter(g => g.division === division)
    : gladiators;

  return filtered.sort((a, b) => {
    // Primary: readiness score
    if (b.readinessScore !== a.readinessScore)
      return b.readinessScore - a.readinessScore;
    // Secondary: cumulative edge
    return b.cumulativeEdge - a.cumulativeEdge;
  });
}

// ─── Promote top gladiator ────────────────────────────
export function promoteToLive(gladiator: PolyGladiator): void {
  if (gladiator.readinessScore >= 60 && gladiator.stats.totalTrades >= 25) {
    gladiator.isLive = true;
    gladiator.status = 'ACTIVE';
    gladiator.rank = Math.max(1, Math.floor(gladiator.readinessScore / 10));
    log.info('Promoted gladiator to live', {
      id: gladiator.id,
      readiness: gladiator.readinessScore,
    });
  }
}

// ─── Retire underperformer ────────────────────────────
export function retireUnderperformer(gladiator: PolyGladiator): void {
  if (
    gladiator.readinessScore < 15 &&
    gladiator.stats.totalTrades >= 20 &&
    gladiator.stats.winRate < 0.3
  ) {
    gladiator.status = 'RETIRED';
    gladiator.isLive = false;
    log.info('Retired underperforming gladiator', {
      id: gladiator.id,
      winRate: gladiator.stats.winRate,
    });
  }
}
