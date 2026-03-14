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

// ─── Score confluence across multiple analyses ─────
export function scoreConfluence(
  symbol: string,
  analyses: { timeframe: string; signals: { signal: string; reason: string }[] }[]
): ConfluenceResult {
  const allSignals: TimeframeSignal[] = [];
  let buyCount = 0;
  let sellCount = 0;
  let neutralCount = 0;

  for (const a of analyses) {
    for (const s of a.signals) {
      allSignals.push({ timeframe: a.timeframe, signal: s.signal, reason: s.reason });

      if (s.signal === 'BUY' || s.signal === 'LONG') buyCount++;
      else if (s.signal === 'SELL' || s.signal === 'SHORT') sellCount++;
      else neutralCount++;
    }
  }

  const totalTFs = analyses.length;
  const actionable = buyCount + sellCount;

  // Dominant direction
  let dominantSignal = 'NEUTRAL';
  if (buyCount > sellCount && buyCount > 0) dominantSignal = 'BUY';
  else if (sellCount > buyCount && sellCount > 0) dominantSignal = 'SELL';

  // Count TFs that agree with dominant
  const confirmedTFs = dominantSignal === 'BUY'
    ? analyses.filter((a) => a.signals.some((s) => s.signal === 'BUY' || s.signal === 'LONG')).length
    : dominantSignal === 'SELL'
    ? analyses.filter((a) => a.signals.some((s) => s.signal === 'SELL' || s.signal === 'SHORT')).length
    : 0;

  // Confluence score: more TFs agreeing = higher score
  const confluenceScore = totalTFs > 0
    ? Math.round((confirmedTFs / totalTFs) * 100)
    : 0;

  // Confidence boost: 3+ TFs confirming = 2×, 2 TFs = 1.5×
  let confidenceBoost = 1.0;
  if (confirmedTFs >= 3) confidenceBoost = 2.0;
  else if (confirmedTFs >= 2) confidenceBoost = 1.5;
  else if (actionable === 0) confidenceBoost = 0.5; // all neutral = lower

  return {
    symbol,
    signals: allSignals,
    confluenceScore,
    dominantSignal,
    confirmedTFs,
    totalTFs,
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

  return scoreConfluence('BTC', [tfLTF, tf4h, tfHTF]);
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

  return scoreConfluence(coin.symbol, [tfLTF, tf4h, tfHTF]);
}
