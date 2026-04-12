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
 * Fetch funding rate from MEXC Futures
 */
export async function getFundingRate(symbol: string = 'BTCUSDT'): Promise<FundingRateData> {
  const cacheKey = symbol;
  const cached = gfr.__fundingCache?.[cacheKey];
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...cached.data, cached: true };
  }

  try {
    const mexcSymbol = symbol.replace('USDT', '_USDT');
    // GET https://contract.mexc.com/api/v1/contract/funding_rate/{symbol}
    const res = await fetchWithRetry(`https://contract.mexc.com/api/v1/contract/funding_rate/${mexcSymbol}`, { 
      retries: 2, 
      timeoutMs: 5000 
    });
    
    if (!res.ok) throw new Error(`MEXC Contract HTTP ${res.status}`);
    
    const json = await res.json();
    if (!json.success || !json.data) throw new Error('MEXC Contract invalid response');

    // Convert decimal to percentage for internal threshold comparison (e.g. 0.0001 -> 0.01)
    const rawRate = json.data.fundingRate || 0;
    const rate = rawRate * 100;
    const nextFundingTime = new Date(json.data.nextSettleTime).toISOString();

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let strength = 0;
    let reason = `Funding: ${rate.toFixed(4)}%`;

    if (rate <= EXTREME_NEGATIVE) {
      signal = 'BUY';
      strength = 1.0;
      reason = `🔥 SQUEEZE ALERT: Extreme negative funding (${rate.toFixed(4)}%). Shorts trapped, prime for violent short-squeeze.`;
    } else if (rate <= NEGATIVE) {
      signal = 'BUY';
      strength = 0.6;
      reason = `Squeeze Setup: Negative funding (${rate.toFixed(4)}%). Market structurally short, leans bullish.`;
    } else if (rate >= EXTREME_POSITIVE) {
      signal = 'SELL';
      strength = 1.0;
      reason = `⚠️ DUMP RISK: Extreme positive funding (${rate.toFixed(4)}%). Longs over-leveraged.`;
    } else if (rate >= HIGH_POSITIVE) {
      signal = 'SELL';
      strength = 0.5;
      reason = `Caution: High positive funding (${rate.toFixed(4)}%). Downside wash risk.`;
    }

    const result: FundingRateData = {
      symbol, rate, signal, strength, reason, nextFundingTime, cached: false,
    };

    gfr.__fundingCache![cacheKey] = { data: result, at: Date.now() };
    log.info(`Funding rate ${symbol}: ${rate.toFixed(4)}% → ${signal}`);
    return result;
  } catch (err) {
    log.warn('Funding rate fetch failed', { error: (err as Error).message });
    return {
      symbol, rate: 0, signal: 'NEUTRAL', strength: 0,
      reason: 'Funding rate unavailable', nextFundingTime: '', cached: false,
    };
  }
}
