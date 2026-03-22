// ============================================================
// Conviction Score + Correlation API
// Returns: real-time conviction score for BTC + correlation matrix
// ============================================================

import { NextResponse } from 'next/server';
import { calculateConviction } from '@/lib/scoring/convictionScore';
import { checkVWAP } from '@/lib/engine/vwapFilter';
import { calcRSI, analyzeRSI } from '@/lib/engine/rsiIndicator';
import { calcBollingerBands } from '@/lib/engine/bollingerBands';
import { fetchWithRetry } from '@/lib/providers/base';
import { getFearGreedIndex } from '@/lib/core/fearGreed';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('ConvictionAPI');

export const dynamic = 'force-dynamic';

const CORRELATION_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

// ─── Fetch closes for a symbol ──────────────────────
async function fetchCloses(symbol: string, limit = 168): Promise<number[]> {
  try {
    const res = await fetchWithRetry(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`,
      { retries: 1, timeoutMs: 4000 }
    );
    const klines = await res.json();
    if (!Array.isArray(klines)) return [];
    return klines.map((k: [number, string, string, string, string]) => parseFloat(k[4]));
  } catch { return []; }
}

// ─── Fear & Greed (uses cached live feed) ───────────
async function fetchFearGreed(): Promise<number> {
  const data = await getFearGreedIndex();
  return data.value;
}

// ─── Pearson Correlation ────────────────────────────
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;
  const xs = x.slice(-n), ys = y.slice(-n);
  
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : Math.round((num / den) * 100) / 100;
}

export async function GET() {
  try {
    // Fetch BTC data for conviction
    const btcCloses = await fetchCloses('BTCUSDT', 250);
    const price = btcCloses.length > 0 ? btcCloses[btcCloses.length - 1] : 0;

    // Calculate all indicators
    const vwapResult = await checkVWAP('BTC', price, 'BUY');
    const rsiValue = calcRSI(btcCloses, 14);
    const rsiAnalysis = analyzeRSI(btcCloses, 'BUY');
    const bb = calcBollingerBands(btcCloses);
    const fearGreed = await fetchFearGreed();

    // EMA for MTF confluence
    const ema = (vals: number[], p: number) => {
      if (vals.length < p) return vals.reduce((a, b) => a + b, 0) / vals.length;
      const k = 2 / (p + 1);
      let e = vals.slice(0, p).reduce((a, b) => a + b, 0) / p;
      for (let i = p; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
      return e;
    };
    const ema50 = ema(btcCloses, 50);
    const ema200 = ema(btcCloses, 200);
    const bullish = price > ema50 && ema50 > ema200;
    const bearish = price < ema50 && ema50 < ema200;
    const mtfConfluence = bullish ? 3 : bearish ? 3 : (price > ema50 ? 1 : 0);
    const direction = bullish ? 'BUY' as const : 'SELL' as const;

    // Calculate conviction for both directions
    const buyConviction = calculateConviction({
      vwapConfirmed: vwapResult.confirmed,
      volumeRatio: vwapResult.volumeRatio,
      priceAboveVWAP: vwapResult.priceAboveVWAP,
      rsiValue, rsiZone: rsiAnalysis.zone, rsiDivergence: rsiAnalysis.divergence,
      bbPercentB: bb.percentB, bbSqueeze: bb.squeeze, bbSignal: bb.signal,
      fearGreedValue: fearGreed,
      mtfConfluence: bullish ? 3 : (price > ema50 ? 1 : 0),
      direction: 'BUY',
    });

    const sellConviction = calculateConviction({
      vwapConfirmed: vwapResult.confirmed,
      volumeRatio: vwapResult.volumeRatio,
      priceAboveVWAP: vwapResult.priceAboveVWAP,
      rsiValue, rsiZone: rsiAnalysis.zone, rsiDivergence: rsiAnalysis.divergence,
      bbPercentB: bb.percentB, bbSqueeze: bb.squeeze, bbSignal: bb.signal,
      fearGreedValue: fearGreed,
      mtfConfluence: bearish ? 3 : (price < ema50 ? 1 : 0),
      direction: 'SELL',
    });

    // Choose the stronger direction
    const dominant = buyConviction.score >= sellConviction.score ? buyConviction : sellConviction;
    const dominantDir = buyConviction.score >= sellConviction.score ? 'BUY' : 'SELL';

    // Correlation matrix
    const closesMap: Record<string, number[]> = {};
    for (const pair of CORRELATION_PAIRS) {
      if (pair === 'BTCUSDT') {
        closesMap[pair] = btcCloses;
      } else {
        closesMap[pair] = await fetchCloses(pair, 168);
      }
    }

    // Calculate % returns for correlation
    const returnsMap: Record<string, number[]> = {};
    for (const [pair, closes] of Object.entries(closesMap)) {
      returnsMap[pair] = [];
      for (let i = 1; i < closes.length; i++) {
        returnsMap[pair].push(((closes[i] - closes[i-1]) / closes[i-1]) * 100);
      }
    }

    // Build correlation matrix
    const correlations: { pair1: string; pair2: string; correlation: number }[] = [];
    for (let i = 0; i < CORRELATION_PAIRS.length; i++) {
      for (let j = i + 1; j < CORRELATION_PAIRS.length; j++) {
        const p1 = CORRELATION_PAIRS[i];
        const p2 = CORRELATION_PAIRS[j];
        if (returnsMap[p1]?.length > 0 && returnsMap[p2]?.length > 0) {
          correlations.push({
            pair1: p1.replace('USDT', ''),
            pair2: p2.replace('USDT', ''),
            correlation: pearsonCorrelation(returnsMap[p1], returnsMap[p2]),
          });
        }
      }
    }

    return NextResponse.json({
      btcPrice: Math.round(price * 100) / 100,
      conviction: {
        buy: { score: buyConviction.score, grade: buyConviction.grade, components: buyConviction.components, shouldTrade: buyConviction.shouldTrade },
        sell: { score: sellConviction.score, grade: sellConviction.grade, components: sellConviction.components, shouldTrade: sellConviction.shouldTrade },
        dominant: dominantDir,
        dominantScore: dominant.score,
        dominantGrade: dominant.grade,
        reason: dominant.reason,
      },
      correlations,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Conviction API failed', { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
