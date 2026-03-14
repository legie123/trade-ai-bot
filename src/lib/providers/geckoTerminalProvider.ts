// ============================================================
// GeckoTerminal Provider Adapter (fallback)
// ============================================================
import { providerFetch, checkHealth } from './base';
import { ProviderHealth, ProviderResponse } from '@/lib/types';

const BASE = 'https://api.geckoterminal.com/api/v2';
const PROVIDER = 'geckoterminal' as const;

// ----- Raw types -----
export interface GeckoTokenAttributes {
  name: string;
  symbol: string;
  address: string;
  decimals: number;
  image_url: string | null;
  coingecko_coin_id: string | null;
  price_usd: string | null;
  fdv_usd: string | null;
  total_reserve_in_usd: string | null;
  market_cap_usd: string | null;
  volume_usd: { h24: string | null };
}

export interface GeckoPoolAttributes {
  name: string;
  address: string;
  base_token_price_usd: string;
  quote_token_price_usd: string;
  reserve_in_usd: string;
  pool_created_at: string;
  fdv_usd: string;
  market_cap_usd: string | null;
  price_change_percentage: { h1: string; h24: string };
  transactions: {
    h1: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume_usd: { h1: string; h24: string };
}

export interface GeckoTrendingPool {
  id: string;
  type: string;
  attributes: GeckoPoolAttributes;
  relationships?: Record<string, unknown>;
}

// ----- API Functions -----

/** Get token info on Solana */
export async function getToken(address: string): Promise<ProviderResponse<{ data: { attributes: GeckoTokenAttributes } }>> {
  return providerFetch<{ data: { attributes: GeckoTokenAttributes } }>(
    PROVIDER,
    `${BASE}/networks/solana/tokens/${address}`
  );
}

/** Get pool info */
export async function getPool(poolAddress: string): Promise<ProviderResponse<{ data: { attributes: GeckoPoolAttributes } }>> {
  return providerFetch<{ data: { attributes: GeckoPoolAttributes } }>(
    PROVIDER,
    `${BASE}/networks/solana/pools/${poolAddress}`
  );
}

/** Get trending pools on Solana */
export async function getTrendingPools(): Promise<ProviderResponse<{ data: GeckoTrendingPool[] }>> {
  return providerFetch<{ data: GeckoTrendingPool[] }>(
    PROVIDER,
    `${BASE}/networks/solana/trending_pools`
  );
}

/** Search pools by token */
export async function searchPools(query: string): Promise<ProviderResponse<{ data: GeckoTrendingPool[] }>> {
  return providerFetch<{ data: GeckoTrendingPool[] }>(
    PROVIDER,
    `${BASE}/search/pools?query=${encodeURIComponent(query)}&network=solana`
  );
}

/** Health check */
export async function geckoTerminalHealthCheck(): Promise<ProviderHealth> {
  return checkHealth(PROVIDER, `${BASE}/networks/solana/trending_pools`);
}
