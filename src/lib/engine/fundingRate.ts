// ============================================================
// Funding Rate Signal — Contrarian crypto-specific indicator
// Negative funding = shorts paying longs = squeeze setup (BUY)
// Extreme positive = longs over-leveraged = dump risk (SELL)
// ============================================================
import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('FundingRate');

export interface FundingRateData {
  symbol: string;
  rate: number;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  strength: number;   // 0-1 signal strength
  reason: string;
  nextFundingTime: string;
  cached: boolean;
}

// Cache: funding rate updates every 8h, cache for 30 min
const gfr = globalThis as unknown as {
  __fundingCache?: Record<string, { data: FundingRateData; at: number }>;
};
if (!gfr.__fundingCache) gfr.__fundingCache = {};
const CACHE_TTL = 30 * 60_000;

// Funding rate thresholds (based on historical BTC data)
const EXTREME_NEGATIVE = -0.01;   // -0.01% → short squeeze risk
const NEGATIVE = -0.005;          // -0.005% → mild squeeze bias
const EXTREME_POSITIVE = 0.05;    // +0.05% → longs over-leveraged
const HIGH_POSITIVE = 0.03;       // +0.03% → caution zone

/**
 * Fetch funding rate from Binance Futures
 */
export async function getFundingRate(symbol: string = 'BTCUSDT'): Promise<FundingRateData> {
  const cacheKey = symbol;
  const cached = gfr.__fundingCache?.[cacheKey];
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...cached.data, cached: true };
  }

  try {
    const res = await fetchWithRetry(
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
      { retries: 2, timeoutMs: 5000 }
    );
    const data = await res.json();

    const rate = parseFloat(data?.lastFundingRate || '0');
    const nextFundingTime = data?.nextFundingTime
      ? new Date(data.nextFundingTime).toISOString()
      : '';

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let strength = 0;
    let reason = `Funding: ${(rate * 100).toFixed(4)}%`;

    if (rate <= EXTREME_NEGATIVE) {
      signal = 'BUY';
      strength = 0.9;
      reason = `🔥 Extreme negative funding ${(rate * 100).toFixed(4)}% → Short squeeze setup`;
    } else if (rate <= NEGATIVE) {
      signal = 'BUY';
      strength = 0.5;
      reason = `📈 Negative funding ${(rate * 100).toFixed(4)}% → Mild squeeze bias`;
    } else if (rate >= EXTREME_POSITIVE) {
      signal = 'SELL';
      strength = 0.9;
      reason = `⚠️ Extreme positive funding ${(rate * 100).toFixed(4)}% → Longs over-leveraged`;
    } else if (rate >= HIGH_POSITIVE) {
      signal = 'SELL';
      strength = 0.5;
      reason = `📉 High positive funding ${(rate * 100).toFixed(4)}% → Caution zone`;
    } else {
      reason = `Neutral funding ${(rate * 100).toFixed(4)}%`;
    }

    const result: FundingRateData = {
      symbol, rate, signal, strength, reason, nextFundingTime, cached: false,
    };

    gfr.__fundingCache![cacheKey] = { data: result, at: Date.now() };
    log.info(`Funding rate ${symbol}: ${(rate * 100).toFixed(4)}% → ${signal}`);
    return result;
  } catch (err) {
    log.warn('Funding rate fetch failed', { error: (err as Error).message });
    return {
      symbol, rate: 0, signal: 'NEUTRAL', strength: 0,
      reason: 'Funding rate unavailable', nextFundingTime: '', cached: false,
    };
  }
}
