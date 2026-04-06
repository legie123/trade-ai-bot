// ============================================================
// Open Interest Divergence — Institutional positioning signal
// OI rising + price falling = accumulation (BUY setup)
// OI rising + price rising = confirmation (strong trend)
// OI falling + price rising = weak rally (SELL signal)
// ============================================================
import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('OpenInterest');

export interface OIData {
  openInterest: number;
  oiChange24h: number;     // % change in OI over 24h
  priceChange24h: number;  // % change in price over 24h
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  divergence: 'BULLISH_DIV' | 'BEARISH_DIV' | 'CONFIRMING' | 'NONE';
  strength: number;
  reason: string;
  cached: boolean;
}

// Cache: OI doesn't change that fast, 5-min TTL
const goi = globalThis as unknown as {
  __oiCache?: Record<string, { data: OIData; at: number }>;
};
if (!goi.__oiCache) goi.__oiCache = {};
const OI_CACHE_TTL = 5 * 60_000;

/**
 * Fetch Open Interest from Binance Futures for a symbol
 */
export async function getOpenInterest(symbol: string = 'BTCUSDT'): Promise<OIData> {
  const cached = goi.__oiCache?.[symbol];
  if (cached && Date.now() - cached.at < OI_CACHE_TTL) {
    return { ...cached.data, cached: true };
  }

  try {
    // Fetch current OI
    const [oiRes, priceRes] = await Promise.allSettled([
      fetchWithRetry(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`,
        { retries: 2, timeoutMs: 5000 }
      ),
      fetchWithRetry(
        `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`,
        { retries: 2, timeoutMs: 5000 }
      ),
    ]);

    let openInterest = 0;
    let priceChange24h = 0;

    if (oiRes.status === 'fulfilled') {
      const oiData = await oiRes.value.json();
      openInterest = parseFloat(oiData?.openInterest || '0');
    }

    if (priceRes.status === 'fulfilled') {
      const priceData = await priceRes.value.json();
      priceChange24h = parseFloat(priceData?.priceChangePercent || '0');
    }

    // For OI change, we compare with cached value
    let oiChange24h = 0;
    const prevOI = cached?.data?.openInterest;
    if (prevOI && prevOI > 0) {
      oiChange24h = ((openInterest - prevOI) / prevOI) * 100;
    }

    // ─── Divergence Detection ──────────────────────
    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let divergence: OIData['divergence'] = 'NONE';
    let strength = 0;
    let reason = `OI: ${openInterest.toFixed(0)} BTC`;

    // BULLISH DIVERGENCE: OI rising (new positions) + price falling (accumulation)
    if (oiChange24h > 2 && priceChange24h < -1) {
      signal = 'BUY';
      divergence = 'BULLISH_DIV';
      strength = Math.min(1, Math.abs(oiChange24h) * 0.1);
      reason = `📊 OI Bullish Divergence: OI +${oiChange24h.toFixed(1)}% while price ${priceChange24h.toFixed(1)}% — smart money accumulating`;
    }
    // BEARISH DIVERGENCE: OI falling + price rising (weak rally, no new buyers)
    else if (oiChange24h < -2 && priceChange24h > 1) {
      signal = 'SELL';
      divergence = 'BEARISH_DIV';
      strength = Math.min(1, Math.abs(oiChange24h) * 0.1);
      reason = `📊 OI Bearish Divergence: OI ${oiChange24h.toFixed(1)}% while price +${priceChange24h.toFixed(1)}% — rally losing conviction`;
    }
    // CONFIRMING: Both rising = strong trend
    else if (oiChange24h > 3 && priceChange24h > 2) {
      divergence = 'CONFIRMING';
      reason = `📊 OI Confirms trend: OI +${oiChange24h.toFixed(1)}% + price +${priceChange24h.toFixed(1)}%`;
    }

    const result: OIData = {
      openInterest, oiChange24h, priceChange24h,
      signal, divergence, strength, reason, cached: false,
    };

    goi.__oiCache![symbol] = { data: result, at: Date.now() };
    log.info(`OI ${symbol}: ${result.divergence} | OI ${oiChange24h > 0 ? '+' : ''}${oiChange24h.toFixed(1)}% | Price ${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(1)}%`);
    return result;
  } catch (err) {
    log.warn('Open Interest fetch failed', { error: (err as Error).message });
    return {
      openInterest: 0, oiChange24h: 0, priceChange24h: 0,
      signal: 'NEUTRAL', divergence: 'NONE', strength: 0,
      reason: 'OI data unavailable', cached: false,
    };
  }
}
