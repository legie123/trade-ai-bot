// ============================================================
// Open Interest Divergence — Institutional positioning signal
// OI rising + price falling = accumulation (BUY setup)
// OI rising + price rising = confirmation (strong trend)
// OI falling + price rising = weak rally (SELL signal)
// ============================================================
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
    // MEXC Contract Open Interest API could be implemented here
    // For now, return NEUTRAL to purge Binance dependency safely
    const openInterest = 0;
    const oiChange24h = 0;
    const priceChange24h = 0;
    const signal = 'NEUTRAL';
    const divergence = 'NONE';
    const strength = 0;
    const reason = 'OI data unavailable (MEXC Migration)';

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
