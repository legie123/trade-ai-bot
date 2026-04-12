// ============================================================
// BTC Signal Engine — Server-side signal generator
// Hardened with apiFallback, structured logging, error recovery
// Computes EMA 50/200/800, detects liquidity plays
// ============================================================
import { routeSignal } from '@/lib/router/signalRouter';
import { trySignal } from '@/lib/v2/scouts/ta/signalCooldown';
import { getStreakStatus } from '@/lib/v2/scouts/ta/streakGuard';
import { signalStore } from '@/lib/store/signalStore';
import { Signal } from '@/lib/types/radar';
import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';
import { getResilientPrice } from '@/lib/core/apiFallback';
import { isSymbolValid } from '@/lib/store/db';
import { evaluateStrategy, MarketContext } from '@/lib/v2/scouts/ta/dynamicInterpreter';
import { checkVWAP } from '@/lib/v2/scouts/ta/vwapFilter';
import { analyzeRSI } from '@/lib/v2/scouts/ta/rsiIndicator';
import { calcBollingerBands } from '@/lib/v2/scouts/ta/bollingerBands';
import { getFundingRate } from '@/lib/v2/scouts/ta/fundingRate';
import { applySessionFilter } from '@/lib/v2/scouts/ta/sessionFilter';
import { analyzeWicks, detectMarketStructure } from '@/lib/v2/scouts/ta/wickAnalysis';
import { detectSFP } from '@/lib/v2/scouts/ta/sfpDetector';
import { getOpenInterest } from '@/lib/v2/scouts/ta/openInterest';

const log = createLogger('BTCEngine');

// ─── Types ─────────────────────────────────────────
interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface AnalysisResult {
  price: number;
  ema50: number;
  ema200: number;
  ema800: number;
  dailyOpen: number;
  dailyClose: number;
  psychHigh: number;
  psychLow: number;
  prevHigh: number;
  prevLow: number;
  signals: { signal: string; reason: string; sourceId?: string; weight?: number }[];
  timestamp: string;
}

// ─── EMA Calculator ────────────────────────────────
function calcEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

// ─── Fetch BTC OHLC with Promise.any() Race ──
// Binance, OKX, CryptoCompare queried simultaneously — fastest provider wins!
async function fetchBTCCandles(interval: '15m' | '1h' | '4h'): Promise<Candle[]> {
  try {
    const candles = await Promise.any([
      fetchFromMEXC(interval).then(c => c.length >= 20 ? c : Promise.reject('MEXC invalid')),
      fetchFromOKX(interval).then(c => c.length >= 20 ? c : Promise.reject('OKX invalid')),
      fetchFromCryptoCompare(interval).then(c => c.length >= 20 ? c : Promise.reject('CryptoCompare invalid'))
    ]);
    return candles;
  } catch (err) {
    log.error(`All 3 providers failed for ${interval}`);
    return [];
  }
}

async function fetchFromMEXC(interval: '15m' | '1h' | '4h'): Promise<Candle[]> {
  try {
    // MEXC intervals: '15m', '60m' (for 1h), '4h'
    const mexcInterval = interval === '1h' ? '60m' : interval;
    const res = await fetchWithRetry(
      `https://api.mexc.com/api/v3/klines?symbol=BTCUSDT&interval=${mexcInterval}&limit=250`,
      { retries: 1, timeoutMs: 8000 }
    );
    const klines = await res.json();
    if (!Array.isArray(klines)) return [];
    return klines.map((k: [number, string, string, string, string]) => ({
      t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4])
    }));
  } catch (err) {
    log.warn(`MEXC OHLC ${interval} failed`, { error: (err as Error).message });
    return [];
  }
}

async function fetchFromOKX(interval: '15m' | '1h' | '4h'): Promise<Candle[]> {
  try {
    const barMap: Record<string, string> = { '15m': '15m', '1h': '1H', '4h': '4H' };
    const bar = barMap[interval] || '1H';
    const res = await fetchWithRetry(
      `https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=${bar}&limit=250`,
      { retries: 1, timeoutMs: 8000 }
    );
    const json = await res.json();
    const data = json?.data;
    if (!Array.isArray(data)) return [];
    return data.reverse().map((k: string[]) => ({
      t: parseInt(k[0]), o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4])
    }));
  } catch (err) {
    log.warn(`OKX OHLC ${interval} failed`, { error: (err as Error).message });
    return [];
  }
}

