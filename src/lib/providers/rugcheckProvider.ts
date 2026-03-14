// ============================================================
// Rugcheck Provider Adapter
// ============================================================
import { providerFetch, checkHealth } from './base';
import { ProviderHealth, ProviderResponse } from '@/lib/types';

const BASE = 'https://api.rugcheck.xyz';
const PROVIDER = 'rugcheck' as const;

// ----- Raw types -----
export interface RugcheckReport {
  mint: string;
  tokenMeta?: {
    name: string;
    symbol: string;
    uri: string;
    mutable: boolean;
    updateAuthority?: string;
  };
  risks: {
    name: string;
    value: string;
    description: string;
    score: number;
    level: string;
  }[];
  score: number;
  topHolders?: {
    address: string;
    amount: number;
    pct: number;
    insider: boolean;
  }[];
  markets?: {
    marketType: string;
    pubkey: string;
    mintA: string;
    mintB: string;
    lp?: { lpLockedPct: number; lpLockedUSD: number };
  }[];
}

export interface RugcheckNewToken {
  mint: string;
  name: string;
  symbol: string;
  createdAt: string;
}

export interface RugcheckTrending {
  mint: string;
  votes: number;
}

// ----- API Functions -----

/** Full token report (risks, markets, top holders, score) */
export async function getTokenReport(mint: string): Promise<ProviderResponse<RugcheckReport>> {
  return providerFetch<RugcheckReport>(PROVIDER, `${BASE}/v1/tokens/${mint}/report/summary`);
}

/** Recently detected tokens */
export async function getNewTokens(): Promise<ProviderResponse<RugcheckNewToken[]>> {
  return providerFetch<RugcheckNewToken[]>(PROVIDER, `${BASE}/v1/stats/new_tokens`);
}

/** Most voted / trending tokens in last 24h */
export async function getTrending(): Promise<ProviderResponse<RugcheckTrending[]>> {
  return providerFetch<RugcheckTrending[]>(PROVIDER, `${BASE}/v1/stats/trending`);
}

/** Health check via /ping */
export async function rugcheckHealthCheck(): Promise<ProviderHealth> {
  return checkHealth(PROVIDER, `${BASE}/ping`);
}
