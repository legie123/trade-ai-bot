/**
 * correlationLayer.ts — Intelligence correlation pentru decizii Polymarket.
 *
 * FAZA 3.3: Completeaza evaluateMarket (edge pur) cu 3 multiplicatori care
 * transforma o decizie oarba intr-una informata cross-source:
 *
 *   finalScore = edge × goldskyConfirm × moltbookKarma × liquiditySanity
 *
 * CONTRACT
 *   - Ieftina pe hot path: pull goldsky e facut DOAR daca cheltuiala merita
 *     (edge >= MIN_EDGE_FOR_GOLDSKY). Altfel stagnam la multiplier=1.
 *   - Fiecare factor este documentat in rationale[] cu: name, value, note.
 *   - Threshold de actiune: finalScore >= ACT_THRESHOLD → phantom bet / live
 *                          finalScore <  ACT_THRESHOLD → log-only (decision
 *                          e scris, actul NU este).
 *
 * ASUMPTII (invalidare → factor = 1.0, neutru)
 *   (1) Goldsky subgraph poate fi unconfigured sau incet → soft-fail la 1.0.
 *   (2) Moltbook karma factor — REPURPOSED Phase 7.1 (2026-05-03).
 *       Original concept "Moltbook market signal" never had backing data
 *       (Moltbook = social net for agents, not a market signal source).
 *       Now uses sentimentAgent (news-driven) gated by POLY_SENTIMENT_KARMA_ENABLED.
 *       Default OFF (1.0) — Phase 5 sample protection.
 *   (3) LiquiditySanity este o poarta strict-hard: liquidity < $500 → 0
 *       (anuleaza scorul, forteaza SKIP chiar daca edge e high).
 *
 * KILL-SWITCHES
 *   POLYMARKET_CORRELATION_ENABLED=0 → neutral (toate 1.0, finalScore = edge)
 *   POLYMARKET_GOLDSKY_CORRELATION=0 → goldskyConfirm=1.0 (celelalte active)
 *   POLY_SENTIMENT_KARMA_ENABLED=0 (default) → moltbookKarma=1.0 (legacy stub)
 *   POLY_SENTIMENT_KARMA_ENABLED=1 → moltbookKarma derived from sentimentAgent
 *   POLY_KARMA_OVERRIDE=<num> → forced override (test-only)
 */

import type { PolyMarket, PolyOpportunity } from './polyTypes';
import type { MarketEvaluation, PolyGladiator } from './polyGladiators';
import { getRecentWhalePositions } from './goldskyClient';
import { sentimentAgent } from '@/lib/v2/intelligence/agents/sentimentAgent';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyCorrelation');

// Thresholds
const MIN_EDGE_FOR_GOLDSKY = Number.parseInt(process.env.POLY_MIN_EDGE_FOR_GOLDSKY ?? '40', 10);
const WHALE_MIN_USD = Number.parseFloat(process.env.POLY_WHALE_MIN_USD ?? '50000');
const ACT_THRESHOLD = Number.parseFloat(process.env.POLY_FINAL_ACT_THRESHOLD ?? '45');

// Phase 7.1 — Sentiment karma calibration.
// Per-symbol weight: ±0.15 (matches polySyndicate SYNDICATE_SENTIMENT_BIAS scale).
// Overall fallback weight: ±0.05 (weaker signal — broad market mood).
const SENTIMENT_PER_SYMBOL_WEIGHT = 0.15;
const SENTIMENT_OVERALL_WEIGHT = 0.05;
const SENTIMENT_MIN_SYMBOL_COUNT = 2;
const SENTIMENT_MIN_OVERALL_COUNT = 5;

export interface RationaleEntry {
  factor: string;
  value: number;
  note: string;
}

export interface CorrelatedDecision {
  direction: MarketEvaluation['direction'];
  confidence: number;
  edgeScore: number;
  goldskyConfirm: number;
  moltbookKarma: number;
  liquiditySanity: number;
  finalScore: number;       // 0 - 100+ (can exceed when multipliers >1)
  shouldAct: boolean;
  skipReason?: string;
  rationale: RationaleEntry[];
}

