// ============================================================
// Polymarket Scanner — Edge detection & opportunity ranking
// Mispricing (35%) + Momentum (25%) + Volume (20%) + Liquidity (15%) + TimeDecay (5%)
// ============================================================

import { PolyMarket, PolyDivision, PolyOpportunity, PolyScanResult } from './polyTypes';
import { getMarketsByCategory } from './polyClient';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('MarketScanner');

const EDGE_THRESHOLD = 40; // Minimum composite score to flag opportunity

// ─── Scan single division ────────────────────────────────
export async function scanDivision(
  division: PolyDivision,
  limit = 20,
): Promise<PolyScanResult> {
  const markets = await getMarketsByCategory(division, limit);

  const opportunities: PolyOpportunity[] = [];

  for (const market of markets) {
    if (!market.active || market.closed) continue;
    if (!market.outcomes || market.outcomes.length < 2) continue;

    const opp = evaluateOpportunity(market, division);
    if (opp.edgeScore >= EDGE_THRESHOLD) {
      opportunities.push(opp);
    }
  }

  // Sort by edge score descending
  opportunities.sort((a, b) => b.edgeScore - a.edgeScore);

  return {
    division,
    scannedAt: new Date().toISOString(),
    totalMarkets: markets.length,
    opportunities,
    topPick: opportunities[0] || null,
  };
}

