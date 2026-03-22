// ============================================================
// Composite Score Engine
// Final Score = ML Score × Market Regime × Liquidity × Volatility
// Each factor is 0-1 normalized, final is 0-100
// ============================================================
import { DecisionSnapshot } from '@/lib/types/radar';
import { getDecisions } from '@/lib/store/db';
import { scoreSignal, MLScore } from '@/lib/engine/mlFilter';

export interface CompositeFactors {
  mlScore: number;           // 0-1 normalized ML score
  marketRegime: number;      // 0-1 (1 = clear trend, 0 = choppy)
  liquidity: number;         // 0-1 (1 = high volume/liquidity)
  volatility: number;        // 0-1 (1 = optimal vol, 0 = extreme)
}

export interface CompositeResult {
  finalScore: number;        // 0-100
  factors: CompositeFactors;
  breakdown: string[];
  humanReadable: {
    mlText: string;
    regimeText: string;
    liquidityText: string;
    volatilityText: string;
  };
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  tradeable: boolean;
  ml: MLScore;
  strategyUsed: string;
}

// ─── Identify the primary strategy used ────────────────
function identifyStrategy(decision: DecisionSnapshot): string {
  const { ema50, ema200, dailyOpen, price, signal } = decision;

  if (ema50 && ema200) {
    if ((signal === 'BUY' || signal === 'LONG') && ema50 > ema200) return 'Bullish EMA Cross Confirmation';
    if ((signal === 'SELL' || signal === 'SHORT') && ema50 < ema200) return 'Bearish EMA Cross Confirmation';
    if (signal === 'BUY' && price > ema200) return 'Trend Continuation Breakout';
  }

  if (dailyOpen && price) {
    if (signal === 'BUY' && price > dailyOpen) return 'Daily Open Reclaim';
    if (signal === 'SELL' && price < dailyOpen) return 'Daily Open Rejection';
  }

  return 'Momentum & Trend Following'; // Fallback
}

// ─── Market Regime Detection ───────────────────────
// Measures trend clarity from EMA alignment + price structure
function detectMarketRegime(decision: DecisionSnapshot): { score: number; label: string } {
  const { ema50, ema200, ema800, price, dailyOpen } = decision;
  let alignment = 0;
  let total = 0;

  // EMA stack check (50 > 200 > 800 = perfect uptrend, reverse = downtrend)
  if (ema50 && ema200 && ema800) {
    total += 3;
    const bullStack = ema50 > ema200 && ema200 > ema800;
    const bearStack = ema50 < ema200 && ema200 < ema800;
    if (bullStack || bearStack) alignment += 3; // Perfect alignment
    else if (ema50 > ema200 || ema50 < ema200) alignment += 1; // Partial
  } else if (ema50 && ema200) {
    total += 2;
    alignment += 1; // Some data
  }

  // Price vs Daily Open as intraday bias confirmation
  if (dailyOpen && price) {
    total += 1;
    const isBullish = decision.signal === 'BUY' || decision.signal === 'LONG';
    const priceConfirms = isBullish ? price > dailyOpen : price < dailyOpen;
    if (priceConfirms) alignment += 1;
  }

  // Trend consistency from recent decisions
  const recent = getDecisions()
    .filter(d => d.symbol === decision.symbol)
    .slice(-10);

  if (recent.length >= 5) {
    total += 2;
    const sameSignal = recent.filter(d => d.signal === decision.signal).length;
    const consistency = sameSignal / recent.length;
    alignment += consistency > 0.6 ? 2 : consistency > 0.4 ? 1 : 0;
  }

  const score = total > 0 ? Math.min(1, alignment / total) : 0.5;

  const label = score >= 0.8 ? 'Strong Trend'
    : score >= 0.6 ? 'Moderate Trend'
    : score >= 0.4 ? 'Mixed/Consolidation'
    : 'Choppy/No Trend';

  return { score, label };
}

// ─── Liquidity Assessment ──────────────────────────
// Based on symbol type, confidence, and market depth signals
function assessLiquidity(decision: DecisionSnapshot): { score: number; label: string } {
  // High-cap assets = higher liquidity
  const liquidityTier: Record<string, number> = {
    BTC: 1.0, ETH: 0.95, SOL: 0.85,
    BONK: 0.5, WIF: 0.45, JUP: 0.6, RAY: 0.5,
    JTO: 0.5, PYTH: 0.55, RNDR: 0.65,
  };

  const baseLiquidity = liquidityTier[decision.symbol] || 0.4;

  // Confidence as proxy for signal quality (higher = more market data available)
  const confBoost = decision.confidence >= 85 ? 0.1 : decision.confidence >= 70 ? 0.05 : 0;

  // Check if we have enough historical data for this symbol
  const histCount = getDecisions().filter(d => d.symbol === decision.symbol).length;
  const dataBoost = histCount >= 20 ? 0.1 : histCount >= 10 ? 0.05 : -0.1;

  const score = Math.min(1, Math.max(0, baseLiquidity + confBoost + dataBoost));

  const label = score >= 0.8 ? 'High Liquidity'
    : score >= 0.5 ? 'Moderate Liquidity'
    : 'Low Liquidity (caution)';

  return { score, label };
}