// ── Liquidity gate ────────────────────────────────────────────
function computeLiquiditySanity(market: PolyMarket, opportunity?: PolyOpportunity): { value: number; note: string } {
  const liq = market.liquidityUSD || 0;
  const vol = market.volume24h || 0;
  const msTillEnd = new Date(market.endDate).getTime() - Date.now();
  const oppLiq = opportunity?.liquidityScore ?? 50;

  if (liq < 500) return { value: 0, note: `hard-zero: liquidity=${liq.toFixed(0)} < $500` };
  if (oppLiq < 20) return { value: 0, note: `hard-zero: oppLiquidityScore=${oppLiq} < 20` };

  // Soft scoring 0.5 - 1.0
  let s = 0.5;
  if (liq >= 5000) s += 0.15;
  if (liq >= 25000) s += 0.15;
  if (vol >= 1000) s += 0.10;
  if (msTillEnd > 24 * 3600_000) s += 0.10;
  s = Math.min(1.0, s);
  return { value: s, note: `liq=$${liq.toFixed(0)} vol24h=$${vol.toFixed(0)} oppLiq=${oppLiq}` };
}

// ── Goldsky whale confirmation ────────────────────────────────
async function computeGoldskyConfirm(
  conditionId: string | undefined,
  direction: MarketEvaluation['direction'],
  edge: number,
): Promise<{ value: number; note: string }> {
  if (process.env.POLYMARKET_GOLDSKY_CORRELATION === '0') {
    return { value: 1.0, note: 'disabled' };
  }
  if (!conditionId) return { value: 1.0, note: 'no conditionId' };
  if (direction === 'SKIP') return { value: 1.0, note: 'skip-direction' };
  if (edge < MIN_EDGE_FOR_GOLDSKY) {
    return { value: 1.0, note: `edge<${MIN_EDGE_FOR_GOLDSKY} — skip goldsky pull` };
  }

  try {
    const whales = await getRecentWhalePositions(conditionId, WHALE_MIN_USD, 20);
    if (!whales || whales.length === 0) {
      return { value: 1.0, note: 'no whale data' };
    }
    // Outcome index convention (Polymarket binary): 0=YES, 1=NO
    const yesTotal = whales.filter(w => w.outcomeIndex === 0).reduce((a, w) => a + w.sharesUsd, 0);
    const noTotal = whales.filter(w => w.outcomeIndex === 1).reduce((a, w) => a + w.sharesUsd, 0);
    const grand = yesTotal + noTotal;
    if (grand <= 0) return { value: 1.0, note: 'zero whale volume' };

    const yesShare = yesTotal / grand;
    // Boost 1.0 → 1.4 when whales agree strongly (>70%); penalty 1.0 → 0.7 when disagree.
    if (direction === 'BUY_YES') {
      if (yesShare >= 0.7) return { value: 1.4, note: `whales YES ${(yesShare * 100).toFixed(0)}% (boost)` };
      if (yesShare <= 0.3) return { value: 0.7, note: `whales YES only ${(yesShare * 100).toFixed(0)}% (contra)` };
      return { value: 1.0, note: `whales split ${(yesShare * 100).toFixed(0)}%/YES` };
    } else {
      const noShare = 1 - yesShare;
      if (noShare >= 0.7) return { value: 1.4, note: `whales NO ${(noShare * 100).toFixed(0)}% (boost)` };
      if (noShare <= 0.3) return { value: 0.7, note: `whales NO only ${(noShare * 100).toFixed(0)}% (contra)` };
      return { value: 1.0, note: `whales split ${(noShare * 100).toFixed(0)}%/NO` };
    }
  } catch (err) {
    log.warn('goldsky confirm failed', { error: String(err) });
    return { value: 1.0, note: 'goldsky error — neutral' };
  }
}

