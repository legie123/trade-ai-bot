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
function getEdgeFloor(division?: string): number {
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
const MAX_PRICE_HISTORY = 100;
const PRICE_HISTORY_KEY_PREFIX = 'poly_ph_';

// ─── Scan single division ────────────────────────────────
export async function scanDivision(
  division: PolyDivision,
  limit = 20,
): Promise<PolyScanResult> {
  const markets = await getMarketsByCategory(division, limit);
  const floor = getEdgeFloor(division);

  // STALE DATA GUARD 2026-05-02 — skip expired markets.
  // Gamma API occasionally returns markets past endDate with active=true/closed=false
  // (sync lag). Filter here to prevent bets on stale opportunities (audit observed
  // QatarEnergy with endDate 2026-04-30 appearing ACTIVE on 2026-05-03).
  // Kill-switch: POLY_SKIP_EXPIRED=0 reverts to permissive (legacy).
  const skipExpired = process.env.POLY_SKIP_EXPIRED !== '0';
  const nowMs = Date.now();

  const opportunities: PolyOpportunity[] = [];
  let expiredSkipped = 0;

  for (const market of markets) {
    if (!market.active || market.closed) continue;
    if (!market.outcomes || market.outcomes.length < 2) continue;

    if (skipExpired) {
      const endMs = new Date(market.endDate).getTime();
      if (!Number.isFinite(endMs) || endMs <= nowMs) {
        expiredSkipped++;
        continue;
      }
    }

    const opp = await evaluateOpportunity(market, division);
    if (opp.edgeScore >= floor) {
      opportunities.push(opp);
    }
  }

  if (expiredSkipped > 0) {
    log.warn('Skipped expired markets', { division, count: expiredSkipped });
  }

  opportunities.sort((a, b) => b.edgeScore - a.edgeScore);

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

  for (let i = 0; i < divisions.length; i += 4) {
    const batch = divisions.slice(i, i + 4);
    const batchResults = await Promise.allSettled(
      batch.map(d => scanDivision(d, limit)),
    );
    for (const result of batchResults) {
      if (result.status === 'fulfilled') results.push(result.value);
    }
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
  const [momentum, spread] = await Promise.all([
    scoreMomentum(market),
    scoreOrderBookSpread(market),
  ]);
  const liquidity = scoreLiquidity(market);
  const timeDecay = scoreTimeDecay(market);

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

function scoreMispricing(market: PolyMarket): number {
  const outcomes = market.outcomes;
  if (outcomes.length < 2) return 0;
  const yesPrice = outcomes[0].price;
  const vol = market.volume24h || 0;
  let score = 0;
  if (yesPrice < 0.1 || yesPrice > 0.9) score += 45;
  else if (yesPrice < 0.15 || yesPrice > 0.85) score += 35;
  else if (yesPrice < 0.2 || yesPrice > 0.8) score += 25;
  if (yesPrice > 0.35 && yesPrice < 0.65 && vol > 10000) score += 30;
  else if (yesPrice > 0.35 && yesPrice < 0.65 && vol > 5000) score += 20;
  if (yesPrice < 0.15 || yesPrice > 0.85) score += 15;
  if (vol > 50000 && (yesPrice < 0.2 || yesPrice > 0.8)) score += 20;
  return Math.min(100, score);
}

function scoreVolumeAnomaly(market: PolyMarket): number {
  const vol = market.volume24h || 0;
  if (vol > 100000) return 100;
  if (vol > 50000) return 80;
  if (vol > 10000) return 60;
  if (vol > 5000) return 45;
  if (vol > 1000) return 30;
  if (vol > 100) return 15;
  return 0;
}

async function scoreMomentum(market: PolyMarket): Promise<number> {
  const vol = market.volume24h || 0;
  let score = 0;
  try {
    const history = await getPriceHistory(market.id, 24);
    if (history.length >= 2) {
      const current = history[history.length - 1];
      const previous = history[Math.max(0, history.length - 2)];
      const priceChange = current.price - previous.price;
      const timeElapsed = (current.ts - previous.ts) / (1000 * 60 * 60);
      if (timeElapsed > 0) {
        const velocity = priceChange / timeElapsed;
        if (Math.abs(velocity) > 0.05) score += 50;
        else if (Math.abs(velocity) > 0.02) score += 35;
        else if (Math.abs(velocity) > 0.01) score += 20;
        if (vol > 10000 && Math.abs(velocity) > 0.01) score += 25;
        else if (vol > 5000 && Math.abs(velocity) > 0.005) score += 15;
      }
    } else {
      if (vol > 50000) score += 40;
      else if (vol > 20000) score += 30;
      else if (vol > 5000) score += 15;
    }
  } catch (error) {
    log.warn(`Failed to get price history for ${market.id}, using volume fallback`, { error });
    if (vol > 50000) score += 40;
    else if (vol > 20000) score += 30;
    else if (vol > 5000) score += 15;
  }
  const hoursToExpiry = (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursToExpiry < 48 && vol > 5000) score += 20;
  if (hoursToExpiry < 12 && vol > 10000) score += 25;
  return Math.min(100, score);
}

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

function scoreTimeDecay(market: PolyMarket): number {
  const hoursToExpiry = (new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursToExpiry < 0) return 0;
  if (hoursToExpiry < 6) return 90;
  if (hoursToExpiry < 24) return 70;
  if (hoursToExpiry < 72) return 50;
  if (hoursToExpiry < 168) return 30;
  return 15;
}

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

function determineRecommendation(
  market: PolyMarket,
  edgeScore: number,
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH',
): 'BUY_YES' | 'BUY_NO' | 'SKIP' {
  if (edgeScore < getEdgeFloor() || riskLevel === 'HIGH') return 'SKIP';

  // STRATEGY FLIP 2026-05-02 — momentum (default).
  // KILL-SWITCH: POLY_STRATEGY_MODE=contrarian|skip-all|momentum
  const mode = (process.env.POLY_STRATEGY_MODE || 'momentum').toLowerCase();
  if (mode === 'skip-all') return 'SKIP';

  const yesPrice = market.outcomes[0]?.price || 0.5;

  if (mode === 'contrarian') {
    if (yesPrice < 0.4) return 'BUY_YES';
    if (yesPrice > 0.6) return 'BUY_NO';
    return 'SKIP';
  }

  if (yesPrice >= 0.6) return 'BUY_YES';
  if (yesPrice <= 0.4) return 'BUY_NO';
  return 'SKIP';
}

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

async function scoreOrderBookSpread(market: PolyMarket): Promise<number> {
  try {
    const orderBook = await getOrderBook(market.id);
    if (!orderBook || !orderBook.bids?.length || !orderBook.asks?.length) return 30;
    const bestBid = orderBook.bids[0]?.[0] || 0;
    const bestAsk = orderBook.asks[0]?.[0] || 1;
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
    const spread = bestAsk - bestBid;
    const mid = (bestBid + bestAsk) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    let score = 30;
    if (spreadPct > 5) score += 40;
    else if (spreadPct > 2) score += 30;
    else if (spreadPct > 1) score += 15;
    else if (spreadPct < 0.5) score -= 10;
    return Math.min(100, Math.max(0, score));
  } catch (error) {
    log.warn(`Failed to get order book for ${market.id}`, { error });
    return 30;
  }
}

async function storePriceSnapshot(
  marketId: string,
  yesPrice: number,
  volume24h: number,
): Promise<void> {
  try {
    const key = `${PRICE_HISTORY_KEY_PREFIX}${marketId}`;
    const now = Date.now();
    const snapshot = { price: yesPrice, volume: volume24h, ts: now };
    const { data, error: fetchError } = await supabase
      .from('json_store').select('value').eq('key', key).single();
    if (fetchError && fetchError.code !== 'PGRST116') {
      log.warn(`Failed to fetch price history for ${marketId}`, { error: fetchError });
      return;
    }
    let history = data?.value as Array<{ price: number; volume: number; ts: number }> || [];
    history.push(snapshot);
    if (history.length > MAX_PRICE_HISTORY) history = history.slice(-MAX_PRICE_HISTORY);
    const { error: updateError } = await supabase
      .from('json_store').upsert({ key, value: history }, { onConflict: 'key' });
    if (updateError) log.warn(`Failed to store price history for ${marketId}`, { error: updateError });
  } catch (error) {
    log.warn(`Error storing price snapshot for ${marketId}`, { error });
  }
}

async function getPriceHistory(
  marketId: string,
  hoursBack = 24,
): Promise<Array<{ price: number; volume: number; ts: number }>> {
  try {
    const key = `${PRICE_HISTORY_KEY_PREFIX}${marketId}`;
    const cutoffTime = Date.now() - hoursBack * 1000 * 60 * 60;
    const { data, error } = await supabase
      .from('json_store').select('value').eq('key', key).single();
    if (error) {
      if (error.code === 'PGRST116') return [];
      log.warn(`Failed to fetch price history for ${marketId}`, { error });
      return [];
    }
    const history = data?.value as Array<{ price: number; volume: number; ts: number }> || [];
    return history.filter(entry => entry.ts >= cutoffTime);
  } catch (error) {
    log.warn(`Error retrieving price history for ${marketId}`, { error });
    return [];
  }
}
