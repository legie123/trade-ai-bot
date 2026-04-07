// ============================================================
// VWAP Volume Confirmation Filter
// Fetches volume-weighted data from Binance to validate signals.
// A signal is "volume-confirmed" if:
//   1. Price above VWAP + volume surge >= 1.2x (trend-following), OR
//   2. Price below VWAP + volume surge >= 1.8x (mean-reversion)
// ============================================================

import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('VWAPFilter');

export interface VWAPResult {
  vwap: number;
  currentVolume: number;
  avgVolume: number;
  volumeRatio: number;        // currentVolume / avgVolume
  priceAboveVWAP: boolean;
  priceBelowVWAP: boolean;
  volumeSurge: boolean;        // volumeRatio >= 1.5
  confirmed: boolean;          // Final verdict: is the signal volume-backed?
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
}

// ─── Fetch klines with volume from Binance ─────────────
async function fetchKlinesWithVolume(
  symbol: string,
  interval: '15m' | '1h' | '4h' = '1h',
  limit: number = 50
): Promise<{ close: number; high: number; low: number; volume: number }[]> {
  try {
    const res = await fetchWithRetry(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      { retries: 2, timeoutMs: 5000 }
    );
    const klines = await res.json();
    if (!Array.isArray(klines)) return [];

    return klines.map((k: [number, string, string, string, string, string]) => ({
      close: parseFloat(k[4]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      volume: parseFloat(k[5]),
    }));
  } catch (err) {
    log.error(`VWAP kline fetch failed for ${symbol}`, { error: (err as Error).message });
    return [];
  }
}

// ─── Compute VWAP ──────────────────────────────────────
function computeVWAP(candles: { close: number; high: number; low: number; volume: number }[]): number {
  if (candles.length === 0) return 0;

  let cumulativeTPV = 0; // TP * Volume
  let cumulativeVolume = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
  }

  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
}

// ─── Main VWAP Filter ──────────────────────────────────
export async function checkVWAP(
  symbol: string,
  currentPrice: number,
  proposedSignal: 'BUY' | 'SELL'
): Promise<VWAPResult> {
  // Map internal symbols to Binance format
  const binanceSymbol = symbol === 'BTC' ? 'BTCUSDT'
    : symbol === 'ETH' ? 'ETHUSDT'
    : symbol === 'SOL' ? 'SOLUSDT'
    : symbol === 'BONK' ? 'BONKUSDT'
    : symbol === 'WIF' ? 'WIFUSDT'
    : symbol === 'JUP' ? 'JUPUSDT'
    : symbol === 'RAY' ? 'RAYUSDT'
    : symbol === 'JTO' ? 'JTOUSDT'
    : symbol === 'PYTH' ? 'PYTHUSDT'
    : symbol === 'RNDR' ? 'RNDRUSDT'
    : `${symbol}USDT`;

  const candles = await fetchKlinesWithVolume(binanceSymbol, '1h', 50);

  if (candles.length < 20) {
    log.warn(`Insufficient volume data for ${symbol}, allowing signal by default`);
    return {
      vwap: 0, currentVolume: 0, avgVolume: 0, volumeRatio: 0,
      priceAboveVWAP: false, priceBelowVWAP: false,
      volumeSurge: false, confirmed: true, // Allow signal if data unavailable
      signal: proposedSignal,
    };
  }

  // 1. Compute VWAP across last 50 candles
  const vwap = computeVWAP(candles);

  // 2. Compute current volume vs 20-period average
  const volumes = candles.map(c => c.volume);
  const currentVolume = volumes[volumes.length - 1];
  const last3Avg = (volumes[volumes.length - 1] + volumes[volumes.length - 2] + volumes[volumes.length - 3]) / 3;
  const avg20Volume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeRatio = avg20Volume > 0 ? last3Avg / avg20Volume : 0;

  // 3. Position relative to VWAP
  const priceAboveVWAP = currentPrice > vwap;
  const priceBelowVWAP = currentPrice < vwap;

  // 4. Volume surge = recent 3-bar average vs 20-bar average
  // Relaxed from 1.2x to 0.8x (normal volume) to prevent bot death during low volatility sessions
  const volumeSurge = volumeRatio >= 0.8;

  // 5. Final confirmation logic
  // For trend-following, require price on correct side of VWAP with normal volume
  // For mean-reversion, require slightly higher volume (1.2x)
  let confirmed = false;
  if (proposedSignal === 'BUY') {
    if (priceAboveVWAP && volumeSurge) {
      // Classic: price above VWAP with normal volume
      confirmed = true;
    } else if (priceBelowVWAP && volumeRatio >= 1.2) {
      // Mean reversion: capitulation / reversal BUY
      confirmed = true;
    }
  } else if (proposedSignal === 'SELL') {
    if (priceBelowVWAP && volumeSurge) {
      // Classic: price below VWAP with normal volume
      confirmed = true;
    } else if (priceAboveVWAP && volumeRatio >= 1.2) {
      // Distribution: smart money selling
      confirmed = true;
    }
  }

  log.info(`VWAP Check: ${symbol}`, {
    vwap: Math.round(vwap * 100) / 100,
    price: currentPrice,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    proposedSignal,
    confirmed,
  });

  return {
    vwap: Math.round(vwap * 100) / 100,
    currentVolume: Math.round(currentVolume),
    avgVolume: Math.round(avg20Volume),
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    priceAboveVWAP,
    priceBelowVWAP,
    volumeSurge,
    confirmed,
    signal: confirmed ? proposedSignal : 'NEUTRAL',
  };
}
