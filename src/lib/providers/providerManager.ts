// ============================================================
// Provider Manager — orchestrates all providers, caching, dedup
// ============================================================
import { NormalizedToken, ProviderHealth } from '@/lib/types';
import { cache } from '@/lib/cache';
import { normalizeDexScreenerPair, normalizePumpToken, deduplicateTokens } from '@/lib/normalizers';
import { scoreTokens } from '@/lib/scoring';
import { recordProviderHealth } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('ProviderManager');

// Providers
import { getLatestBoosts, getTopBoosts, searchPairs, getTokenPairs, getOrders, dexScreenerHealthCheck } from '@/lib/providers/dexScreenerProvider';
import { birdeyeHealthCheck, getTokenOverview } from '@/lib/providers/birdeyeProvider';
import { jupiterHealthCheck, getPrice } from '@/lib/providers/jupiterProvider';
import { rugcheckHealthCheck, getTokenReport, getNewTokens } from '@/lib/providers/rugcheckProvider';
import { geckoTerminalHealthCheck, getTrendingPools } from '@/lib/providers/geckoTerminalProvider';
import { pumpHealthCheck, getPumpTokens } from '@/lib/providers/pumpProvider';

const CACHE_KEY_TOKENS = 'aggregated_tokens';
const CACHE_KEY_HEALTH = 'provider_health';

/**
 * Fetch tokens from all providers, normalize, deduplicate, score.
 */
export async function getAggregatedTokens(): Promise<NormalizedToken[]> {
  // Check cache first
  const cached = cache.get<NormalizedToken[]>(CACHE_KEY_TOKENS);
  if (cached) {
    return cached.data.map((t) => ({ ...t, dataFreshness: cached.freshness }));
  }

  const allTokens: NormalizedToken[] = [];

  // --- DEX Screener: boosts + trending ---
  const [boostsRes, topBoostsRes, trendingSearch] = await Promise.allSettled([
    getLatestBoosts(),
    getTopBoosts(),
    searchPairs('SOL'),
  ]);

  // Process boost results for detailed pair data
  const boostAddresses = new Set<string>();
  if (boostsRes.status === 'fulfilled' && boostsRes.value.data) {
    for (const b of boostsRes.value.data) {
      if (b.chainId === 'solana') boostAddresses.add(b.tokenAddress);
    }
  }
  if (topBoostsRes.status === 'fulfilled' && topBoostsRes.value.data) {
    for (const b of topBoostsRes.value.data) {
      if (b.chainId === 'solana') boostAddresses.add(b.tokenAddress);
    }
  }

  // Get pair data for boosted tokens
  const boostPairPromises = Array.from(boostAddresses).slice(0, 20).map(async (addr) => {
    try {
      const res = await getTokenPairs('solana', addr);
      if (res.data?.pairs) {
        for (const pair of res.data.pairs) {
          const token = normalizeDexScreenerPair(pair);
          // Find boost amount
          if (boostsRes.status === 'fulfilled' && boostsRes.value.data) {
            const boost = boostsRes.value.data.find(
              (b) => b.tokenAddress === addr
            );
            if (boost) token.boostLevel = boost.totalAmount || boost.amount;
          }
          allTokens.push(token);
        }
      }
    } catch { /* skip failed */ }
  });

  // Process search results
  if (trendingSearch.status === 'fulfilled' && trendingSearch.value.data?.pairs) {
    for (const pair of trendingSearch.value.data.pairs.slice(0, 30)) {
      if (pair.chainId === 'solana') {
        allTokens.push(normalizeDexScreenerPair(pair));
      }
    }
  }

  await Promise.allSettled(boostPairPromises);

  // --- Pump tokens ---
  try {
    const pumpRes = await getPumpTokens();
    if (pumpRes.data) {
      for (const pt of pumpRes.data.slice(0, 30)) {
        allTokens.push(normalizePumpToken(pt));
      }
    }
  } catch { /* skip */ }

  // --- Rugcheck new tokens (cross-reference) ---
  try {
    const newTokensRes = await getNewTokens();
    if (newTokensRes.data) {
      // Mark any matching tokens as fresh
      const newMints = new Set(newTokensRes.data.map((t) => t.mint));
      for (const token of allTokens) {
        if (newMints.has(token.tokenAddress)) {
          token.freshWalletSignal = true;
        }
      }
    }
  } catch { /* skip */ }

  // --- GeckoTerminal trending (fallback) ---
  try {
    const geckoRes = await getTrendingPools();
    if (geckoRes.data?.data) {
      for (const pool of geckoRes.data.data.slice(0, 10)) {
        // Extract token address from pool id
        const attrs = pool.attributes;
        if (attrs) {
          const token: NormalizedToken = {
            tokenAddress: pool.id.split('_').pop() || pool.id,
            chain: 'solana',
            symbol: attrs.name?.split('/')[0] || '',
            name: attrs.name || '',
            sourceOrigin: ['geckoterminal'],
            launchSource: 'unknown',
            launchedAt: attrs.pool_created_at || null,
            price: parseFloat(attrs.base_token_price_usd) || null,
            marketCap: attrs.market_cap_usd ? parseFloat(attrs.market_cap_usd) : null,
            liquidity: parseFloat(attrs.reserve_in_usd) || null,
            volume5m: null,
            volume1h: attrs.volume_usd?.h1 ? parseFloat(attrs.volume_usd.h1) : null,
            volume24h: attrs.volume_usd?.h24 ? parseFloat(attrs.volume_usd.h24) : null,
            buys5m: null,
            sells5m: null,
            priceChange5m: null,
            priceChange1h: attrs.price_change_percentage?.h1 ? parseFloat(attrs.price_change_percentage.h1) : null,
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
            dataFreshness: 'FALLBACK',
            poolAddress: attrs.address,
            dexName: null,
            imageUrl: null,
          };
          allTokens.push(token);
        }
      }
    }
  } catch { /* skip */ }

  // Deduplicate
  const deduped = deduplicateTokens(allTokens);

  // Score all tokens
  const scored = scoreTokens(deduped);

  // Sort by conviction score descending
  scored.sort((a, b) => b.convictionScore - a.convictionScore);

  // Cache results
  cache.set(CACHE_KEY_TOKENS, scored);

  return scored;
}

