/**
 * goldskyClient.ts — GraphQL client pentru subgraph-uri Polymarket.
 *
 * FAZA 3.2: Completeaza ingest-webhook-ul (push) cu query activ (pull).
 * Webhook-ul ne da evenimente asincron; clientul asta ne permite sa interogam
 * starea on-chain la cerere (ex. "cati whales au pozitie in marketul X
 * chiar acum?").
 *
 * INFRASTRUCTURA:
 *   - Subgraph Polymarket oficial pe The Graph hosted/decentralized network
 *   - Alternativ: Goldsky gazduieste mirror-uri proprii (endpoint privat)
 *   - Endpoint-ul citit din env: POLYMARKET_SUBGRAPH_URL
 *     (daca nu e configurat → functiile returneaza null, NU crash)
 *
 * ASUMPTII (invalidare → null + warn, nu fatal):
 *   (1) Subgraph-ul expune entitati "Market", "Position", "FixedProductMarketMaker"
 *       urmand conventia Gnosis CTF (conditional tokens framework).
 *   (2) Schema exacta se poate schimba → capturam doar campurile cheie +
 *       raspunsul raw pentru correlation layer (FAZA 3.3).
 *   (3) Rate limit subgraph: ~1000 req/h pe hosted, mai mult pe paid/decentralizat.
 *       Caching TTL 30s pentru a evita burst.
 *   (4) Asta NU e LIVE trading path — doar shadow signal. Daca subgraph-ul
 *       e lent/stale, edge-ul de corelatie scade dar nu rupe nimic.
 *
 * KILL-SWITCH
 *   POLYMARKET_SUBGRAPH_ENABLED=0  → toate functiile returneaza null.
 *   POLYMARKET_SUBGRAPH_URL unset  → la fel.
 */

import { createLogger } from '@/lib/core/logger';

const log = createLogger('GoldskyClient');

const SUBGRAPH_URL = () => process.env.POLYMARKET_SUBGRAPH_URL || '';
const ENABLED = () =>
  process.env.POLYMARKET_SUBGRAPH_ENABLED !== '0' && !!SUBGRAPH_URL();

// In-process cache to dampen bursts. Keyed by query+vars.
const cache = new Map<string, { value: unknown; exp: number }>();
const CACHE_TTL_MS = 30_000;

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}
function cacheSet(key: string, value: unknown) {
  cache.set(key, { value, exp: Date.now() + CACHE_TTL_MS });
}

