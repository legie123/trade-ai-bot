// ============================================================
// DexScreener Provider — FREE, no rate limits, no API key
// Provides real-time Solana token data: price, volume, liquidity
// ============================================================
import { fetchWithRetry } from '@/lib/providers/base';

export interface DexPair {
  symbol: string;
  name: string;
  price: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  fdv: number;
  pairAddress: string;
  dexId: string;
  chainId: string;
  txns24h: { buys: number; sells: number };
}

// ─── Global cache ──────────────────────────────────
const g = globalThis as unknown as {
  __dexCache?: { data: DexPair[]; ts: number };
};
if (!g.__dexCache) g.__dexCache = { data: [], ts: 0 };

const CACHE_TTL = 60_000; // 1 min (DexScreener allows frequent calls)

// ─── Search for tokens ─────────────────────────────
export async function searchDex(query: string): Promise<DexPair[]> {
  try {
    const res = await fetchWithRetry(
      `https://api.dexscreener.com/dex/search?q=${encodeURIComponent(query)}`,
      { retries: 2, timeoutMs: 8000 }
    );
    const data = await res.json();
    return parsePairs(data?.pairs || []);
  } catch {
    return [];
  }
}

// ─── Get top Solana pairs ──────────────────────────
export async function getTopSolanaPairs(limit = 20): Promise<DexPair[]> {
  const now = Date.now();
  if (now - g.__dexCache!.ts < CACHE_TTL && g.__dexCache!.data.length > 0) {
    return g.__dexCache!.data;
  }

  try {
    const res = await fetchWithRetry(
      'https://api.dexscreener.com/dex/tokens/So11111111111111111111111111111111111111112',
      { retries: 2, timeoutMs: 8000 }
    );
    const data = await res.json();
    const pairs = parsePairs(data?.pairs || []).slice(0, limit);
    g.__dexCache!.data = pairs;
    g.__dexCache!.ts = now;
    return pairs;
  } catch {
    return g.__dexCache!.data;
  }
}

// ─── Get specific token by address ─────────────────
export async function getTokenByAddress(address: string): Promise<DexPair | null> {
  try {
    const res = await fetchWithRetry(
      `https://api.dexscreener.com/dex/tokens/${address}`,
      { retries: 1, timeoutMs: 6000 }
    );
    const data = await res.json();
    const pairs = parsePairs(data?.pairs || []);
    return pairs[0] || null;
  } catch {
    return null;
  }
}

// ─── Get multiple tokens by symbols ────────────────
export async function getTokensBySymbols(symbols: string[]): Promise<Record<string, DexPair>> {
  const result: Record<string, DexPair> = {};

  // DexScreener search endpoint handles multiple queries
  for (const sym of symbols) {
    try {
      const pairs = await searchDex(sym);
      // Find the Solana pair with highest liquidity
      const solanaPair = pairs
        .filter((p) => p.chainId === 'solana')
        .sort((a, b) => b.liquidity - a.liquidity)[0];
      if (solanaPair) result[sym] = solanaPair;
    } catch {
      // skip
    }
    // Small delay to be polite
    await new Promise((r) => setTimeout(r, 300));
  }

  return result;
}

// ─── Parse raw DexScreener API response ────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function parsePairs(raw: any[]): DexPair[] {
  return raw
    .filter((p: any) => p.chainId === 'solana' && p.priceUsd)
    .map((p: any) => ({
      symbol: p.baseToken?.symbol || '?',
      name: p.baseToken?.name || '',
      price: parseFloat(p.priceUsd) || 0,
      priceChange5m: p.priceChange?.m5 || 0,
      priceChange1h: p.priceChange?.h1 || 0,
      priceChange6h: p.priceChange?.h6 || 0,
      priceChange24h: p.priceChange?.h24 || 0,
      volume24h: p.volume?.h24 || 0,
      liquidity: p.liquidity?.usd || 0,
      fdv: p.fdv || 0,
      pairAddress: p.pairAddress || '',
      dexId: p.dexId || '',
      chainId: p.chainId || '',
      txns24h: {
        buys: p.txns?.h24?.buys || 0,
        sells: p.txns?.h24?.sells || 0,
      },
    }))
    .sort((a: DexPair, b: DexPair) => b.volume24h - a.volume24h);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
