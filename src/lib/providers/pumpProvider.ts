// ============================================================
// Pump Provider Adapter (composite: DEX Screener + Rugcheck)
// No official Pump.fun API — detect Pump-origin tokens via DEX data
// ============================================================
import { searchPairs, DexScreenerPair } from './dexScreenerProvider';
import { getNewTokens, RugcheckNewToken } from './rugcheckProvider';
import { checkHealth } from './base';
import { ProviderHealth, ProviderResponse, DataFreshness } from '@/lib/types';

const PROVIDER = 'pump' as const;

export interface PumpToken {
  tokenAddress: string;
  symbol: string;
  name: string;
  launchSource: 'pump';
  graduationStatus: 'bonding' | 'graduated' | 'migrated' | 'unknown';
  pair: DexScreenerPair | null;
  detectedAt: string;
}

/**
 * Discover Pump.fun tokens by searching DEX Screener for pumpfun pairs.
 * Cross-references with Rugcheck new-token feed for freshness.
 */
export async function getPumpTokens(): Promise<ProviderResponse<PumpToken[]>> {
  try {
    // Independent external calls — parallelize for ~50% latency reduction.
    const [dexRes, newTokensRes] = await Promise.all([
      searchPairs('pumpfun'),
      getNewTokens(),
    ]);

    const newTokenMints = new Set(
      (newTokensRes.data ?? []).map((t: RugcheckNewToken) => t.mint)
    );

    const pairs = dexRes.data?.pairs ?? [];
    const solPairs = pairs.filter((p: DexScreenerPair) => p.chainId === 'solana');

    const tokens: PumpToken[] = solPairs.map((pair: DexScreenerPair) => {
      const isPumpDex = pair.dexId?.toLowerCase().includes('pump') ||
                        pair.url?.toLowerCase().includes('pump');
      const isGraduated = pair.dexId?.toLowerCase().includes('raydium') && isPumpDex;

      return {
        tokenAddress: pair.baseToken.address,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        launchSource: 'pump' as const,
        graduationStatus: isGraduated
          ? 'graduated'
          : isPumpDex
          ? 'bonding'
          : newTokenMints.has(pair.baseToken.address)
          ? 'unknown'
          : 'unknown',
        pair,
        detectedAt: new Date().toISOString(),
      };
    });

    return {
      data: tokens,
      provider: PROVIDER,
      freshness: 'LIVE' as DataFreshness,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      data: null,
      provider: PROVIDER,
      freshness: 'UNAVAILABLE' as DataFreshness,
      fetchedAt: new Date().toISOString(),
      error: (err as Error).message,
    };
  }
}

/** Health check — delegates to DEX Screener since Pump is composite */
export async function pumpHealthCheck(): Promise<ProviderHealth> {
  return checkHealth(PROVIDER, 'https://api.dexscreener.com/token-profiles/latest/v1');
}