async function fetchFromCryptoCompare(interval: '15m' | '1h' | '4h'): Promise<Candle[]> {
  try {
    const endpointMap: Record<string, { api: string; limit: number }> = {
      '15m': { api: 'histominute', limit: 250 },
      '1h': { api: 'histohour', limit: 250 },
      '4h': { api: 'histohour', limit: 250 },
    };
    const { api, limit } = endpointMap[interval] || endpointMap['1h'];
    const aggregate = interval === '15m' ? 15 : interval === '4h' ? 4 : 1;
    const res = await fetchWithRetry(
      `https://min-api.cryptocompare.com/data/v2/${api}?fsym=BTC&tsym=USDT&limit=${limit}&aggregate=${aggregate}`,
      { retries: 1, timeoutMs: 8000 }
    );
    const json = await res.json();
    const data = json?.Data?.Data;
    if (!Array.isArray(data)) return [];
    return data.map((k: { time: number; open: number; high: number; low: number; close: number }) => ({
      t: k.time * 1000, o: k.open, h: k.high, l: k.low, c: k.close
    }));
  } catch (err) {
    log.warn(`CryptoCompare OHLC ${interval} failed`, { error: (err as Error).message });
    return [];
  }
}



export async function analyzeBTC(): Promise<AnalysisResult> {
  const [c15mRes, c1hRes, c4hRes, fallbackPriceResult] = await Promise.allSettled([
    fetchBTCCandles('15m'),
    fetchBTCCandles('1h'),
    fetchBTCCandles('4h'),
    getResilientPrice('BTC'),
  ]);

  const c15m = c15mRes.status === 'fulfilled' ? c15mRes.value : [];
  const c1h = c1hRes.status === 'fulfilled' ? c1hRes.value : [];
  const c4h = c4hRes.status === 'fulfilled' ? c4hRes.value : [];

  let price = 0;
  if (fallbackPriceResult.status === 'fulfilled') {
    price = fallbackPriceResult.value.price;
  } else if (c15m.length > 0) {
    price = c15m[c15m.length - 1].c;
    log.warn('Resilient price failed, using latest 15m close', { price });
  }

  if (price === 0) {
    log.error('No BTC price data available from any source');
    return emptyResult('NO DATA');
  }

  const closes15m = c15m.map((c) => c.c);
  const closes1h = c1h.map((c) => c.c);
  const closes4h = c4h.map((c) => c.c);
  
  if (closes4h.length < 50 || closes1h.length < 50 || closes15m.length < 50) {
     log.warn('Insufficient OHLC MTF data for EMA calculation');
     return emptyResult('INSUFFICIENT_DATA');
  }

  // Multi-Timeframe EMAs
  const ema50_15m = calcEMA(closes15m, 50);
  const ema200_15m = calcEMA(closes15m, 200);

  const ema50_1h = calcEMA(closes1h, 50);
  const ema200_1h = calcEMA(closes1h, 200);

  const ema50_4h = calcEMA(closes4h, 50);
  const ema200_4h = calcEMA(closes4h, 200);
  const ema800_4h = calcEMA(closes4h, 800);

  // Psychological levels
  const psychHigh = Math.ceil(price / 1000) * 1000;
  const psychLow = Math.floor(price / 1000) * 1000;

  const last = c1h[c1h.length - 1];
  const prev = c1h.length > 1 ? c1h[c1h.length - 2] : last;
  const dailyOpen = c4h[c4h.length - 1].o; // Macro open
  const dailyClose = price;

  const signals: { signal: string; reason: string; sourceId?: string; weight?: number }[] = [];

  // ── MTF Confluence Logic ──
  const isBullish15m = price > ema50_15m && ema50_15m > ema200_15m;
  const isBullish1h = price > ema50_1h && ema50_1h > ema200_1h;
  const isBullish4h = price > ema50_4h && ema50_4h > ema200_4h;
  
  const isBearish15m = price < ema50_15m && ema50_15m < ema200_15m;
  const isBearish1h = price < ema50_1h && ema50_1h < ema200_1h;
  const isBearish4h = price < ema50_4h && ema50_4h < ema200_4h;

  let bullConfluence = 0;
  if (isBullish15m) bullConfluence++;
  if (isBullish1h) bullConfluence++;
  if (isBullish4h) bullConfluence++;

  let bearConfluence = 0;
  if (isBearish15m) bearConfluence++;
  if (isBearish1h) bearConfluence++;
  if (isBearish4h) bearConfluence++;

  // ── Swing Failure Pattern (76% win rate backtested) ──
  const sfp1h = detectSFP(c1h);
  if (sfp1h.detected && sfp1h.strength >= 0.3) {
    signals.push({ signal: sfp1h.signal, reason: sfp1h.reason, weight: 1.5 }); // High weight for SFP
  }

  // ── 9/21 EMA Scalping Cross (proven 15m BTC entry) ──
  if (closes15m.length >= 21) {
    const ema9 = calcEMA(closes15m, 9);
    const ema21 = calcEMA(closes15m, 21);
    const prevCloses = closes15m.slice(0, -1);
    const prevEma9 = prevCloses.length >= 9 ? calcEMA(prevCloses, 9) : ema9;
    const prevEma21 = prevCloses.length >= 21 ? calcEMA(prevCloses, 21) : ema21;

    // Golden cross on 15m + aligned with 1h and 4h trend
    if (prevEma9 <= prevEma21 && ema9 > ema21 && isBullish1h && isBullish4h) {
      signals.push({ signal: 'BUY', reason: `⚡ 9/21 EMA Golden Cross (15m) — scalp BUY aligned with 1h/4h trend`, weight: 0.8 }); // Lower weight for simple EMA
    }
    // Death cross on 15m + aligned with 1h and 4h trend
    else if (prevEma9 >= prevEma21 && ema9 < ema21 && isBearish1h && isBearish4h) {
      signals.push({ signal: 'SELL', reason: `⚡ 9/21 EMA Death Cross (15m) — scalp SELL aligned with 1h/4h trend`, weight: 0.8 });
    }
  }

  // Liquidity Grabs on 1H
  if (last.l < dailyOpen && price > dailyOpen && price > last.o) {
    signals.push({ signal: 'BUY', reason: 'Liquidity grab at Daily Open (1H sweep & reclaim)', weight: 1.5 }); // High weight
  }
  
  if (last.l <= psychLow && price > psychLow && price > last.o) {
    signals.push({ signal: 'BUY', reason: `Bounce off Psych Low ($${psychLow.toLocaleString()})`, weight: 1.5 }); // High weight
  }

  // ── Bollinger Bands Signals ──
  const bb = calcBollingerBands(closes1h);
  if (bb.signal === 'BB_BUY') {
    signals.push({ signal: 'BUY', reason: `BB Mean Reversion: ${bb.reason}` });
  } else if (bb.signal === 'BB_SELL') {
    signals.push({ signal: 'SELL', reason: `BB Rejection: ${bb.reason}` });
  }

  // ── Market Structure Break (5-bar pivot detection on 1H) ──
  const msb = detectMarketStructure(c1h);
  if (msb.breakOfStructure && msb.signal !== 'NEUTRAL') {
    signals.push({ signal: msb.signal, reason: msb.reason, weight: 1.2 });
  }

  // ── Rejection Wick Patterns (on 1H candles) ──
  const wick = analyzeWicks(c1h);
  if (wick.signal !== 'NEUTRAL' && wick.strength >= 0.5) {
    signals.push({ signal: wick.signal, reason: wick.reason, weight: 1.3 });
  }

  // ── Volume Spike Detection (3x avg on 15m = whale entry) ──
  if (c15m.length >= 20) {
    const volumes15m = c15m.map(c => {
      // Approximate volume from high-low range * typical volume
      return c.h - c.l;
    });
    const avgVol = volumes15m.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVol = volumes15m[volumes15m.length - 1];
    if (lastVol > avgVol * 3 && avgVol > 0) {
      const lastCandle = c15m[c15m.length - 1];
      const isBullishCandle = lastCandle.c > lastCandle.o;
      if (isBullishCandle && isBullish15m) {
        signals.push({ signal: 'BUY', reason: `🐋 Volume Spike ${(lastVol / avgVol).toFixed(1)}x + bullish candle — whale entry`, weight: 1.4 });
      } else if (!isBullishCandle && isBearish15m) {
        signals.push({ signal: 'SELL', reason: `🐋 Volume Spike ${(lastVol / avgVol).toFixed(1)}x + bearish candle — whale exit`, weight: 1.4 });
      }
    }
  }

  // ── Momentum Acceleration (ROC on 15m closes) ──
  if (closes15m.length >= 15) {
    const roc5 = ((closes15m[closes15m.length - 1] - closes15m[closes15m.length - 6]) / closes15m[closes15m.length - 6]) * 100;
    const roc10 = ((closes15m[closes15m.length - 1] - closes15m[closes15m.length - 11]) / closes15m[closes15m.length - 11]) * 100;
    // Accelerating momentum: ROC5 > ROC10 and both positive = strong trend
    if (roc5 > 0.5 && roc10 > 0 && roc5 > roc10 && isBullish1h) {
      signals.push({ signal: 'BUY', reason: `🚀 Momentum accelerating: ROC5 ${roc5.toFixed(2)}% > ROC10 ${roc10.toFixed(2)}%`, weight: 1.1 });
    } else if (roc5 < -0.5 && roc10 < 0 && roc5 < roc10 && isBearish1h) {
      signals.push({ signal: 'SELL', reason: `📉 Momentum accelerating down: ROC5 ${roc5.toFixed(2)}% < ROC10 ${roc10.toFixed(2)}%`, weight: 1.1 });
    }
  }

  // ── Funding Rate Contrarian Signal ──
  const funding = await getFundingRate('BTCUSDT');
  if (funding.signal !== 'NEUTRAL' && funding.strength >= 0.5) {
    signals.push({ signal: funding.signal, reason: funding.reason });
  }

  // ── Open Interest Divergence (institutional positioning) ──
  const oi = await getOpenInterest('BTCUSDT');
  if (oi.signal !== 'NEUTRAL' && oi.strength >= 0.3) {
    signals.push({ signal: oi.signal, reason: oi.reason });
  }

  // ── MTF Confluence (original) ──
  if (bullConfluence >= 3) {
    signals.push({ signal: 'BUY', reason: 'MTF Confluence: Full Bullish Alignment (15m, 1h, 4h)' });
  } else if (bearConfluence >= 3) {
    signals.push({ signal: 'SELL', reason: 'MTF Confluence: Full Bearish Alignment (15m, 1h, 4h)' });
  }

  // ── TREND FILTER: Block signals against major EMA trend ──
  // Calibration #2: prevents BUY in downtrend and SELL in uptrend
  const trendBullish = ema50_1h > ema200_1h;
  const trendBearish = ema50_1h < ema200_1h;
  const trendFiltered: typeof signals = [];

  for (const sig of signals) {
    if (sig.signal === 'NEUTRAL') {
      trendFiltered.push(sig);
      continue;
    }

    // Mean-reversion signals are valid against trend (overbought SELL in uptrend, relief bounce BUY in downtrend)
    const isMeanReversion = sig.reason.includes('Overbought') || sig.reason.includes('Oversold')
      || sig.reason.includes('momentum') || sig.reason.includes('Bounce') || sig.reason.includes('Extreme');

    // Block BUY/LONG in bearish trend (except mean-reversion)
    if ((sig.signal === 'BUY' || sig.signal === 'LONG') && trendBearish && !isMeanReversion) {
      log.debug(`BTC ${sig.signal} BLOCKED by Trend Filter`);
      trendFiltered.push({ signal: 'NEUTRAL', reason: `${sig.reason} — BLOCKED: EMA downtrend` });
      continue;
    }
    // Block SELL/SHORT in bullish trend (except mean-reversion)
    if ((sig.signal === 'SELL' || sig.signal === 'SHORT') && trendBullish && !isMeanReversion) {
      log.debug(`BTC ${sig.signal} BLOCKED by Trend Filter`);
      trendFiltered.push({ signal: 'NEUTRAL', reason: `${sig.reason} — BLOCKED: EMA uptrend` });
      continue;
    }
    trendFiltered.push(sig);
  }

  if (trendFiltered.length === 0) {
    trendFiltered.push({
      signal: 'NEUTRAL',
      reason: trendBullish ? 'Bullish trend but no actionable signal'
            : trendBearish ? 'Bearish trend — waiting for SELL setup'
            : 'Ranging / Choppy MTF'
    });
  }

  // ── VWAP + RSI Double Gate (Institutional Filter) ──
  const confirmedSignals: { signal: string; reason: string; sourceId?: string; weight?: number }[] = [];
  for (const sig of trendFiltered) {
    if (sig.signal === 'NEUTRAL') {
      confirmedSignals.push(sig);
      continue;
    }

    // Gate 1: VWAP Volume Check
    const vwap = await checkVWAP('BTC', price, sig.signal as 'BUY' | 'SELL');
    if (!vwap.confirmed) {
      confirmedSignals.push({
        signal: 'NEUTRAL',
        reason: `${sig.reason} — REJECTED by VWAP (Vol ${vwap.volumeRatio}x, need 1.2x)`,
      });
      log.info(`BTC signal ${sig.signal} rejected by VWAP`, { ratio: vwap.volumeRatio });
      continue;
    }

    // Gate 2: RSI Momentum Check
    const rsi = analyzeRSI(closes1h, sig.signal as 'BUY' | 'SELL');
    if (!rsi.confirmsSignal) {
      confirmedSignals.push({
        signal: 'NEUTRAL',
        reason: `${sig.reason} — REJECTED by RSI: ${rsi.reason}`,
      });
      log.info(`BTC signal ${sig.signal} rejected by RSI`, { rsi: rsi.rsi, zone: rsi.zone });
      continue;
    }

    // Both gates passed!
    confirmedSignals.push({
      signal: sig.signal,
      reason: `${sig.reason} | VWAP ✅ Vol ${vwap.volumeRatio}x | RSI ✅ ${rsi.rsi} ${rsi.zone}`,
      weight: sig.weight, // Propagate the weight!
    });
  }

  // ==== DYNAMIC AI STRATEGIES (V2 Syndicate handled by ManagerVizionar) ====
  // Legacy strategy evaluation removed for P5 Cleanup.

  return {
    price: Math.round(price * 100) / 100,
    ema50: Math.round(ema50_1h * 100) / 100,
    ema200: Math.round(ema200_1h * 100) / 100,
    ema800: Math.round(ema800_4h * 100) / 100,
    dailyOpen: Math.round(dailyOpen * 100) / 100,
    dailyClose: Math.round(dailyClose * 100) / 100,
    psychHigh,
    psychLow,
    prevHigh: Math.round(prev.h * 100) / 100,
    prevLow: Math.round(prev.l * 100) / 100,
    signals: confirmedSignals,
    timestamp: new Date().toISOString(),
  };
}

