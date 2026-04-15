// ============================================================
// Opportunity Ranker — combines all signals into a ranked list
//
// ADDITIVE. Pure scoring function + composable inputs. Consumers:
//   - /api/v2/intelligence/ranking
//   - future Polymarket page Intelligence Panel
//
// Inputs are optional per candidate — weights auto-normalize over
// whichever signals are present. A candidate with only momentum +
// sentiment still ranks; one with full stack obviously ranks higher.
// ============================================================

import { OrderbookIntel } from './orderbookIntel';
import { VolumeIntel } from './volumeIntel';
import { RegimeContext } from './marketRegime';

export interface RankingCandidate {
  id: string;                 // stable id: symbol or market id
  symbol: string;
  sector?: 'CRYPTO' | 'POLYMARKET' | string;
  momentum?: number;          // -1..+1 (recent price change normalized)
  sentimentScore?: number;    // -1..+1 from sentimentAgent
  sentimentCount?: number;
  orderbook?: OrderbookIntel | null;
  volume?: VolumeIntel | null;
  regime?: RegimeContext | null;
  recencyMs?: number;         // age of freshest input
  confidence?: number;        // 0..1 external confidence override
  meta?: Record<string, unknown>;
}

export interface RankedItem {
  id: string;
  symbol: string;
  sector?: string;
  score: number;              // 0..1 composite
  direction: 'up' | 'down' | 'neutral';
  reasons: string[];
  penalties: string[];
  inputs: {
    momentum: number | null;
    sentimentScore: number | null;
    imbalance: number | null;
    liquidity: number | null;
    volumeZ: number | null;
    regime: string | null;
  };
  generatedAt: number;
}

const WEIGHTS = {
  momentum: 0.25,
  sentiment: 0.20,
  orderbook: 0.20,
  volume: 0.15,
  regime: 0.10,
  recency: 0.10,
};

const STALE_MS = Number(process.env.INTEL_RANK_STALE_MS || 5 * 60_000);

function sigmoid01(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function rankCandidate(c: RankingCandidate): RankedItem {
  const reasons: string[] = [];
  const penalties: string[] = [];
  let score = 0;
  let weightSum = 0;
  let directional = 0;

  // Momentum in [-1, 1] → normalized to [0, 1] scalar and direction
  if (typeof c.momentum === 'number' && !Number.isNaN(c.momentum)) {
    const m = Math.max(-1, Math.min(1, c.momentum));
    score += Math.abs(m) * WEIGHTS.momentum;
    directional += m * WEIGHTS.momentum;
    weightSum += WEIGHTS.momentum;
    reasons.push(`momentum=${m.toFixed(3)}`);
  }

  // Sentiment in [-1, 1]
  if (typeof c.sentimentScore === 'number' && !Number.isNaN(c.sentimentScore)) {
    const s = Math.max(-1, Math.min(1, c.sentimentScore));
    // Scale contribution by count so a single article doesn't dominate
    const countWeight = Math.min(1, (c.sentimentCount || 0) / 5);
    score += Math.abs(s) * WEIGHTS.sentiment * countWeight;
    directional += s * WEIGHTS.sentiment * countWeight;
    weightSum += WEIGHTS.sentiment * countWeight;
    reasons.push(`sentiment=${s.toFixed(3)} (n=${c.sentimentCount ?? 0})`);
  }

  // Orderbook
  if (c.orderbook) {
    const ob = c.orderbook;
    const obDirectional = Math.max(-1, Math.min(1, ob.imbalance));
    // Scale magnitude contribution by liquidity
    const contribMag = Math.abs(obDirectional) * ob.liquidityScore;
    score += contribMag * WEIGHTS.orderbook;
    directional += obDirectional * ob.liquidityScore * WEIGHTS.orderbook;
    weightSum += WEIGHTS.orderbook;
    reasons.push(`ob.imbalance=${ob.imbalance} liq=${ob.liquidityScore}`);
    if (ob.regimeHint === 'thin') penalties.push('thin liquidity');
    if (ob.spreadPct > 0.01) penalties.push(`wide spread ${(ob.spreadPct * 100).toFixed(2)}%`);
  }

  // Volume
  if (c.volume) {
    const v = c.volume;
    const vScore = sigmoid01(v.zScore);        // 0..1 (centered at 0)
    // Volume is directional-neutral; bonus magnitude only when spike/elevated
    const mag = v.regime === 'spike' ? 1 : v.regime === 'elevated' ? 0.6 : 0.2;
    score += mag * WEIGHTS.volume;
    weightSum += WEIGHTS.volume;
    reasons.push(`vol.z=${v.zScore} regime=${v.regime}`);
    if (v.regime === 'drought') penalties.push('volume drought');
    void vScore;
  }

  // Regime
  if (c.regime) {
    const r = c.regime;
    let regMag = 0;
    let regDir = 0;
    if (r.regime === 'trend_up') { regMag = 0.8; regDir = +0.8; }
    else if (r.regime === 'trend_down') { regMag = 0.8; regDir = -0.8; }
    else if (r.regime === 'volatile') { regMag = 0.4; }
    else if (r.regime === 'range') { regMag = 0.2; }
    else if (r.regime === 'illiquid') { penalties.push('illiquid regime'); }
    score += regMag * WEIGHTS.regime;
    directional += regDir * WEIGHTS.regime;
    weightSum += WEIGHTS.regime;
    reasons.push(`regime=${r.regime}`);
  }

  // Recency penalty: if the freshest input is older than STALE_MS, reduce score
  if (typeof c.recencyMs === 'number') {
    const freshFactor = Math.max(0, 1 - c.recencyMs / STALE_MS);
    score += freshFactor * WEIGHTS.recency;
    weightSum += WEIGHTS.recency;
    if (c.recencyMs > STALE_MS) penalties.push(`stale by ${(c.recencyMs / 1000).toFixed(0)}s`);
  }

  // Confidence override multiplier
  const conf = typeof c.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 1;

  const normalized = weightSum > 0 ? score / weightSum : 0;
  const finalScore = Number((normalized * conf).toFixed(4));

  let direction: RankedItem['direction'] = 'neutral';
  if (weightSum > 0) {
    const dnorm = directional / weightSum;
    if (dnorm > 0.05) direction = 'up';
    else if (dnorm < -0.05) direction = 'down';
  }

  return {
    id: c.id,
    symbol: c.symbol,
    sector: c.sector,
    score: finalScore,
    direction,
    reasons,
    penalties,
    inputs: {
      momentum: c.momentum ?? null,
      sentimentScore: c.sentimentScore ?? null,
      imbalance: c.orderbook?.imbalance ?? null,
      liquidity: c.orderbook?.liquidityScore ?? null,
      volumeZ: c.volume?.zScore ?? null,
      regime: c.regime?.regime ?? null,
    },
    generatedAt: Date.now(),
  };
}

export function rankCandidates(cs: RankingCandidate[]): RankedItem[] {
  return cs.map(rankCandidate).sort((a, b) => b.score - a.score);
}
