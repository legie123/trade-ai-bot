// ============================================================
// Token Normalizers — per-provider → NormalizedToken mappers
// ============================================================
import { NormalizedToken, DataFreshness } from '@/lib/types';
import { DexScreenerPair } from '@/lib/providers/dexScreenerProvider';
import { GeckoPoolAttributes } from '@/lib/providers/geckoTerminalProvider';
import { PumpToken } from '@/lib/providers/pumpProvider';

/** Default empty token skeleton */
function emptyToken(address: string): NormalizedToken {
  return {
    tokenAddress: address,
    chain: 'solana',
    symbol: '',
    name: '',
    sourceOrigin: [],
    launchSource: 'unknown',
    launchedAt: null,
    price: null,
    marketCap: null,
    liquidity: null,
    volume5m: null,
    volume1h: null,
    volume24h: null,
    buys5m: null,
    sells5m: null,
    priceChange5m: null,
    priceChange1h: null,
    holders: null,
    boostLevel: null,
    paidOrders: null,
    rugRisk: 'unknown',
    rugWarnings: [],
    smartMoneySignal: false,
    freshWalletSignal: false,
    graduationStatus: 'unknown',
    jupiterQuoteQuality: null,
    dealScore: 0,
    riskScore: 0,
    convictionScore: 0,
    lastUpdated: new Date().toISOString(),
    dataFreshness: 'LIVE',
    poolAddress: null,
    dexName: null,
    imageUrl: null,
  };
}

/** Normalize a DEX Screener pair */
export function normalizeDexScreenerPair(pair: DexScreenerPair): NormalizedToken {
  const token = emptyToken(pair.baseToken.address);
  token.symbol = pair.baseToken.symbol;
  token.name = pair.baseToken.name;
  token.sourceOrigin = ['dexscreener'];
  token.price = parseFloat(pair.priceUsd) || null;
  token.marketCap = pair.marketCap || pair.fdv || null;
  token.liquidity = pair.liquidity?.usd ?? null;
  token.volume5m = pair.volume?.m5 ?? null;
  token.volume1h = pair.volume?.h1 ?? null;
  token.volume24h = pair.volume?.h24 ?? null;
  token.buys5m = pair.txns?.m5?.buys ?? null;
  token.sells5m = pair.txns?.m5?.sells ?? null;
  token.priceChange5m = pair.priceChange?.m5 ?? null;
  token.priceChange1h = pair.priceChange?.h1 ?? null;
  token.boostLevel = pair.boosts?.active ?? null;
  token.poolAddress = pair.pairAddress;
  token.dexName = pair.dexId;
  token.imageUrl = pair.info?.imageUrl ?? null;
  token.launchedAt = pair.pairCreatedAt
    ? new Date(pair.pairCreatedAt).toISOString()
    : null;

  // Detect pump origin from dex name
  if (pair.dexId?.toLowerCase().includes('pump')) {
    token.launchSource = 'pump';
    token.graduationStatus = 'bonding';
  } else if (pair.dexId?.toLowerCase().includes('raydium')) {
    token.launchSource = 'raydium';
  }

  return token;
}

/** Normalize a GeckoTerminal pool */
export function normalizeGeckoPool(pool: GeckoPoolAttributes, address: string): NormalizedToken {
  const token = emptyToken(address);
  token.sourceOrigin = ['geckoterminal'];
  token.name = pool.name;
  token.price = parseFloat(pool.base_token_price_usd) || null;
  token.marketCap = pool.market_cap_usd ? parseFloat(pool.market_cap_usd) : null;
  token.liquidity = parseFloat(pool.reserve_in_usd) || null;
  token.volume1h = pool.volume_usd?.h1 ? parseFloat(pool.volume_usd.h1) : null;
  token.volume24h = pool.volume_usd?.h24 ? parseFloat(pool.volume_usd.h24) : null;
  token.priceChange1h = pool.price_change_percentage?.h1
    ? parseFloat(pool.price_change_percentage.h1)
    : null;
  token.poolAddress = pool.address;
  token.launchedAt = pool.pool_created_at || null;
  token.dataFreshness = 'FALLBACK';
  return token;
}

/** Normalize a Pump composite token */
export function normalizePumpToken(pt: PumpToken): NormalizedToken {
  const token = pt.pair
    ? normalizeDexScreenerPair(pt.pair)
    : emptyToken(pt.tokenAddress);
  token.symbol = pt.symbol || token.symbol;
  token.name = pt.name || token.name;
  token.launchSource = 'pump';
  token.graduationStatus = pt.graduationStatus;
  if (!token.sourceOrigin.includes('pump')) {
    token.sourceOrigin.push('pump');
  }
  return token;
}

/**
 * Merge two tokens (same address) — prefer non-null, more recent, richer data.
 */
export function mergeTokens(a: NormalizedToken, b: NormalizedToken): NormalizedToken {
  const merged = { ...a };

  // Merge source origins
  const origins = new Set([...a.sourceOrigin, ...b.sourceOrigin]);
  merged.sourceOrigin = Array.from(origins) as NormalizedToken['sourceOrigin'];

  // Prefer non-null values from b
  const keys = Object.keys(b) as (keyof NormalizedToken)[];
  for (const key of keys) {
    if (key === 'sourceOrigin' || key === 'rugWarnings') continue;
    const bVal = b[key];
    const aVal = a[key];
    if (bVal !== null && bVal !== undefined && bVal !== 0 && bVal !== '') {
      if (aVal === null || aVal === undefined || aVal === 0 || aVal === '') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[key] = bVal;
      }
    }
  }

  // Merge rug warnings
  merged.rugWarnings = [...new Set([...a.rugWarnings, ...b.rugWarnings])];

  // Pick best freshness
  const freshnessOrder: DataFreshness[] = ['LIVE', 'CACHED', 'FALLBACK', 'UNAVAILABLE'];
  const aIdx = freshnessOrder.indexOf(a.dataFreshness);
  const bIdx = freshnessOrder.indexOf(b.dataFreshness);
  merged.dataFreshness = aIdx <= bIdx ? a.dataFreshness : b.dataFreshness;

  return merged;
}

/**
 * Deduplicate and merge a list of tokens by tokenAddress.
 */
export function deduplicateTokens(tokens: NormalizedToken[]): NormalizedToken[] {
  const map = new Map<string, NormalizedToken>();
  for (const token of tokens) {
    const existing = map.get(token.tokenAddress);
    if (existing) {
      map.set(token.tokenAddress, mergeTokens(existing, token));
    } else {
      map.set(token.tokenAddress, token);
    }
  }
  return Array.from(map.values());
}