// ── Raw GraphQL request with timeout + retry ─────────────────
async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  if (!ENABLED()) return null;
  const url = SUBGRAPH_URL();
  const cacheKey = JSON.stringify({ q: query, v: variables });
  const cached = cacheGet<T>(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // Subgraph API key if using decentralized network (optional)
        ...(process.env.POLYMARKET_SUBGRAPH_API_KEY
          ? { Authorization: `Bearer ${process.env.POLYMARKET_SUBGRAPH_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      log.warn('subgraph non-2xx', { status: res.status });
      return null;
    }
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors && json.errors.length > 0) {
      log.warn('subgraph errors', { errors: json.errors.slice(0, 3).map(e => e.message).join('; ') });
      return null;
    }
    if (json.data === undefined) return null;
    cacheSet(cacheKey, json.data);
    return json.data;
  } catch (err) {
    // Timeout, network, JSON parse — all soft-fail.
    log.warn('subgraph fetch threw', { error: String(err) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── 1. On-chain market state ─────────────────────────────────
// Conventia Gnosis CTF: entitatea "fixedProductMarketMaker" are conditionId.
// Asumptie invalidata = subgraph schimba numele field-ului → returnam null,
// correlation layer degradeaza la "goldskyConfirm=1" (neutru, fara penalizare).
export interface MarketOnChainState {
  conditionId: string;
  totalVolume: string;      // decimal string (USDC wei)
  totalLiquidity: string;   // decimal string
  resolved: boolean;
  payoutNumerators: number[] | null;
  lastUpdateBlock: number | null;
}

export async function getMarketOnChainState(conditionId: string): Promise<MarketOnChainState | null> {
  if (!conditionId) return null;
  const query = `
    query($cid: String!) {
      fixedProductMarketMakers(where: { conditionId: $cid }, first: 1) {
        conditionId
        totalSupply
        collateralVolume
        liquidityParameter
        resolved: isResolved
        payoutNumerators
      }
    }
  `;
  type Resp = {
    fixedProductMarketMakers: Array<{
      conditionId: string;
      collateralVolume?: string;
      liquidityParameter?: string;
      resolved?: boolean;
      payoutNumerators?: string[];
    }>;
  };
  const data = await graphql<Resp>(query, { cid: conditionId.toLowerCase() });
  if (!data || !data.fixedProductMarketMakers[0]) return null;
  const m = data.fixedProductMarketMakers[0];
  return {
    conditionId: m.conditionId,
    totalVolume: m.collateralVolume ?? '0',
    totalLiquidity: m.liquidityParameter ?? '0',
    resolved: !!m.resolved,
    payoutNumerators: (m.payoutNumerators ?? []).map(p => Number(p)).filter(n => Number.isFinite(n)),
    lastUpdateBlock: null,
  };
}

// ── 2. Whale positions ────────────────────────────────────────
// Returneaza top pozitii >= minUsd pentru un market. Util pentru "cineva cu
// $200k tocmai a cumparat YES la 0.55 → semnal de divergenta fata de orderbook".
export interface WhalePosition {
  conditionId: string;
  actor: string;
  outcomeIndex: number;
  sharesUsd: number;   // notional estimat la pretul curent
  lastActionBlock: number | null;
}

export async function getRecentWhalePositions(
  conditionId: string,
  minUsd = 50_000,
  limit = 20,
): Promise<WhalePosition[]> {
  if (!conditionId) return [];
  const query = `
    query($cid: String!, $lim: Int!) {
      positions(
        where: { conditionId: $cid },
        orderBy: totalShares,
        orderDirection: desc,
        first: $lim
      ) {
        conditionId
        user: beneficiary
        outcomeIndex
        totalShares
        lastUpdateBlock
      }
    }
  `;
  type Resp = {
    positions: Array<{
      conditionId: string;
      user: string;
      outcomeIndex: number;
      totalShares: string;
      lastUpdateBlock?: string;
    }>;
  };
  const data = await graphql<Resp>(query, { cid: conditionId.toLowerCase(), lim: limit });
  if (!data) return [];

  // Heuristic: share notional = shares * 1 USDC (binary markets).
  // Not perfect (YES vs NO have different prices) but order-of-magnitude correct
  // for whale-detection purposes.
  return data.positions
    .map(p => ({
      conditionId: p.conditionId,
      actor: p.user,
      outcomeIndex: Number(p.outcomeIndex),
      sharesUsd: Number(p.totalShares) / 1e6, // USDC 6 decimals
      lastActionBlock: p.lastUpdateBlock ? Number(p.lastUpdateBlock) : null,
    }))
    .filter(p => Number.isFinite(p.sharesUsd) && p.sharesUsd >= minUsd);
}

// ── 3. Resolution ─────────────────────────────────────────────
// Citeste statusul de rezolvare. Folosit de /cron/resolve pentru a confirma
// plata finala (nu ne bazam doar pe Gamma — poate fi lag).
export interface MarketResolution {
  conditionId: string;
  resolved: boolean;
  payoutNumerators: number[] | null;
  resolutionBlock: number | null;
}

export async function getMarketResolution(conditionId: string): Promise<MarketResolution | null> {
  if (!conditionId) return null;
  const query = `
    query($cid: String!) {
      conditions(where: { id: $cid }, first: 1) {
        id
        resolved
        payoutNumerators
        resolutionTimestamp
      }
    }
  `;
  type Resp = {
    conditions: Array<{
      id: string;
      resolved: boolean;
      payoutNumerators: string[] | null;
      resolutionTimestamp?: string;
    }>;
  };
  const data = await graphql<Resp>(query, { cid: conditionId.toLowerCase() });
  if (!data || !data.conditions[0]) return null;
  const c = data.conditions[0];
  return {
    conditionId: c.id,
    resolved: !!c.resolved,
    payoutNumerators: (c.payoutNumerators ?? []).map(p => Number(p)).filter(n => Number.isFinite(n)),
    resolutionBlock: null,
  };
}

// ── Diag helper ───────────────────────────────────────────────
export function getGoldskyStatus(): { enabled: boolean; configured: boolean; cacheSize: number } {
  return {
    enabled: ENABLED(),
    configured: !!SUBGRAPH_URL(),
    cacheSize: cache.size,
  };
}
