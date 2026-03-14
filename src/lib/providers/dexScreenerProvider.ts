// ============================================================
// DEX Screener Provider Adapter
// ============================================================
import { providerFetch, checkHealth } from './base';
import { ProviderHealth, ProviderResponse } from '@/lib/types';

const BASE = 'https://api.dexscreener.com';
const PROVIDER = 'dexscreener' as const;

// ----- Raw types from DEX Screener -----
export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: { m5: number; h1: number; h24: number };
  priceChange: { m5: number; h1: number; h24: number };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { type: string; url: string }[];
  };
  boosts?: { active: number };
}

export interface DexScreenerTokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  description?: string;
  links?: { type: string; label: string; url: string }[];
}

export interface DexScreenerBoost {
  url: string;
  chainId: string;
  tokenAddress: string;
  amount: number;
  totalAmount: number;
  icon?: string;
  name?: string;
  description?: string;
  links?: { type: string; label: string; url: string }[];
}

export interface DexScreenerOrder {
  type: string;
  status: string;
  paymentTimestamp: number;
}

// ----- API Functions -----

/** Get latest token profiles (rate-limit 60/min) */
export async function getLatestTokenProfiles(): Promise<ProviderResponse<DexScreenerTokenProfile[]>> {
  return providerFetch<DexScreenerTokenProfile[]>(PROVIDER, `${BASE}/token-profiles/latest/v1`);
}

/** Get latest boosted tokens (rate-limit 60/min) */
export async function getLatestBoosts(): Promise<ProviderResponse<DexScreenerBoost[]>> {
  return providerFetch<DexScreenerBoost[]>(PROVIDER, `${BASE}/token-boosts/latest/v1`);
}

/** Get the tokens with most active boosts (rate-limit 60/min) */
export async function getTopBoosts(): Promise<ProviderResponse<DexScreenerBoost[]>> {
  return providerFetch<DexScreenerBoost[]>(PROVIDER, `${BASE}/token-boosts/top/v1`);
}

/** Check paid orders for a token (rate-limit 60/min) */
export async function getOrders(chainId: string, tokenAddress: string): Promise<ProviderResponse<DexScreenerOrder[]>> {
  return providerFetch<DexScreenerOrder[]>(PROVIDER, `${BASE}/orders/v1/${chainId}/${tokenAddress}`);
}

/** Get pairs by token address on a chain (rate-limit 300/min) */
export async function getTokenPairs(chainId: string, tokenAddress: string): Promise<ProviderResponse<{ pairs: DexScreenerPair[] }>> {
  return providerFetch<{ pairs: DexScreenerPair[] }>(PROVIDER, `${BASE}/token-pairs/v1/${chainId}/${tokenAddress}`);
}

/** Search for pairs matching query (rate-limit 300/min) */
export async function searchPairs(query: string): Promise<ProviderResponse<{ pairs: DexScreenerPair[] }>> {
  return providerFetch<{ pairs: DexScreenerPair[] }>(PROVIDER, `${BASE}/dex/search?q=${encodeURIComponent(query)}`);
}

/** Get one or multiple pairs by token addresses (rate-limit 300/min) */
export async function getTokensByAddress(chainId: string, addresses: string[]): Promise<ProviderResponse<{ pairs: DexScreenerPair[] }>> {
  return providerFetch<{ pairs: DexScreenerPair[] }>(
    PROVIDER,
    `${BASE}/tokens/v1/${chainId}/${addresses.join(',')}`
  );
}

/** Health check */
export async function dexScreenerHealthCheck(): Promise<ProviderHealth> {
  return checkHealth(PROVIDER, `${BASE}/token-profiles/latest/v1`);
}
