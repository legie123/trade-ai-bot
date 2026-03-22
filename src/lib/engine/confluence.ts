// ============================================================
// Multi-Timeframe Confluence — scores signals across timeframes
// A signal confirmed on 3+ TFs gets 2× confidence boost
// ============================================================
import { CoinAnalysis } from '@/lib/engine/solanaEngine';
import { AnalysisResult } from '@/lib/engine/btcEngine';

export interface TimeframeSignal {
  timeframe: string;
  signal: string;
  reason: string;
}

export interface ConfluenceResult {
  symbol: string;
  signals: TimeframeSignal[];
  confluenceScore: number;  // 0–100
  dominantSignal: string;   // BUY | SELL | NEUTRAL
  confirmedTFs: number;     // how many TFs agree
  totalTFs: number;
  confidenceBoost: number;  // multiplier (1.0–2.0)
}

// ─── Score confluence across multiple analyses (Weighted ML) ─────
export function scoreConfluence(
  symbol: string,
  analyses: { timeframe: string; signals: { signal: string; reason: string }[] }[]
): ConfluenceResult {
  const allSignals: TimeframeSignal[] = [];
  let buyScore = 0;
  let sellScore = 0;

  // ML Weights (HTF dominates)
  const weights: Record<string, number> = {
    '15m': 0.1,
    '1h': 0.3,
    '4h': 0.6,
    '1D': 0.6, // legacy map
  };

  for (const a of analyses) {
    const w = weights[a.timeframe] || 0.3;
    for (const s of a.signals) {
      allSignals.push({ timeframe: a.timeframe, signal: s.signal, reason: s.reason });

      if (s.signal === 'BUY' || s.signal === 'LONG') buyScore += w;
      else if (s.signal === 'SELL' || s.signal === 'SHORT') sellScore += w;
    }
  }

  // To prevent multiple signals in the same TF from amplifying weight infinitely:
  // we could normalize, but for now ratio works perfectly based on base weights.
  const totalPossibleWeight = analyses.reduce((acc, a) => acc + (weights[a.timeframe] || 0.3), 0);
  
  // Dominant direction
  let dominantSignal = 'NEUTRAL';
  let scoreRatio = 0;

  if (buyScore > sellScore && buyScore > 0) {
    dominantSignal = 'BUY';
    scoreRatio = buyScore / totalPossibleWeight;
  } else if (sellScore > buyScore && sellScore > 0) {
    dominantSignal = 'SELL';
    scoreRatio = sellScore / totalPossibleWeight;
  }

  // Count TFs that agree with dominant
  const confirmedTFs = dominantSignal === 'BUY'
    ? analyses.filter((a) => a.signals.some((s) => s.signal === 'BUY' || s.signal === 'LONG')).length
    : dominantSignal === 'SELL'
    ? analyses.filter((a) => a.signals.some((s) => s.signal === 'SELL' || s.signal === 'SHORT')).length
    : 0;

  // Confluence score: Weighted %
  // Using Math.min(100) cap in case of 100%+ due to multiple signals per TF
  const confluenceScore = totalPossibleWeight > 0
    ? Math.min(100, Math.round(scoreRatio * 100))
    : 0;

  // Confidence boost: Extreme ML Weight
  let confidenceBoost = 1.0;
  if (confluenceScore >= 80) confidenceBoost = 2.0;    // 2x Boost for strong 4h+1h agreement
  else if (confluenceScore >= 50) confidenceBoost = 1.5;
  else if (dominantSignal === 'NEUTRAL') confidenceBoost = 0.5;

  return {
    symbol,
    signals: allSignals,
    confluenceScore,
    dominantSignal,
    confirmedTFs,
    totalTFs: analyses.length,
    confidenceBoost,
  };
}

