// ============================================================
// Global Price Cache — Shared price feed for all modules
// Prevents MEXC/Binance IP bans by deduplicating requests
// TTL: 30s for active symbols, 120s for inactive
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PriceCache');

interface CachedPrice {
  price: number;
  source: string;
  fetchedAt: number;
  ttl: number;
}

// Singleton via globalThis to survive Next.js hot reload
const g = globalThis as unknown as {
  __priceCache?: Map<string, CachedPrice>;
  __priceFetchLocks?: Map<string, Promise<number>>;
};
if (!g.__priceCache) g.__priceCache = new Map();
if (!g.__priceFetchLocks) g.__priceFetchLocks = new Map();

const cache = g.__priceCache;
const locks = g.__priceFetchLocks;

const DEFAULT_TTL = 30_000;       // 30s for normal access
const EXTENDED_TTL = 120_000;     // 2min for fallback tolerance

export function getCachedPrice(symbol: string): number | null {
  const entry = cache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > entry.ttl) return null;
  return entry.price;
}

export function setCachedPrice(symbol: string, price: number, source: string, ttl = DEFAULT_TTL): void {
  if (price <= 0) return;
  cache.set(symbol, { price, source, fetchedAt: Date.now(), ttl });
}

/**
 * Get or fetch a price. Uses dedup lock to prevent parallel fetches for the same symbol.
 * Chain: MEXC → Binance → OKX → DexScreener → CoinGecko
 */
export async function getOrFetchPrice(symbol: string): Promise<number> {
  // 1. Check cache
  const cached = getCachedPrice(symbol);
  if (cached !== null) return cached;

  // 2. Dedup: if another call is already fetching this symbol, wait for it
  const existing = locks.get(symbol);
  if (existing) return existing;

  // 3. Fetch with multi-exchange fallback
  const fetchPromise = fetchPriceChain(symbol);
  locks.set(symbol, fetchPromise);

  try {
    const price = await fetchPromise;
    return price;
  } finally {
    locks.delete(symbol);
  }
}

async function fetchPriceChain(symbol: string): Promise<number> {
  // ═══ FORMAT GUARD: Block garbage symbols before they flood APIs ═══
  // Solana pump token addresses, contract addresses, and malformed symbols
  // must be caught here to prevent 5-source cascade failure
  if (symbol.length > 25 || /[^A-Za-z0-9_]/.test(symbol)) {
    log.warn(`[PriceCache] Rejected malformed symbol: ${symbol.slice(0, 30)}...`);
    return 0;
  }

  const mexcSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;

  // 1. MEXC (primary live exchange)
  try {
    const { getMexcPrice } = await import('@/lib/exchange/mexcClient');
    const price = await getMexcPrice(mexcSymbol);
    if (price > 0) {
      setCachedPrice(symbol, price, 'MEXC', DEFAULT_TTL);
      return price;
    }
  } catch { /* next */ }

  // 2. Binance (Removed due to Geo-block)

  // 3. OKX
  try {
    const { getOkxPrice } = await import('@/lib/exchange/okxClient');
    const price = await getOkxPrice(mexcSymbol);
    if (price > 0) {
      setCachedPrice(symbol, price, 'OKX', DEFAULT_TTL);
      return price;
    }
  } catch { /* next */ }

  // 4. DexScreener (Solana tokens)
  try {
    const dexMap: Record<string, string> = {
      SOL: 'So11111111111111111111111111111111111111112',
      BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
      JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
      RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      RNDR: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
    };
    const base = symbol.replace('USDT', '');
    const addr = dexMap[base];
    if (addr) {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${addr}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const pairs = await res.json();
        if (Array.isArray(pairs) && pairs.length > 0) {
          const price = parseFloat(pairs[0].priceUsd || '0');
          if (price > 0) {
            setCachedPrice(symbol, price, 'DexScreener', EXTENDED_TTL);
            return price;
          }
        }
      }
    }
  } catch { /* next */ }

  // 5. CoinGecko (final fallback)
  try {
    const cgMap: Record<string, string> = {
      BTC: 'bitcoin', BTCUSDT: 'bitcoin',
      ETH: 'ethereum', ETHUSDT: 'ethereum',
      SOL: 'solana', SOLUSDT: 'solana',
      BONK: 'bonk', BONKUSDT: 'bonk',
      WIF: 'dogwifcoin', WIFUSDT: 'dogwifcoin',
      JUP: 'jupiter-exchange-solana',
      RAY: 'raydium', RNDR: 'render-token',
      XRP: 'ripple', XRPUSDT: 'ripple',
    };
    const base = symbol.replace('USDT', '');
    const cgId = cgMap[base] || cgMap[symbol] || base.toLowerCase();
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const data = await res.json();
      const price = data[cgId]?.usd;
      if (price && price > 0) {
        setCachedPrice(symbol, price, 'CoinGecko', EXTENDED_TTL);
        return price;
      }
    }
  } catch { /* all failed */ }

  log.error(`[PriceCache] All 5 sources failed for ${symbol}`);
  return 0;
}

/**
 * Batch fetch prices. Groups and deduplicates automatically.
 */
export async function batchFetchPrices(symbols: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(symbols)];
  const results: Record<string, number> = {};

  // Split into chunks of 10 to prevent flood
  const CHUNK = 10;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const prices = await Promise.all(chunk.map(s => getOrFetchPrice(s).catch(() => 0)));
    chunk.forEach((sym, idx) => {
      if (prices[idx] > 0) results[sym] = prices[idx];
    });
    // Small delay between chunks
    if (i + CHUNK < unique.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}

export function getPriceCacheStats(): { size: number; symbols: string[] } {
  return {
    size: cache.size,
    symbols: [...cache.keys()],
  };
}