// ─── Volatility Assessment ─────────────────────────
// Optimal volatility = enough movement to trade, not so much it invalidates signals
function assessVolatility(decision: DecisionSnapshot): { score: number; label: string } {
  const decisions = getDecisions().filter(d => d.symbol === decision.symbol);

  if (decisions.length < 5) {
    return { score: 0.5, label: 'Insufficient data' };
  }

  // Calculate recent price range as % 
  const prices = decisions.slice(-20).map(d => d.price);
  let sumRange = 0;
  for (let i = 1; i < prices.length; i++) {
    sumRange += Math.abs(prices[i] - prices[i - 1]) / prices[i - 1];
  }
  const avgMove = sumRange / (prices.length - 1); // avg move per decision

  // Optimal volatility: 0.5% - 3% moves per timeframe
  // Too low (<0.2%) = not enough movement
  // Optimal (0.5-2%) = tradeable
  // Too high (>5%) = erratic, signals unreliable
  let score: number;
  if (avgMove < 0.002) {
    score = 0.3; // Too calm
  } else if (avgMove < 0.005) {
    score = 0.6; // Warming up
  } else if (avgMove <= 0.02) {
    score = 1.0; // Sweet spot
  } else if (avgMove <= 0.05) {
    score = 0.7; // Getting volatile
  } else {
    score = 0.3; // Too volatile
  }

  const label = score >= 0.9 ? 'Optimal Volatility'
    : score >= 0.6 ? 'Acceptable Volatility'
    : avgMove < 0.003 ? 'Low Volatility'
    : 'High Volatility (risky)';

  return { score, label };
}

// ─── Composite Score Calculator ────────────────────
export function calculateCompositeScore(decision: DecisionSnapshot): CompositeResult {
  // 1. ML Score
  const ml = scoreSignal(decision);
  const mlNorm = ml.score / 100; // normalize to 0-1

  // 2. Market Regime
  const regime = detectMarketRegime(decision);

  // 3. Liquidity
  const liq = assessLiquidity(decision);

  // 4. Volatility
  const vol = assessVolatility(decision);

  // Composite: ML × Regime × Liquidity × Volatility
  const rawComposite = mlNorm * regime.score * liq.score * vol.score;

  // Scale to 0-100
  const finalScore = Math.round(rawComposite * 100);

  // Grade
  const grade: CompositeResult['grade'] =
    finalScore >= 85 ? 'A+' :
    finalScore >= 70 ? 'A' :
    finalScore >= 55 ? 'B' :
    finalScore >= 40 ? 'C' :
    finalScore >= 25 ? 'D' : 'F';

  const strategyUsed = identifyStrategy(decision);

  const humanReadable = {
    mlText: `ML Output: ${ml.verdict} (${ml.score}%) — ${ml.reasons[0] || 'Pattern match'}`,
    regimeText: `Regime: ${regime.label} [${(regime.score * 100).toFixed(0)}%]`,
    liquidityText: `Liquidity: ${liq.label} [${(liq.score * 100).toFixed(0)}%]`,
    volatilityText: `Volatility: ${vol.label} [${(vol.score * 100).toFixed(0)}%]`,
  };

  const breakdown = [
    `Strategy: ${strategyUsed}`,
    humanReadable.mlText,
    humanReadable.regimeText,
    humanReadable.liquidityText,
    humanReadable.volatilityText,
    `─────────────────────`,
    `Final Composite: ${finalScore}% (Grade: ${grade})`,
  ];

  return {
    finalScore,
    factors: {
      mlScore: mlNorm,
      marketRegime: regime.score,
      liquidity: liq.score,
      volatility: vol.score,
    },
    breakdown,
    humanReadable,
    grade,
    tradeable: finalScore >= 40 && grade !== 'F' && grade !== 'D',
    ml,
    strategyUsed,
  };
}

// ─── Batch score recent decisions ──────────────────
export function scoreRecentComposite(limit = 10): (CompositeResult & { symbol: string; signal: string; price: number })[] {
  const pending = getDecisions()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  return pending.map(d => ({
    ...calculateCompositeScore(d),
    symbol: d.symbol,
    signal: d.signal,
    price: d.price,
  }));
}
