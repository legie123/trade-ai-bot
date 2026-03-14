// ============================================================
// ML Signal Filter — Pattern-based false signal detection
// Uses historical decision data to score new signals
// Logistic regression-like scoring from feature engineering
// ============================================================
import { getDecisions } from '@/lib/store/db';
import { DecisionSnapshot } from '@/lib/types/radar';

export interface MLScore {
  score: number;          // 0-100 (probability of being a winning signal)
  features: FeatureSet;
  verdict: 'STRONG' | 'MODERATE' | 'WEAK' | 'REJECT';
  reasons: string[];
}

interface FeatureSet {
  emaAlignment: number;      // 0 or 1 — EMAs confirm direction
  priceVsDailyOpen: number;  // 0 or 1 — price on right side of daily open
  confidenceNorm: number;    // 0-1 — signal confidence normalized
  hourScore: number;         // 0-1 — historical performance at this hour
  symbolScore: number;       // 0-1 — historical win rate for this symbol
  sourceScore: number;       // 0-1 — historical win rate for this source
  streakScore: number;       // 0-1 — recent streak direction
  volumeContext: number;     // 0-1 — volume/liquidity context
}

// ─── Learned weights (updated via optimizer feedback) ──
const WEIGHTS = {
  emaAlignment: 0.20,
  priceVsDailyOpen: 0.10,
  confidenceNorm: 0.15,
  hourScore: 0.10,
  symbolScore: 0.15,
  sourceScore: 0.10,
  streakScore: 0.10,
  volumeContext: 0.10,
};
const BIAS = 0.3; // baseline score

// ─── Feature extraction ───────────────────────────
function extractFeatures(decision: DecisionSnapshot): FeatureSet {
  const isBullish = decision.signal === 'BUY' || decision.signal === 'LONG';
  const evaluated = getDecisions().filter((d) => d.outcome === 'WIN' || d.outcome === 'LOSS');

  // EMA alignment
  const emaAlignment = decision.ema50 && decision.ema200
    ? (isBullish ? (decision.ema50 > decision.ema200 ? 1 : 0) : (decision.ema50 < decision.ema200 ? 1 : 0))
    : 0.5;

  // Price vs Daily Open
  const priceVsDailyOpen = decision.dailyOpen
    ? (isBullish ? (decision.price > decision.dailyOpen ? 1 : 0) : (decision.price < decision.dailyOpen ? 1 : 0))
    : 0.5;

  // Confidence normalized
  const confidenceNorm = Math.min(decision.confidence / 100, 1);

  // Hour score — win rate at this hour
  const hour = new Date(decision.timestamp).getHours();
  const hourTrades = evaluated.filter((d) => new Date(d.timestamp).getHours() === hour);
  const hourWins = hourTrades.filter((d) => d.outcome === 'WIN').length;
  const hourScore = hourTrades.length >= 3 ? hourWins / hourTrades.length : 0.5;

  // Symbol score
  const symTrades = evaluated.filter((d) => d.symbol === decision.symbol);
  const symWins = symTrades.filter((d) => d.outcome === 'WIN').length;
  const symbolScore = symTrades.length >= 3 ? symWins / symTrades.length : 0.5;

  // Source score
  const srcTrades = evaluated.filter((d) => d.source === decision.source);
  const srcWins = srcTrades.filter((d) => d.outcome === 'WIN').length;
  const sourceScore = srcTrades.length >= 3 ? srcWins / srcTrades.length : 0.5;

  // Streak — recent trades
  const recent = evaluated.slice(-10);
  const recentWins = recent.filter((d) => d.outcome === 'WIN').length;
  const streakScore = recent.length > 0 ? recentWins / recent.length : 0.5;

  // Volume context (approximate from confidence)
  const volumeContext = decision.confidence >= 85 ? 0.8 : decision.confidence >= 70 ? 0.5 : 0.3;

  return {
    emaAlignment,
    priceVsDailyOpen,
    confidenceNorm,
    hourScore,
    symbolScore,
    sourceScore,
    streakScore,
    volumeContext,
  };
}

// ─── Score a decision ──────────────────────────────
export function scoreSignal(decision: DecisionSnapshot): MLScore {
  const features = extractFeatures(decision);

  // Weighted sum (logistic-like)
  let rawScore = BIAS;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    rawScore += (features[key as keyof FeatureSet] || 0) * weight;
  }

  // Sigmoid normalization to 0-100
  const sigmoid = 1 / (1 + Math.exp(-((rawScore - 0.5) * 8)));
  const score = Math.round(sigmoid * 100);

  // Verdict
  const reasons: string[] = [];
  let verdict: MLScore['verdict'] = 'MODERATE';

  if (score >= 75) {
    verdict = 'STRONG';
    reasons.push('High probability winning signal');
  } else if (score >= 55) {
    verdict = 'MODERATE';
    reasons.push('Moderate signal quality');
  } else if (score >= 35) {
    verdict = 'WEAK';
    reasons.push('Low confidence pattern match');
  } else {
    verdict = 'REJECT';
    reasons.push('Pattern suggests false signal');
  }

  // Add specific reasons
  if (features.emaAlignment >= 0.8) reasons.push('EMAs confirm direction');
  if (features.emaAlignment < 0.3) reasons.push('⚠️ EMAs oppose direction');
  if (features.symbolScore >= 0.6) reasons.push(`${decision.symbol} has good history`);
  if (features.symbolScore < 0.3) reasons.push(`⚠️ ${decision.symbol} poor history`);
  if (features.hourScore >= 0.6) reasons.push('Good trading hour');
  if (features.hourScore < 0.3) reasons.push('⚠️ Bad trading hour');

  return { score, features, verdict, reasons };
}

// ─── Batch score recent pending decisions ──────────
export function scoreRecentSignals(limit = 10): (MLScore & { symbol: string; signal: string })[] {
  const pending = getDecisions()
    .filter((d) => d.outcome === 'PENDING')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  return pending.map((d) => ({
    ...scoreSignal(d),
    symbol: d.symbol,
    signal: d.signal,
  }));
}