/**
 * Get detailed info for a single token — enriched from all providers.
 */
export async function getTokenDetail(address: string): Promise<NormalizedToken | null> {
  // Start with aggregated data
  const allTokens = await getAggregatedTokens();
  let token = allTokens.find((t) => t.tokenAddress === address) || null;

  if (!token) {
    // Try fetching directly from DEX Screener
    const res = await getTokenPairs('solana', address);
    if (res.data?.pairs?.[0]) {
      token = normalizeDexScreenerPair(res.data.pairs[0]);
    }
  }

  if (!token) return null;

  // Enrich with Rugcheck
  try {
    const rugRes = await getTokenReport(address);
    if (rugRes.data) {
      token.rugWarnings = rugRes.data.risks?.map((r) => `${r.name}: ${r.description}`) || [];
      if (rugRes.data.score !== undefined) {
        if (rugRes.data.score > 800) token.rugRisk = 'critical';
        else if (rugRes.data.score > 500) token.rugRisk = 'high';
        else if (rugRes.data.score > 200) token.rugRisk = 'medium';
        else token.rugRisk = 'low';
      }
      if (!token.sourceOrigin.includes('rugcheck')) {
        token.sourceOrigin.push('rugcheck');
      }
    }
  } catch { /* skip */ }

  // Enrich with Birdeye
  try {
    const birdRes = await getTokenOverview(address);
    if (birdRes.data?.data) {
      const d = birdRes.data.data;
      token.holders = d.holder ?? token.holders;
      token.volume24h = d.volume24hUSD ?? token.volume24h;
      if (!token.sourceOrigin.includes('birdeye')) {
        token.sourceOrigin.push('birdeye');
      }
    }
  } catch { /* skip */ }

  // Enrich with Jupiter price
  try {
    const jupRes = await getPrice([address]);
    if (jupRes.data?.data?.[address]) {
      token.jupiterQuoteQuality = 80; // If Jupiter has a price, route quality is decent
      if (!token.sourceOrigin.includes('jupiter')) {
        token.sourceOrigin.push('jupiter');
      }
    }
  } catch { /* skip */ }

  // Enrich with paid orders
  try {
    const ordersRes = await getOrders('solana', address);
    if (ordersRes.data) {
      token.paidOrders = ordersRes.data.length;
    }
  } catch { /* skip */ }

  // Re-score with enriched data
  const [scored] = scoreTokens([token]);
  return scored;
}

/**
 * Get health status of all providers.
 */
export async function getAllProviderHealth(): Promise<ProviderHealth[]> {
  const cached = cache.get<ProviderHealth[]>(CACHE_KEY_HEALTH);
  if (cached) return cached.data;

  const names: ProviderHealth['name'][] = ['dexscreener', 'birdeye', 'jupiter', 'rugcheck', 'geckoterminal', 'pump'];
  
  const results = await Promise.allSettled([
    dexScreenerHealthCheck(),
    birdeyeHealthCheck(),
    jupiterHealthCheck(),
    rugcheckHealthCheck(),
    geckoTerminalHealthCheck(),
    pumpHealthCheck(),
  ]);

  const healths: ProviderHealth[] = results.map((r, i) => {
    let health: ProviderHealth;

    if (r.status === 'fulfilled') {
      health = r.value;
    } else {
      health = {
        name: names[i] as ProviderHealth['name'],
        status: 'down' as const,
        lastCheck: new Date().toISOString(),
        latencyMs: null,
        message: `Exception: ${(r.reason as Error).message}`,
      };
    }

    // Record to core heartbeat system
    recordProviderHealth(
      health.name,
      health.status === 'healthy' || health.status === 'degraded',
      health.latencyMs
    );

    if (health.status !== 'healthy') {
      log.warn(`Provider ${health.name} is ${health.status}`, { latencyMs: health.latencyMs, message: health.message });
    }

    return health;
  });

  cache.set(CACHE_KEY_HEALTH, healths);
  return healths;
}