// ── Moltbook (sentiment) karma — Phase 7.1 ────────────────────
// Repurposed from STUB to sentiment-driven karma using sentimentAgent.
// Per-symbol match (e.g., "BTC reaches 100k?" → lookup BTC sentiment) is
// stronger signal than overall market mood; both gated to avoid spurious
// adjustment from low-count snapshots.
//
// Asumptie critica: market.title contains uppercase ticker tokens for crypto
// markets. For non-crypto markets (politics, sports), no symbol match → falls
// back to overall sentiment which is mostly crypto-news anyway → very weak
// nudge in non-crypto context (intentional: avoid bias).
async function computeMoltbookKarma(market: PolyMarket): Promise<{ value: number; note: string }> {
  const override = process.env.POLY_KARMA_OVERRIDE;
  if (override) {
    const v = Number.parseFloat(override);
    if (Number.isFinite(v)) return { value: v, note: `override=${v}` };
  }

  const ENABLED = process.env.POLY_SENTIMENT_KARMA_ENABLED === '1';
  if (!ENABLED) {
    return { value: 1.0, note: 'sentiment-karma disabled (POLY_SENTIMENT_KARMA_ENABLED=0)' };
  }

  try {
    const snap = await sentimentAgent.getSnapshot();
    const title = (market.title || '').toUpperCase();

    // Try per-symbol match first (strongest signal).
    const matched = snap.bySymbol.find((s) => title.includes(s.symbol));
    if (matched && matched.count >= SENTIMENT_MIN_SYMBOL_COUNT) {
      const adj = matched.aggScore * SENTIMENT_PER_SYMBOL_WEIGHT;
      const karma = Math.max(0.85, Math.min(1.15, 1.0 + adj));
      return {
        value: Number(karma.toFixed(3)),
        note: `sym=${matched.symbol} agg=${matched.aggScore.toFixed(2)} n=${matched.count}`,
      };
    }

    // Fallback to overall mood (weaker signal).
    if (snap.overall.count >= SENTIMENT_MIN_OVERALL_COUNT && Math.abs(snap.overall.aggScore) > 0.1) {
      const adj = snap.overall.aggScore * SENTIMENT_OVERALL_WEIGHT;
      const karma = Math.max(0.95, Math.min(1.05, 1.0 + adj));
      return {
        value: Number(karma.toFixed(3)),
        note: `overall agg=${snap.overall.aggScore.toFixed(2)} n=${snap.overall.count} (weak)`,
      };
    }

    return { value: 1.0, note: 'no sentiment match' };
  } catch (err) {
    log.warn('sentiment karma failed (neutral)', { error: String(err) });
    return { value: 1.0, note: 'sentiment error — neutral' };
  }
}

// ── Main entry ────────────────────────────────────────────────
export async function correlateDecision(
  gladiator: PolyGladiator,
  market: PolyMarket,
  evaluation: MarketEvaluation,
  opportunity?: PolyOpportunity,
): Promise<CorrelatedDecision> {
  const rationale: RationaleEntry[] = [];

  if (process.env.POLYMARKET_CORRELATION_ENABLED === '0') {
    rationale.push({ factor: 'correlation', value: 0, note: 'disabled — pass-through' });
    return {
      direction: evaluation.direction,
      confidence: evaluation.confidence,
      edgeScore: evaluation.edgeScore,
      goldskyConfirm: 1.0,
      moltbookKarma: 1.0,
      liquiditySanity: 1.0,
      finalScore: evaluation.edgeScore,
      shouldAct: evaluation.direction !== 'SKIP' && evaluation.confidence >= 50,
      rationale,
    };
  }

  const liq = computeLiquiditySanity(market, opportunity);
  rationale.push({ factor: 'liquiditySanity', value: liq.value, note: liq.note });

  const karma = await computeMoltbookKarma(market);
  rationale.push({ factor: 'moltbookKarma', value: karma.value, note: karma.note });

  let goldskyConfirm = 1.0;
  let goldskyNote = 'skipped';
  if (liq.value > 0 && evaluation.direction !== 'SKIP') {
    const g = await computeGoldskyConfirm(market.conditionId, evaluation.direction, evaluation.edgeScore);
    goldskyConfirm = g.value;
    goldskyNote = g.note;
  }
  rationale.push({ factor: 'goldskyConfirm', value: goldskyConfirm, note: goldskyNote });

  rationale.push({
    factor: 'divisionExpertise',
    value: gladiator.divisionExpertise,
    note: `${gladiator.division} expertise`,
  });

  const finalScore = evaluation.edgeScore * goldskyConfirm * karma.value * liq.value;

  const shouldAct =
    evaluation.direction !== 'SKIP' &&
    evaluation.confidence >= 50 &&
    liq.value > 0 &&
    finalScore >= ACT_THRESHOLD;

  let skipReason: string | undefined;
  if (evaluation.direction === 'SKIP') skipReason = 'evaluation=SKIP';
  else if (liq.value === 0) skipReason = 'liquidity hard-zero';
  else if (finalScore < ACT_THRESHOLD) skipReason = `finalScore ${finalScore.toFixed(1)} < threshold ${ACT_THRESHOLD}`;

  return {
    direction: evaluation.direction,
    confidence: evaluation.confidence,
    edgeScore: evaluation.edgeScore,
    goldskyConfirm,
    moltbookKarma: karma.value,
    liquiditySanity: liq.value,
    finalScore,
    shouldAct,
    skipReason,
    rationale,
  };
}
