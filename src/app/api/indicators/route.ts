// ============================================================
// Indicators API — Comprehensive market intelligence endpoint
// Returns: VWAP, RSI, Bollinger Bands, Kelly, Fear & Greed
// ============================================================

import { NextResponse } from 'next/server';
import { checkVWAP } from '@/lib/engine/vwapFilter';
import { analyzeRSI, calcRSI } from '@/lib/engine/rsiIndicator';
import { calcBollingerBands } from '@/lib/engine/bollingerBands';
import { calculateKellyRisk } from '@/lib/engine/kellySizer';
import { getExecutionLog } from '@/lib/engine/executor';
import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('IndicatorsAPI');

export const dynamic = 'force-dynamic';

// ─── Fetch BTC 1H closes for indicator calculations ───
async function fetchBTCCloses(): Promise<number[]> {
  try {
    const res = await fetchWithRetry(
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=250',
      { retries: 2, timeoutMs: 5000 }
    );
    const klines = await res.json();
    if (!Array.isArray(klines)) return [];
    return klines.map((k: [number, string, string, string, string]) => parseFloat(k[4]));
  } catch { return []; }
}

// ─── Fetch Fear & Greed Index ─────────────────────────
async function fetchFearGreed(): Promise<{ value: number; label: string; timestamp: string }> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const fg = data?.data?.[0];
    return {
      value: parseInt(fg?.value || '50'),
      label: fg?.value_classification || 'Neutral',
      timestamp: fg?.timestamp ? new Date(parseInt(fg.timestamp) * 1000).toISOString() : new Date().toISOString(),
    };
  } catch {
    return { value: 50, label: 'Neutral', timestamp: new Date().toISOString() };
  }
}

export async function GET() {
  try {
    const closes = await fetchBTCCloses();
    const price = closes.length > 0 ? closes[closes.length - 1] : 0;

    // VWAP
    const vwapResult = await checkVWAP('BTC', price, 'BUY');

    // RSI
    const rsiValue = calcRSI(closes, 14);
    const rsiAnalysis = analyzeRSI(closes, price > vwapResult.vwap ? 'BUY' : 'SELL');

    // Bollinger Bands
    const bb = calcBollingerBands(closes);

    // Kelly Criterion
    const tradeHistory = getExecutionLog()
      .filter(r => r.executed)
      .map(r => ({
        pnlPercent: ((r.price - r.stopLoss) / r.price) * 100 * (r.side === 'BUY' ? 1 : -1),
        outcome: (r.price > r.stopLoss ? 'WIN' : 'LOSS') as 'WIN' | 'LOSS',
      }));
    const kelly = calculateKellyRisk(tradeHistory);

    // Fear & Greed
    const fearGreed = await fetchFearGreed();

    // Market Regime Detection
    const ema50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : price;
    const ema200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : price;
    let regime = 'RANGING';
    if (price > ema50 && ema50 > ema200) regime = 'BULL_TREND';
    else if (price < ema50 && ema50 < ema200) regime = 'BEAR_TREND';
    else if (bb.squeeze) regime = 'SQUEEZE';

    return NextResponse.json({
      btcPrice: Math.round(price * 100) / 100,
      regime,
      vwap: {
        value: vwapResult.vwap,
        priceAbove: vwapResult.priceAboveVWAP,
        volumeRatio: vwapResult.volumeRatio,
        volumeSurge: vwapResult.volumeSurge,
      },
      rsi: {
        value: Math.round(rsiValue * 10) / 10,
        zone: rsiAnalysis.zone,
        divergence: rsiAnalysis.divergence,
      },
      bollingerBands: {
        upper: bb.upper,
        middle: bb.middle,
        lower: bb.lower,
        bandwidth: bb.bandwidth,
        percentB: bb.percentB,
        squeeze: bb.squeeze,
        signal: bb.signal,
      },
      kelly: {
        suggestedRisk: kelly.suggestedRisk,
        winRate: kelly.winRate,
        payoffRatio: kelly.payoffRatio,
        sampleSize: kelly.sampleSize,
        confident: kelly.confident,
      },
      fearGreed: fearGreed,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('Indicators API failed', { error: String(err) });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
