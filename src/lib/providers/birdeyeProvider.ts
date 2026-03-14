// ============================================================
// Birdeye Provider Adapter
// ============================================================
import { providerFetch, checkHealth } from './base';
import { ProviderHealth, ProviderResponse } from '@/lib/types';

const BASE = 'https://public-api.birdeye.so';
const PROVIDER = 'birdeye' as const;

function headers() {
  const key = process.env.BIRDEYE_API_KEY;
  return {
    'X-API-KEY': key || '',
    'x-chain': 'solana',
  };
}

// ----- Raw types -----
export interface BirdeyeTokenOverview {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  priceChange24hPercent: number;
  priceChange1hPercent?: number;
  volume24hUSD: number;
  volume1hUSD?: number;
  liquidity: number;
  mc: number;
  holder?: number;
  supply?: number;
  logoURI?: string;
  lastTradeUnixTime?: number;
  v24hChangePercent?: number;
}

export interface BirdeyePriceResponse {
  value: number;
  updateUnixTime: number;
  updateHumanTime: string;
}

// ----- API Functions -----

/** Token overview (price, mcap, volume, liquidity, holders) */
export async function getTokenOverview(address: string): Promise<ProviderResponse<{ data: BirdeyeTokenOverview }>> {
  return providerFetch<{ data: BirdeyeTokenOverview }>(
    PROVIDER,
    `${BASE}/defi/token_overview?address=${address}`,
    { headers: headers() }
  );
}

/** Current price */
export async function getTokenPrice(address: string): Promise<ProviderResponse<{ data: BirdeyePriceResponse }>> {
  return providerFetch<{ data: BirdeyePriceResponse }>(
    PROVIDER,
    `${BASE}/defi/price?address=${address}`,
    { headers: headers() }
  );
}

/** Multiple token prices */
export async function getMultiPrice(addresses: string[]): Promise<ProviderResponse<{ data: Record<string, BirdeyePriceResponse> }>> {
  return providerFetch<{ data: Record<string, BirdeyePriceResponse> }>(
    PROVIDER,
    `${BASE}/defi/multi_price?list_address=${addresses.join(',')}`,
    { headers: headers() }
  );
}

/** Health check */
export async function birdeyeHealthCheck(): Promise<ProviderHealth> {
  if (!process.env.BIRDEYE_API_KEY) {
    return {
      name: PROVIDER,
      status: 'down',
      lastCheck: new Date().toISOString(),
      latencyMs: null,
      message: 'BIRDEYE_API_KEY not set',
    };
  }
  return checkHealth(PROVIDER, `${BASE}/defi/price?address=So11111111111111111111111111111111111111112`, headers());
}