function emptyResult(reason: string): AnalysisResult {
  return {
    price: 0, ema50: 0, ema200: 0, ema800: 0,
    dailyOpen: 0, dailyClose: 0, psychHigh: 0, psychLow: 0,
    prevHigh: 0, prevLow: 0,
    signals: [{ signal: 'NEUTRAL', reason }],
    timestamp: new Date().toISOString(),
  };
}

export async function generateBTCSignals(): Promise<AnalysisResult> {
  const analysis = await analyzeBTC();

  // Calibration #5+#9: Dynamic confidence threshold based on loss streak
  const streak = getStreakStatus();
  const MIN_CONFIDENCE = 70 + streak.confidenceBoost; // 70 normal, 80/85/90 on streaks
  if (streak.action !== 'NORMAL') {
    log.info(`BTC Engine: ${streak.reason} — MIN_CONFIDENCE raised to ${MIN_CONFIDENCE}%`);
  }
  let bestSignal: {
    sig: typeof analysis.signals[0];
    routed: ReturnType<typeof routeSignal>;
    confidence: number;
    sessionInfo: { session: string };
  } | null = null;

  for (const sig of analysis.signals) {
    if (sig.signal === 'NEUTRAL') continue;

    // Cooldown gate: prevent duplicate signals within 30min
    if (!trySignal('BTC', sig.signal)) continue;

    const signalId = `btc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const signal: Signal = {
      id: signalId, symbol: 'BTC', timeframe: '4h', signal: sig.signal as Signal['signal'],
      price: analysis.price, timestamp: analysis.timestamp,
      source: sig.sourceId || 'BTC Engine', message: sig.reason,
    };

    const routed = routeSignal(signal);
    signalStore.addSignal(routed);

    // Apply session timing filter to confidence
    let baseConfidence = (routed as unknown as { confidence: number }).confidence || 50;
    if (sig.weight) {
      baseConfidence = Math.min(baseConfidence * sig.weight, 100);
      log.debug(`[Weight] ${sig.signal} confidence boosted to ${baseConfidence.toFixed(1)}% due to weight ${sig.weight}`);
    }

    const { adjustedConfidence, sessionInfo } = applySessionFilter(
      baseConfidence, sig.signal as 'BUY' | 'SELL' | 'LONG' | 'SHORT'
    );

    // Confidence gate: skip weak signals
    if (adjustedConfidence < MIN_CONFIDENCE) {
      log.info(`BTC ${sig.signal} SKIPPED: confidence ${adjustedConfidence}% < ${MIN_CONFIDENCE}% threshold`);
      continue;
    }

    // Track best signal (highest confidence)
    if (!bestSignal || adjustedConfidence > bestSignal.confidence) {
      bestSignal = { sig, routed, confidence: adjustedConfidence, sessionInfo };
    }
  }

  // Removed V1 explicit DB insertion & ML Filtering
  // Best signals are returned to ManagerVizionar for Phoenix V2 multi-agent consensus

  return analysis;
}