// ─── Apply confluence to BTC analysis ──────────────
export function applyConfluenceToBTC(
  analysis4h: AnalysisResult,
  // In the future, pass 15m/1h/1D analyses here
): ConfluenceResult {
  // For now, we simulate multiple TFs from the single 4h analysis
  // by looking at different signal aspects as "virtual timeframes"
  const tf4h = { timeframe: '4h', signals: analysis4h.signals };

  // EMA structure as "higher TF" signal
  const htfSignals: { signal: string; reason: string }[] = [];
  if (analysis4h.ema50 > analysis4h.ema200 && analysis4h.ema200 > analysis4h.ema800) {
    htfSignals.push({ signal: 'BUY', reason: 'HTF: Bullish EMA stack (50 > 200 > 800)' });
  } else if (analysis4h.ema50 < analysis4h.ema200 && analysis4h.ema200 < analysis4h.ema800) {
    htfSignals.push({ signal: 'SELL', reason: 'HTF: Bearish EMA stack (50 < 200 < 800)' });
  } else {
    htfSignals.push({ signal: 'NEUTRAL', reason: 'HTF: Mixed EMA structure' });
  }
  const tfHTF = { timeframe: '1D', signals: htfSignals };

  // Liquidity as "lower TF" signal
  const ltfSignals: { signal: string; reason: string }[] = [];
  if (analysis4h.price > analysis4h.dailyOpen) {
    ltfSignals.push({ signal: 'BUY', reason: 'LTF: Price above Daily Open' });
  } else {
    ltfSignals.push({ signal: 'SELL', reason: 'LTF: Price below Daily Open' });
  }
  const tfLTF = { timeframe: '1h', signals: ltfSignals };
  // RSI-based signal as momentum confirmation (virtual 15m TF)
  const rsiSignals: { signal: string; reason: string }[] = [];
  // Compute RSI proxy: price position relative to EMA band
  const emaMid = (analysis4h.ema50 + analysis4h.ema200) / 2;
  const emaRange = Math.abs(analysis4h.ema50 - analysis4h.ema800) || 1;
  const rsiProxy = 50 + ((analysis4h.price - emaMid) / emaRange) * 50;
  const rsiClamped = Math.max(0, Math.min(100, rsiProxy));

  if (rsiClamped > 70) {
    rsiSignals.push({ signal: 'SELL', reason: `RSI: Overbought zone (${Math.round(rsiClamped)})` });
  } else if (rsiClamped < 30) {
    rsiSignals.push({ signal: 'BUY', reason: `RSI: Oversold zone (${Math.round(rsiClamped)})` });
  } else if (rsiClamped > 50) {
    rsiSignals.push({ signal: 'BUY', reason: `RSI: Bullish momentum (${Math.round(rsiClamped)})` });
  } else {
    rsiSignals.push({ signal: 'SELL', reason: `RSI: Bearish momentum (${Math.round(rsiClamped)})` });
  }
  const tfRSI = { timeframe: '15m', signals: rsiSignals };

  return scoreConfluence('BTC', [tfRSI, tfLTF, tf4h, tfHTF]);
}

// ─── Apply confluence to any coin analysis ─────────
export function applyConfluenceToCoin(coin: CoinAnalysis): ConfluenceResult {
  const tf4h = { timeframe: '4h', signals: coin.signals };

  const htfSignals: { signal: string; reason: string }[] = [];
  if (coin.ema50 > coin.ema200) {
    htfSignals.push({ signal: 'BUY', reason: 'HTF: EMA 50 > EMA 200' });
  } else {
    htfSignals.push({ signal: 'SELL', reason: 'HTF: EMA 50 < EMA 200' });
  }
  const tfHTF = { timeframe: '1D', signals: htfSignals };

  const ltfSignals: { signal: string; reason: string }[] = [];
  if (coin.price > coin.dailyOpen) {
    ltfSignals.push({ signal: 'BUY', reason: 'LTF: Price above Daily Open' });
  } else {
    ltfSignals.push({ signal: 'SELL', reason: 'LTF: Price below Daily Open' });
  }
  const tfLTF = { timeframe: '1h', signals: ltfSignals };
  // RSI momentum signal
  const rsiSignals: { signal: string; reason: string }[] = [];
  const emaMid = (coin.ema50 + coin.ema200) / 2;
  const emaRange = Math.abs(coin.ema50 - coin.ema200) || 1;
  const rsiProxy = 50 + ((coin.price - emaMid) / emaRange) * 50;
  const rsiClamped = Math.max(0, Math.min(100, rsiProxy));

  if (rsiClamped > 70) {
    rsiSignals.push({ signal: 'SELL', reason: `RSI: Overbought (${Math.round(rsiClamped)})` });
  } else if (rsiClamped < 30) {
    rsiSignals.push({ signal: 'BUY', reason: `RSI: Oversold (${Math.round(rsiClamped)})` });
  } else if (rsiClamped > 50) {
    rsiSignals.push({ signal: 'BUY', reason: `RSI: Bullish (${Math.round(rsiClamped)})` });
  } else {
    rsiSignals.push({ signal: 'SELL', reason: `RSI: Bearish (${Math.round(rsiClamped)})` });
  }
  const tfRSI = { timeframe: '15m', signals: rsiSignals };

  return scoreConfluence(coin.symbol, [tfRSI, tfLTF, tf4h, tfHTF]);
}
