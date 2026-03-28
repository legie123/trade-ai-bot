import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('HistoricalFetcher');

export interface HistoricCandle {
  t: number; // Timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Fetches deep historical data using CryptoCompare
 * Safe for Vercel (no IP blocks like Binance)
 * @param symbol e.g., 'BTC', 'SOL'
 * @param interval '15m' | '1h' | '4h' | '1d'
 * @param days number of days of history to fetch
 */
export async function fetchDeepHistory(
  symbol: string,
  interval: '15m' | '1h' | '4h' | '1d',
  days: number
): Promise<HistoricCandle[]> {
  try {
    const endpointMap: Record<string, { api: string; aggregate: number; minutes: number }> = {
      '15m': { api: 'histominute', aggregate: 15, minutes: 15 },
      '1h': { api: 'histohour', aggregate: 1, minutes: 60 },
      '4h': { api: 'histohour', aggregate: 4, minutes: 240 },
      '1d': { api: 'histoday', aggregate: 1, minutes: 1440 },
    };

    const { api, aggregate, minutes } = endpointMap[interval] || endpointMap['1h'];
    const totalCandles = Math.ceil((days * 24 * 60) / minutes);
    
    let remaining = totalCandles;
    let toTs = Math.floor(Date.now() / 1000); // end time in seconds
    const allCandles: HistoricCandle[] = [];

    // CryptoCompare limit is 2000 per request.
    while (remaining > 0) {
      const limit = Math.min(remaining, 2000);
      const url = `https://min-api.cryptocompare.com/data/v2/${api}?fsym=${symbol}&tsym=USDT&limit=${limit}&aggregate=${aggregate}&toTs=${toTs}`;
      
      const res = await fetchWithRetry(url, { retries: 2, timeoutMs: 10000 });
      const json = await res.json();
      const data = json?.Data?.Data;
      
      if (!Array.isArray(data) || data.length === 0) break;

      // Map to HistoricCandle and prepend to array
      const mapped = data.map((k: any) => ({
        t: k.time * 1000,
        o: k.open,
        h: k.high,
        l: k.low,
        c: k.close,
        v: k.volumeto || k.volumefrom || 0
      }));

      // CryptoCompare returns oldest to newest up to `toTs`
      // So we must unshift (prepend) mapped array, but wait:
      // mapped is [oldest, ..., newest=toTs].
      allCandles.unshift(...mapped);

      // Update toTs for next loop (the time of the oldest candle we just fetched)
      toTs = data[0].time - 1;
      remaining -= limit;

      // Slight delay to avoid rate limits if we do many loops
      if (remaining > 0) {
         await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Sort chronologically just to be sure
    allCandles.sort((a, b) => a.t - b.t);

    log.info(`Fetched ${allCandles.length} ${interval} candles for ${symbol} (${days} days)`);
    return allCandles;

  } catch (err) {
    log.error(`Deep history fetch failed for ${symbol}`, { error: String(err) });
    return [];
  }
}