// ─── Scan all divisions ──────────────────────────────────
export async function scanAllDivisions(limit = 10): Promise<PolyScanResult[]> {
  const divisions = Object.values(PolyDivision);
  const results: PolyScanResult[] = [];

  // Process in batches of 4 to avoid rate limiting
  for (let i = 0; i < divisions.length; i += 4) {
    const batch = divisions.slice(i, i + 4);
    const batchResults = await Promise.allSettled(
      batch.map(d => scanDivision(d, limit)),
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    // Brief pause between batches
    if (i + 4 < divisions.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}

// ─── Evaluate single market opportunity ───────────────────
function evaluateOpportunity(market: PolyMarket, division: PolyDivision): PolyOpportunity {
  const mispricing = scoreMispricing(market);
  const volume = scoreVolumeAnomaly(market);
  const momentum = scoreMomentum(market);
  const liquidity = scoreLiquidity(market);
  const timeDecay = scoreTimeDecay(market);

  // Weighted composite
  const edgeScore = Math.round(
    mispricing * 0.35 +
    momentum * 0.25 +
    volume * 0.20 +
    liquidity * 0.15 +
    timeDecay * 0.05,
  );

  const riskLevel = classifyRisk(edgeScore, liquidity, market);
  const recommendation = determineRecommendation(market, edgeScore, riskLevel);

  return {
    marketId: market.id,
    market,
    division,
    edgeScore,
    mispricingScore: mispricing,
    volumeAnomalyScore: volume,
    momentumScore: momentum,
    liquidityScore: liquidity,
    timeDecayScore: timeDecay,
    riskLevel,
    recommendation,
    reasoning: buildReasoning(market, edgeScore, mispricing, momentum, volume),
  };
}

// ─── Mispricing detector (35% weight) ─────────────────────
function scoreMispricing(market: PolyMarket): number {
  const outcomes = market.outcomes;
  if (outcomes.length < 2) return 0;

  const yesPrice = outcomes[0].price;
  const noPrice = outcomes[1]?.price || (1 - yesPrice);

  // Sum of probabilities should be ~1.0 (vig causes >1.0)
  const totalProb = yesPrice + noPrice;
  const vig = Math.abs(totalProb - 1.0);

  // Large vig = mispricing opportunity
  let score = 0;
  if (vig > 0.05) score += 40; // Significant spread
  else if (vig > 0.02) score += 20;

  // Extreme probabilities often mispriced
  if (yesPrice < 0.1 || yesPrice > 0.9) score += 30; // Tail events
  else if (yesPrice < 0.25 || yesPrice > 0.75) score += 15;

  // Mid-range with high volume often means uncertainty = opportunity
  if (yesPrice > 0.35 && yesPrice < 0.65 && (market.volume24h || 0) > 5000) {
    score += 20;
  }

  return Math.min(100, score);
}

// ─── Volume anomaly (20% weight) ──────────────────────────
function scoreVolumeAnomaly(market: PolyMarket): number {
  const vol = market.volume24h || 0;

  if (vol > 100000) return 100; // Very high volume
  if (vol > 50000) return 80;
  if (vol > 10000) return 60;
  if (vol > 5000) return 45;
  if (vol > 1000) return 30;
  if (vol > 100) return 15;
  return 0;
}

// ─── Momentum (25% weight) ────────────────────────────────
function scoreMomentum(market: PolyMarket): number {
  // Without historical prices we use volume + price distance from 0.5
  const yesPrice = market.outcomes[0]?.price || 0.5;
  const vol = market.volume24h || 0;

  // Strong directional move = high momentum
  const priceDistance = Math.abs(yesPrice - 0.5);
  let score = 0;

  if (priceDistance > 0.35) score += 40; // Very directional
  else if (priceDistance > 0.2) score += 25;
  else if (priceDistance > 0.1) score += 15;

  // Volume confirms momentum
  if (vol > 10000 && priceDistance > 0.15) score += 30;
  else if (vol > 5000 && priceDistance > 0.1) score += 20;
  else if (vol > 1000) score += 10;

  // Close to expiry with strong direction = late momentum
  const hoursToExpiry = (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursToExpiry < 48 && priceDistance > 0.25) score += 20;

  return Math.min(100, score);
}

// ─── Liquidity (15% weight) ───────────────────────────────
function scoreLiquidity(market: PolyMarket): number {
  const liq = market.liquidityUSD || 0;

  if (liq > 100000) return 100;
  if (liq > 50000) return 85;
  if (liq > 20000) return 70;
  if (liq > 10000) return 55;
  if (liq > 5000) return 40;
  if (liq > 1000) return 25;
  return 10;
}

// ─── Time decay (5% weight) ──────────────────────────────
function scoreTimeDecay(market: PolyMarket): number {
  const hoursToExpiry = (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60);

  if (hoursToExpiry < 0) return 0; // Expired
  if (hoursToExpiry < 6) return 90; // Extreme time pressure
  if (hoursToExpiry < 24) return 70;
  if (hoursToExpiry < 72) return 50;
  if (hoursToExpiry < 168) return 30; // 1 week
  return 15;
}

// ─── Risk classification ──────────────────────────────────
function classifyRisk(
  edgeScore: number,
  liquidityScore: number,
  market: PolyMarket,
): 'LOW' | 'MEDIUM' | 'HIGH' {
  const hoursToExpiry = (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60);

  if (liquidityScore < 25 || hoursToExpiry < 2) return 'HIGH';
  if (edgeScore > 70 && liquidityScore > 50) return 'LOW';
  return 'MEDIUM';
}

// ─── Determine recommendation ─────────────────────────────
function determineRecommendation(
  market: PolyMarket,
  edgeScore: number,
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH',
): 'BUY_YES' | 'BUY_NO' | 'SKIP' {
  if (edgeScore < EDGE_THRESHOLD || riskLevel === 'HIGH') return 'SKIP';

  const yesPrice = market.outcomes[0]?.price || 0.5;

  if (yesPrice < 0.4) return 'BUY_YES';
  if (yesPrice > 0.6) return 'BUY_NO';
  return 'SKIP';
}

// ─── Build human-readable reasoning ───────────────────────
function buildReasoning(
  market: PolyMarket,
  edgeScore: number,
  mispricing: number,
  momentum: number,
  volume: number,
): string {
  const parts: string[] = [];
  if (mispricing > 50) parts.push(`Strong mispricing(${mispricing})`);
  if (momentum > 50) parts.push(`High momentum(${momentum})`);
  if (volume > 60) parts.push(`Volume surge(${volume})`);
  if (parts.length === 0) parts.push(`Moderate edge`);
  return `Edge ${edgeScore}/100 — ${parts.join(', ')} on "${market.title?.slice(0, 60)}"`;
}
