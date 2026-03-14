// ============================================================
// Jupiter Provider Adapter (read-only: quote + price)
// ============================================================
import { providerFetch, checkHealth } from './base';
import { ProviderHealth, ProviderResponse } from '@/lib/types';

const QUOTE_BASE = 'https://api.jup.ag';
const PRICE_BASE = 'https://api.jup.ag';
const PROVIDER = 'jupiter' as const;

// ----- Raw types -----
export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: {
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }[];
}

export interface JupiterPrice {
  id: string;
  type: string;
  price: string;
}

// ----- API Functions -----

/** Get quote for a swap (read-only, no execution) */
export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps = 50
): Promise<ProviderResponse<JupiterQuote>> {
  const url = `${QUOTE_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
  return providerFetch<JupiterQuote>(PROVIDER, url);
}

/** Get price for one or more tokens */
export async function getPrice(
  ids: string[]
): Promise<ProviderResponse<{ data: Record<string, JupiterPrice> }>> {
  const url = `${PRICE_BASE}/price/v2?ids=${ids.join(',')}`;
  return providerFetch<{ data: Record<string, JupiterPrice> }>(PROVIDER, url);
}

/** Health check */
export async function jupiterHealthCheck(): Promise<ProviderHealth> {
  // Use SOL price as health check
  return checkHealth(
    PROVIDER,
    `${PRICE_BASE}/price/v2?ids=So11111111111111111111111111111111111111112`
  );
}
