// ============================================================
// API Price Fallback — Multi-exchange resilient fetching
// Chain: MEXC → Binance → OKX → DexScreener → CoinGecko
// Uses global price cache for deduplication
// ============================================================
import { createLogger } from '@/lib/core/logger';
import { getOrFetchPrice, getCachedPrice, setCachedPrice } from '@/lib/cache/priceCache';

const log = createLogger('ApiFallback');

export interface FallbackPrice {
  symbol: string;
  price: number;
  source: string;
  latencyMs: number;
}

/**
 * Main resilient price fetcher. Delegates to global cache which chains
 * MEXC → Binance → OKX → DexScreener → CoinGecko automatically.
 */
export async function getResilientPrice(symbol: string): Promise<FallbackPrice> {
  const start = Date.now();
  const normalizedSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;

  // Check cache first (instant)
  const cached = getCachedPrice(normalizedSymbol);
  if (cached !== null) {
    return { symbol, price: cached, source: 'Cache', latencyMs: 0 };
  }

  // Fetch through 5-exchange chain
  const price = await getOrFetchPrice(normalizedSymbol);
  if (price > 0) {
    return { symbol, price, source: 'MultiExchange', latencyMs: Date.now() - start };
  }

  // BONK special handling (Binance uses 1000BONK)
  if (symbol === 'BONK' || symbol === 'BONKUSDT') {
    try {
      const { getMexcPrice } = await import('@/lib/exchange/mexcClient');
      const mxPrice = await getMexcPrice('BONKUSDT');
      if (mxPrice > 0) {
        setCachedPrice(normalizedSymbol, mxPrice, 'MEXC-Direct');
        return { symbol, price: mxPrice, source: 'MEXC-Direct', latencyMs: Date.now() - start };
      }
    } catch { /* already tried in chain */ }
  }

  log.error('All price sources failed', { symbol });
  throw new Error(`Failed to fetch price for ${symbol} across all providers`);
}
