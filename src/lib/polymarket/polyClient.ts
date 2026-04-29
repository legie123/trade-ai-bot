// ============================================================
// Polymarket API Client — CLOB + Gamma with rate limiting
//
// ⚠️ PAPER TRADING ONLY ⚠️
//
// This module is configured for PAPER TRADING (phantom bets only).
// No real trades are executed. No real money is at risk.
//
// If you intend to add live trading in the future:
// 1. Create a separate execution layer (do NOT reuse this phantom logic)
// 2. Add transaction signing and authentication
// 3. Add real-time position monitoring
// 4. Add kill switches at the exchange API level
// 5. Create separate wallet & position management
// 6. Add audit logging and compliance tracking
//
// DO NOT modify this module to support live trading.
// ============================================================

import { PolyMarket, PolyOutcome, PolyDivision, DIVISION_SLUGS } from './polyTypes';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyClient');

const CLOB_URL = () => process.env.POLYMARKET_CLOB_URL || 'https://clob.polymarket.com';
// Exported for feedHealth.ts and other probes that need the same base URL.
export const GAMMA_URL = () => process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com';
// Rate limiter: 100ms between requests
let lastRequestTime = 0;
const RATE_LIMIT_MS = 100;

async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

// Retry with exponential backoff
async function fetchWithRetry(url: string, options?: RequestInit, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await rateLimitedFetch(url, options);
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err as Error;
    }
    if (i < maxRetries) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
  throw lastError;
}

// ─── Get markets by category (Gamma API) ─────────────────
export async function getMarketsByCategory(
  division: PolyDivision,
  limit = 20,
): Promise<PolyMarket[]> {
  const slug = DIVISION_SLUGS[division];
  try {
    const res = await fetchWithRetry(
      `${GAMMA_URL()}/markets?tag=${slug}&limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`,
    );
    if (!res.ok) {
      log.warn('Gamma API error', { status: res.status, division });
      return [];
    }
    const data = await res.json();
    return (data || []).map(mapGammaMarket);
  } catch (err) {
    log.warn('getMarketsByCategory failed', { division, error: String(err) });
    return [];
  }
}

// ─── Get single market ────────────────────────────────────
export async function getMarket(conditionId: string): Promise<PolyMarket | null> {
  try {
    const res = await fetchWithRetry(`${GAMMA_URL()}/markets/${conditionId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return mapGammaMarket(data);
  } catch {
    return null;
  }
}

// ─── Get market prices (CLOB) ──────────────────────────────
export async function getMarketPrices(tokenId: string): Promise<{ yes: number; no: number } | null> {
  try {
    const res = await fetchWithRetry(`${CLOB_URL()}/price?token_id=${tokenId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      yes: parseFloat(data.price || '0.5'),
      no: 1 - parseFloat(data.price || '0.5'),
    };
  } catch {
    return null;
  }
}

// ─── Get order book ───────────────────────────────────────
export async function getOrderBook(tokenId: string): Promise<{ bids: [number, number][]; asks: [number, number][] } | null> {
  try {
    const res = await fetchWithRetry(`${CLOB_URL()}/book?token_id=${tokenId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Get recent trades ────────────────────────────────────
export async function getRecentTrades(conditionId: string, limit = 20): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetchWithRetry(
      `${CLOB_URL()}/trades?condition_id=${conditionId}&limit=${limit}`,
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ─── Get trending markets ─────────────────────────────────
export async function getTrendingMarkets(limit = 20): Promise<PolyMarket[]> {
  try {
    const res = await fetchWithRetry(
      `${GAMMA_URL()}/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map(mapGammaMarket);
  } catch {
    return [];
  }
}

// ─── Search markets ───────────────────────────────────────
export async function searchMarkets(query: string, limit = 10): Promise<PolyMarket[]> {
  try {
    const res = await fetchWithRetry(
      `${GAMMA_URL()}/markets?limit=${limit}&active=true&closed=false&search=${encodeURIComponent(query)}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map(mapGammaMarket);
  } catch {
    return [];
  }
}

// ─── Health check ─────────────────────────────────────────
export async function testPolymarketConnection(): Promise<{ clob: boolean; gamma: boolean }> {
  let clob = false;
  let gamma = false;

  try {
    const res = await rateLimitedFetch(`${CLOB_URL()}/time`);
    clob = res.ok;
  } catch { /* */ }

  try {
    const res = await rateLimitedFetch(`${GAMMA_URL()}/markets?limit=1`);
    gamma = res.ok;
  } catch { /* */ }

  return { clob, gamma };
}

// ─── Map Gamma API response to PolyMarket ──────────────────
// NOTE: Gamma API returns outcomes/outcomePrices/clobTokenIds as JSON-encoded
// STRINGS, not parsed arrays. E.g. outcomes: "[\"Yes\",\"No\"]".
// Typed as unknown to force parseJsonArrayField() through a safe parser.
// Asumptie: daca Gamma isi schimba schema la array nativ, parseJsonArrayField
// detecteaza si gestioneaza ambele cazuri — invalidarea parser-ului = markete
// cu outcomes=[] si scanner returneaza 0, acelasi simptom ca bug-ul curent.
interface GammaRawMarket {
  id?: string;
  conditionId?: string;
  question?: string;
  title?: string;
  description?: string;
  groupSlug?: string;
  category?: string;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
  clobTokenIds?: string[] | string;
  active?: boolean;
  closed?: boolean;
  endDate?: string;
  endDateIso?: string;
  volume24hr?: string;
  volume24h?: string;
  liquidity?: string;
  createdAt?: string;
  startDate?: string;
}

// Parses either native array or JSON-stringified array. Returns [] on any
// malformed input (never throws) so mapGammaMarket stays defensive.
function parseJsonArrayField(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string') as string[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string' || typeof v === 'number').map(String) : [];
    } catch { return []; }
  }
  return [];
}

function mapGammaMarket(raw: GammaRawMarket): PolyMarket {
  const outcomes: PolyOutcome[] = [];

  const outcomeNames = parseJsonArrayField(raw.outcomes);
  const outcomePrices = parseJsonArrayField(raw.outcomePrices);
  const clobTokenIds = parseJsonArrayField(raw.clobTokenIds);

  outcomeNames.forEach((name, i) => {
    outcomes.push({
      id: clobTokenIds[i] || `outcome-${i}`,
      name,
      price: parseFloat(outcomePrices[i] || '0.5'),
    });
  });

  return {
    id: raw.id || raw.conditionId || '',
    conditionId: raw.conditionId || raw.id || '',
    title: raw.question || raw.title || '',
    description: raw.description || '',
    category: raw.groupSlug || raw.category || '',
    outcomes,
    active: raw.active !== false && !raw.closed,
    closed: !!raw.closed,
    endDate: raw.endDate || raw.endDateIso || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    volume24h: parseFloat(raw.volume24hr || raw.volume24h || '0'),
    liquidityUSD: parseFloat(raw.liquidity || '0'),
    createdAt: raw.createdAt || raw.startDate || '',
  };
}
