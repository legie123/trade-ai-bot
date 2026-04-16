// ============================================================
// Polymarket Scanner — Edge detection & opportunity ranking
// Mispricing (30%) + Momentum (20%) + Volume (15%) + Liquidity (15%) + Spread (10%) + TimeDecay (10%)
// ============================================================

import { PolyMarket, PolyDivision, PolyOpportunity, PolyScanResult } from './polyTypes';
import { getMarketsByCategory, getOrderBook } from './polyClient';
import { createLogger } from '@/lib/core/logger';
import { supabase } from '@/lib/store/db';
import { computeOrderbookIntel, BookLevel } from '@/lib/v2/intelligence/agents/orderbookIntel';
import { feedOpportunities } from './paperSignalFeeder';
import { getActiveConfigSync, maybeRefresh } from './rankerConfig';

const log = createLogger('MarketScanner');

const EDGE_THRESHOLD_DEFAULT = 40; // Minimum composite score to flag opportunity
// Phase 2 Batch 10: env-driven floor + per-division override.
// POLY_EDGE_THRESHOLD=N         → global floor (else 40)
// POLY_EDGE_THRESHOLD_<DIV>=N   → per-division override (e.g. POLY_EDGE_THRESHOLD_CRYPTO=55)
function getEdgeFloor(division?: string): number {
  // 1. env hard overrides
  if (division) {
    const perDiv = process.env[`POLY_EDGE_THRESHOLD_${division.toUpperCase()}`];
    if (perDiv) {
      const n = Number(perDiv);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
  }
  const global = process.env.POLY_EDGE_THRESHOLD;
  if (global) {
    const n = Number(global);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  // 2. runtime active config (Supabase-backed, promoted via auto-tuner)
  maybeRefresh();
  const active = getActiveConfigSync();
  if (active) {
    if (division) {
      const perDiv = active.perDivision[division.toUpperCase()];
      if (typeof perDiv === 'number' && perDiv >= 0 && perDiv <= 100) return perDiv;
    }
    if (typeof active.global === 'number' && active.global >= 0 && active.global <= 100) {
      return active.global;
    }
  }
  return EDGE_THRESHOLD_DEFAULT;
}
// Back-compat alias for any external import (kept as default constant value)
const EDGE_THRESHOLD = EDGE_THRESHOLD_DEFAULT;
const MAX_PRICE_HISTORY = 100; // Max snapshots per market
const PRICE_HISTORY_KEY_PREFIX = 'poly_ph_'; // Supabase json_store key prefix

// ─── Scan single division ────────────────────────────────
export async function scanDivision(
  division: PolyDivision,
  limit = 20,
): Promise<PolyScanResult> {
  const markets = await getMarketsByCategory(division, limit);
  const floor = getEdgeFloor(division);

  const opportunities: PolyOpportunity[] = [];

  for (const market of markets) {
    if (!market.active || market.closed) continue;
    if (!market.outcomes || market.outcomes.length < 2) continue;

    const opp = await evaluateOpportunity(market, division);
    if (opp.edgeScore >= floor) {
      opportunities.push(opp);
    }
  }

  // Sort by edge score descending
  opportunities.sort((a, b) => b.edgeScore - a.edgeScore);

  // Phase 2 Batch 6: paper signal feeder (opt-in via env, no-op otherwise)
  try { feedOpportunities(opportunities); } catch { /* never blocks scan */ }

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
async function evaluateOpportunity(market: PolyMarket, division: PolyDivision): Promise<PolyOpportunity> {
  const mispricing = scoreMispricing(market);
  const volume = scoreVolumeAnomaly(market);
  const momentum = await scoreMomentum(market);
  const liquidity = scoreLiquidity(market);
  const timeDecay = scoreTimeDecay(market);
  const spread = await scoreOrderBookSpread(market);

  // Weighted composite: mispricing 30%, momentum 20%, volume 15%, liquidity 15%, spread 10%, timeDecay 10%
  const edgeScore = Math.round(
    mispricing * 0.30 +
    momentum * 0.20 +
    volume * 0.15 +
    liquidity * 0.15 +
    spread * 0.10 +
    timeDecay * 0.10,
  );

  const riskLevel = classifyRisk(edgeScore, liquidity, market);
  const recommendation = determineRecommendation(market, edgeScore, riskLevel);

  // Store price snapshot for history tracking
  void storePriceSnapshot(market.id, market.outcomes[0]?.price || 0.5, market.volume24h || 0);

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

// ─── Mispricing detector (30% weight) ─────────────────────
// Real mispricing: compare market price to fair value estimates
function scoreMispricing(market: PolyMarket): number {
  const outcomes = market.outcomes;
  if (outcomes.length < 2) return 0;

  const yesPrice = outcomes[0].price;
  const noPrice = outcomes[1]?.price || (1 - yesPrice);
  const vol = market.volume24h || 0;

  let score = 0;

  // Extreme probabilities (<10% or >90%) are systematically mispriced
  if (yesPrice < 0.1 || yesPrice > 0.9) {
    score += 45; // Tail events command premium
  } else if (yesPrice < 0.15 || yesPrice > 0.85) {
    score += 35;
  } else if (yesPrice < 0.2 || yesPrice > 0.8) {
    score += 25;
  }

  // High volume + mid-range price (35-65%) = genuine uncertainty = trading opportunity
  if (yesPrice > 0.35 && yesPrice < 0.65 && vol > 10000) {
    score += 30; // Market is uncertain despite activity
  } else if (yesPrice > 0.35 && yesPrice < 0.65 && vol > 5000) {
    score += 20;
  }

  // Price far from consensus (0.3-0.7 band) suggests mispricing
  const consensusBand = 0.4; // Fair value usually clusters 0.4-0.6
  if (yesPrice < 0.15 || yesPrice > 0.85) {
    score += 15; // Outside normal distribution
  }

  // Very high volume with price concentration = potential bubble
  if (vol > 50000 && (yesPrice < 0.2 || yesPrice > 0.8)) {
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

// ─── Momentum (20% weight) ────────────────────────────────
// Real momentum: track price velocity from history; gracefully degrade if unavailable
async function scoreMomentum(market: PolyMarket): Promise<number> {
  const yesPrice = market.outcomes[0]?.price || 0.5;
  const vol = market.volume24h || 0;
  let score = 0;

  try {
    // Try to get price history for real momentum calculation
    const history = await getPriceHistory(market.id, 24);

    if (history.length >= 2) {
      // Calculate price velocity: compare current to previous snapshot
      const current = history[history.length - 1];
      const previous = history[Math.max(0, history.length - 2)];

      const priceChange = current.price - previous.price;
      const timeElapsed = (current.ts - previous.ts) / (1000 * 60 * 60); // hours

      if (timeElapsed > 0) {
        const velocity = priceChange / timeElapsed; // price per hour

        // Strong velocity = momentum
        if (Math.abs(velocity) > 0.05) score += 50; // Moving 5+ cents/hour
        else if (Math.abs(velocity) > 0.02) score += 35;
        else if (Math.abs(velocity) > 0.01) score += 20;

        // Direction confirmation: volume should follow
        if (vol > 10000 && Math.abs(velocity) > 0.01) score += 25;
        else if (vol > 5000 && Math.abs(velocity) > 0.005) score += 15;
      }
    } else {
      // Fallback: no history yet, use volume heuristic (not price distance)
      if (vol > 50000) score += 40;
      else if (vol > 20000) score += 30;
      else if (vol > 5000) score += 15;
    }
  } catch (error) {
    log.warn(`Failed to get price history for ${market.id}, using volume fallback`, { error });
    // Graceful degradation: volume-based heuristic
    if (vol > 50000) score += 40;
    else if (vol > 20000) score += 30;
    else if (vol > 5000) score += 15;
  }

  // Late momentum bonus: close to expiry with activity = last-minute moves
  const hoursToExpiry = (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursToExpiry < 48 && vol > 5000) score += 20;
  if (hoursToExpiry < 12 && vol > 10000) score += 25;

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
  // Phase 2 Batch 10: env-driven floor (global only at this call site; per-division
  // override applies at scan filter level since this fn lacks division context).
  if (edgeScore < getEdgeFloor() || riskLevel === 'HIGH') return 'SKIP';

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

// ─── Order book spread scoring (10% weight) ──────────────────
async function scoreOrderBookSpread(market: PolyMarket): Promise<number> {
  try {
    const orderBook = await getOrderBook(market.id);
    if (!orderBook || !orderBook.bids?.length || !orderBook.asks?.length) {
      return 30; // Neutral if no order book data
    }

    // Best bid and ask
    const bestBid = orderBook.bids[0]?.[0] || 0;
    const bestAsk = orderBook.asks[0]?.[0] || 1;

    // ── ADDITIVE (Phase 2 Batch 5): populate orderbookIntel cache ──
    // Pure side-effect. Never throws. Feeds opportunityRanker + IntelligencePanel.
    try {
      const bids: BookLevel[] = (orderBook.bids || []).slice(0, 10).map((b: number[]) => ({
        price: Number(b?.[0] || 0),
        size: Number(b?.[1] || 0),
      })).filter((l) => l.price > 0 && l.size > 0);
      const asks: BookLevel[] = (orderBook.asks || []).slice(0, 10).map((a: number[]) => ({
        price: Number(a?.[0] || 0),
        size: Number(a?.[1] || 0),
      })).filter((l) => l.price > 0 && l.size > 0);
      if (bids.length > 0 && asks.length > 0) {
        computeOrderbookIntel({
          symbol: market.id,
          bids: bids.sort((x, y) => y.price - x.price),
          asks: asks.sort((x, y) => x.price - y.price),
          at: Date.now(),
        });
      }
    } catch (intelErr) {
      log.warn('orderbookIntel cache update failed', { marketId: market.id, error: String(intelErr) });
    }

    // Spread as % of mid-price
    const spread = bestAsk - bestBid;
    const mid = (bestBid + bestAsk) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;

    // Wide spread = higher mispricing potential (less efficient)
    let score = 30; // Baseline neutral

    if (spreadPct > 5) score += 40; // Very wide, inefficient market
    else if (spreadPct > 2) score += 30;
    else if (spreadPct > 1) score += 15;
    else if (spreadPct < 0.5) score -= 10; // Very tight = efficient, less opportunity

    return Math.min(100, Math.max(0, score));
  } catch (error) {
    log.warn(`Failed to get order book for ${market.id}`, { error });
    return 30; // Neutral on error
  }
}

// ─── Store price snapshot to history ──────────────────────────
async function storePriceSnapshot(
  marketId: string,
  yesPrice: number,
  volume24h: number,
): Promise<void> {
  try {
    const key = `${PRICE_HISTORY_KEY_PREFIX}${marketId}`;
    const now = Date.now();
    const snapshot = { price: yesPrice, volume: volume24h, ts: now };

    // Fetch current history
    const { data, error: fetchError } = await supabase
      .from('json_store')
      .select('value')
      .eq('key', key)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine
      log.warn(`Failed to fetch price history for ${marketId}`, { error: fetchError });
      return;
    }

    let history = data?.value as Array<{ price: number; volume: number; ts: number }> || [];

    // Add new snapshot
    history.push(snapshot);

    // Trim to max size (keep newest)
    if (history.length > MAX_PRICE_HISTORY) {
      history = history.slice(-MAX_PRICE_HISTORY);
    }

    // Store back
    const { error: updateError } = await supabase
      .from('json_store')
      .upsert({ key, value: history }, { onConflict: 'key' });

    if (updateError) {
      log.warn(`Failed to store price history for ${marketId}`, { error: updateError });
    }
  } catch (error) {
    log.warn(`Error storing price snapshot for ${marketId}`, { error });
  }
}

// ─── Get price history from storage ──────────────────────────
async function getPriceHistory(
  marketId: string,
  hoursBack = 24,
): Promise<Array<{ price: number; volume: number; ts: number }>> {
  try {
    const key = `${PRICE_HISTORY_KEY_PREFIX}${marketId}`;
    const cutoffTime = Date.now() - hoursBack * 1000 * 60 * 60;

    const { data, error } = await supabase
      .from('json_store')
      .select('value')
      .eq('key', key)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found, return empty array
        return [];
      }
      log.warn(`Failed to fetch price history for ${marketId}`, { error });
      return [];
    }

    const history = data?.value as Array<{ price: number; volume: number; ts: number }> || [];

    // Filter by time window
    return history.filter(entry => entry.ts >= cutoffTime);
  } catch (error) {
    log.warn(`Error retrieving price history for ${marketId}`, { error });
    return [];
  }
}
