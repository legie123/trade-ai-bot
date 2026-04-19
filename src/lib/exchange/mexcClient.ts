// ============================================================
// MEXC Client — V3 Spot API with HMAC SHA256 signing
// Hardened: retry + backoff, timeout, rate limiter, health tracking
// API docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/
// ============================================================
import crypto from 'crypto';
import { addInvalidSymbol, isSymbolValid } from '@/lib/store/db';
import { recordProviderHealth } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';
import { assertLiveTradingAllowed, assertLiveTradingAllowedForEmergencyExit } from '@/lib/core/tradingMode';

const log = createLogger('MexcClient');
const MEXC_BASE_URL = 'https://api.mexc.com';

// ─── Rate Limiter (MEXC allows ~20 req/s for public, 10/s signed) ──
const rateLimiter = {
  lastCall: 0,
  minIntervalMs: 60, // 60ms minimum between calls (~16 req/s)
  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastCall = Date.now();
  }
};

function getMexcConfig() {
  const apiKey = process.env.MEXC_API_KEY || '';
  const apiSecret = process.env.MEXC_API_SECRET || '';
  // AUDIT FIX API-3: Log warning if keys missing (prevents silent auth failures)
  if (!apiKey && !_mexcKeyWarned) { log.warn('[MEXC CONFIG] MEXC_API_KEY is empty — signed requests will fail'); _mexcKeyWarned = true; }
  return { apiKey, apiSecret };
}
let _mexcKeyWarned = false;

function sign(queryString: string): string {
  const { apiSecret } = getMexcConfig();
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function mexcRequest(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  params: Record<string, string | number> = {},
  signed = true,
  retries = 2
): Promise<Record<string, unknown>> {
  const { apiKey } = getMexcConfig();

  if (signed) {
    params.timestamp = Date.now();
    params.recvWindow = 5000;
  }

  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  let url = `${MEXC_BASE_URL}${endpoint}`;

  if (signed) {
    const signature = sign(qs);
    url += `?${qs}&signature=${signature}`;
  } else if (qs) {
    url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // C11 FIX (2026-04-18): Only attach X-MEXC-APIKEY for SIGNED requests.
  // Previously we attached it whenever apiKey existed, which poisoned PUBLIC
  // endpoints (e.g. /api/v3/ticker/price) with 10072 "Api key info invalid"
  // when the stored key was revoked / bad. Public endpoints don't need auth
  // — so we skip the header entirely for them. This unblocks PAPER pipeline
  // when the MEXC key is invalid (paper only needs public price feeds).
  // ASSUMPTION: MEXC public endpoints tolerate missing X-MEXC-APIKEY header.
  //             Verified against MEXC spot v3 docs (header optional on public).
  if (signed) {
    headers['X-MEXC-APIKEY'] = apiKey;
  }

  let lastError: Error | null = null;
  const start = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await rateLimiter.wait();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, { method, headers, signal: controller.signal });
      clearTimeout(timer);

      // Rate-limited — back off exponentially
      if (res.status === 429) {
        const wait = 1000 * Math.pow(2, attempt);
        log.warn(`[MEXC] Rate limited, backing off ${wait}ms (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      const data = await res.json();

      if (data.code && data.code !== 200 && data.code !== 0) {
        throw new Error(`MEXC Error ${data.code}: ${data.msg}`);
      }

      recordProviderHealth('mexc', true, Date.now() - start);
      return data;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }

  recordProviderHealth('mexc', false, Date.now() - start);
  log.error(`[MEXC] Request failed after ${retries + 1} attempts: ${endpoint}`, { error: lastError?.message });
  throw lastError ?? new Error('MEXC request failed');
}

// ─── Public endpoints ────────────────────────────
export async function getMexcServerTime(): Promise<number> {
  const data = await mexcRequest('GET', '/api/v3/time', {}, false);
  return data.serverTime as number;
}

export async function getMexcPrice(symbol: string): Promise<number> {
  if (!isSymbolValid(symbol)) return 0;
  
  // ═══ FORMAT GUARD: Reject non-MEXC symbol formats before hitting API ═══
  // MEXC spot symbols are short uppercase like BTCUSDT, ETHUSDT (max ~15 chars)
  // Solana pump addresses (32+ chars), symbols with underscores/dots = invalid
  if (symbol.length > 20 || /[^A-Z0-9]/.test(symbol) || symbol.length < 3) {
    addInvalidSymbol(symbol);
    return 0;
  }
  
  try {
    const data = await mexcRequest('GET', '/api/v3/ticker/price', { symbol }, false);
    return parseFloat(data.price as string) || 0;
  } catch (err) {
    // SAFETY: Only blacklist on 400-level client errors (symbol genuinely invalid).
    // Transient errors (timeout, 5xx, network) must NOT blacklist valid symbols like BTCUSDT.
    const errMsg = String(err);
    if (errMsg.includes('400') || errMsg.includes('Invalid symbol') || errMsg.includes('not found')) {
      addInvalidSymbol(symbol);
    } else {
      log.warn(`[MEXC] Transient error for ${symbol}, NOT blacklisting: ${errMsg.slice(0, 100)}`);
    }
    return 0;
  }
}

export async function getMexcTicker24h(symbol: string): Promise<Record<string, unknown>> {
  return mexcRequest('GET', '/api/v3/ticker/24hr', { symbol }, false);
}

/**
 * Parallel Price Fetch (HARDENED 2026-04-18):
 *   - Dropped the ALL-tickers fallback — it returns ~2500 items and times out on
 *     Cloud Run. Any caller that relied on it was masking a Cloud-Run timeout as
 *     "no prices returned".
 *   - Now ALWAYS fetches individually with bounded concurrency, regardless of
 *     symbol count. Concurrency cap (default 8) prevents MEXC rate-limit bans
 *     on large batches.
 *   - If called with no symbols, we refuse — bulk "all prices" is not supported.
 *
 * ASSUMPTIONS that invalidate this function if they break:
 *   - MEXC endpoint /api/v3/ticker/price is reachable from IP 149.174.89.163
 *   - Each individual fetch completes in <1s (otherwise batches exceed cron timeout)
 *   - Caller does NOT expect every requested symbol to return — missing = blacklisted/invalid
 */
export async function getMexcPrices(symbols?: string[]): Promise<Record<string, number>> {
  if (!symbols || symbols.length === 0) {
    log.warn('[MEXC] getMexcPrices called without symbols — refusing all-tickers fetch (Cloud Run timeout risk)');
    return {};
  }

  const CONCURRENCY = 8;
  const results: Record<string, number> = {};
  const mexcFails: string[] = [];

  // Bounded parallel fetch — prevent MEXC rate-limit on large symbol sets.
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(async (sym) => {
      try {
        const data = await mexcRequest('GET', '/api/v3/ticker/price', { symbol: sym }, false);
        const price = parseFloat(data.price as string);
        if (!isNaN(price) && price > 0) {
          results[sym] = price;
        } else {
          mexcFails.push(sym); // zero/NaN — try Binance fallback
        }
      } catch (fetchErr) {
        log.warn(`[MEXC] Individual price fetch failed for ${sym}: ${String(fetchErr).slice(0, 100)}`);
        mexcFails.push(sym);
      }
    }));
  }

  // RUFLO FAZA 3 Batch 8 (H4) 2026-04-19: Binance cross-exchange fallback.
  // WHY: Per-symbol MEXC failures were silently dropped, so downstream
  // consumers saw PARTIAL price maps (e.g. BTCUSDT returned but SOLUSDT missing
  // because MEXC had a 1-req blip). Those partial maps feed risk sizing; a
  // missing symbol translated to sizing=0 → phantom decisions logged with no
  // real risk. Now, per failed symbol we try Binance once before giving up.
  //
  // ASUMPȚIE: Binance API is reachable from the IP (same allowlist as MEXC).
  //   If Binance is ALSO blocked, fallback is a no-op — results map keeps
  //   the missing symbol missing. Feed circuit-breaker (Batch 7) then trips.
  //
  // Kill-switch: env DISABLE_MEXC_BINANCE_FALLBACK=1 → skip fallback, legacy
  //   behavior restored (partial map as before).
  if (mexcFails.length > 0 && process.env.DISABLE_MEXC_BINANCE_FALLBACK !== '1') {
    try {
      const { getBinancePrice } = await import('@/lib/exchange/binanceClient');
      // Same CONCURRENCY bound — don't DoS Binance either.
      for (let i = 0; i < mexcFails.length; i += CONCURRENCY) {
        const batch = mexcFails.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map(async (sym) => {
          try {
            const p = await getBinancePrice(sym);
            if (p > 0) {
              results[sym] = p;
              log.info(`[MEXC→Binance fallback] Recovered ${sym} from Binance (MEXC failed)`);
            }
          } catch {
            // silent — both exchanges failed, circuit-breaker will catch pattern
          }
        }));
      }
    } catch (impErr) {
      log.warn(`[MEXC] Binance client import failed, skipping fallback: ${String(impErr).slice(0, 100)}`);
    }
  }

  log.info(`[MEXC] Parallel fetch: ${symbols.length} requested, ${Object.keys(results).length} returned (concurrency=${CONCURRENCY}, binance_recoveries=${mexcFails.filter(s => results[s]).length})`);
  return results;
}

export async function getMexcOrderbook(symbol: string, limit = 10): Promise<Record<string, unknown>> {
  return mexcRequest('GET', '/api/v3/depth', { symbol, limit }, false);
}

export async function getMexcExchangeInfo(): Promise<Record<string, unknown>> {
  return mexcRequest('GET', '/api/v3/exchangeInfo', {}, false);
}

// ─── Account endpoints (signed) ─────────────────
export async function getMexcAccount(): Promise<Record<string, unknown>> {
  return mexcRequest('GET', '/api/v3/account');
}

export async function getMexcBalances(): Promise<{ asset: string; free: number; locked: number }[]> {
  const account = await getMexcAccount();
  const balances = (account.balances as { asset: string; free: string; locked: string }[]) || [];
  return balances
    .map((b) => ({
      asset: b.asset,
      free: parseFloat(b.free),
      locked: parseFloat(b.locked),
    }))
    .filter((b) => b.free > 0 || b.locked > 0);
}

// ─── Trading endpoints ──────────────────────────
export async function placeMexcMarketOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number
): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`placeMexcMarketOrder(${symbol},${side},${quantity})`);
  return mexcRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity: quantity.toString(),
  });
}

export async function placeMexcLimitOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number
): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`placeMexcLimitOrder(${symbol},${side},${quantity}@${price})`);
  return mexcRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'LIMIT',
    quantity: quantity.toString(),
    price: price.toString(),
  });
}

export async function cancelMexcOrder(symbol: string, orderId: string): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`cancelMexcOrder(${symbol},${orderId})`);
  return mexcRequest('DELETE', '/api/v3/order', { symbol, orderId });
}

export async function placeMexcStopLossOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  stopPrice: number
): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`placeMexcStopLossOrder(${symbol},${side},${quantity}@${stopPrice})`);
  return mexcRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'STOP_LOSS',
    quantity: quantity.toString(),
    stopPrice: stopPrice.toString(),
  });
}

export async function getMexcOpenOrders(symbol?: string): Promise<Record<string, unknown>[]> {
  const params: Record<string, string | number> = {};
  if (symbol) params.symbol = symbol;
  const res = await mexcRequest('GET', '/api/v3/openOrders', params);
  return (res as unknown as Record<string, unknown>[]) || [];
}

export async function cancelAllMexcOrders(symbol: string): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`cancelAllMexcOrders(${symbol})`);
  return mexcRequest('DELETE', '/api/v3/openOrders', { symbol });
}

/**
 * Emergency Exit: Sells all non-USDT assets to USDT at Market price.
 * OMEGA FIX: Now applies roundToStep + minNotional validation per symbol.
 */
export async function sellAllAssetsToUsdt(): Promise<void> {
  assertLiveTradingAllowedForEmergencyExit('sellAllAssetsToUsdt');
  const balances = await getMexcBalances();
  const nonUsdt = balances.filter(b => b.asset !== 'USDT' && b.asset !== 'MX' && b.free > 0);

  if (nonUsdt.length === 0) {
    log.info('[Kill Switch] No non-USDT assets to sell.');
    return;
  }

  // Fetch exchange info once for all symbols
  let exchangeInfo: Record<string, unknown> = {};
  try {
    exchangeInfo = await getMexcExchangeInfo();
  } catch (err) {
    console.error('[Kill Switch] Failed to fetch exchange info, proceeding with raw quantities:', err);
  }

  for (const b of nonUsdt) {
    try {
      const symbol = `${b.asset}USDT`;
      let quantity = b.free;

      // Apply centralized exchange filters
      if (exchangeInfo && (exchangeInfo as { symbols?: unknown[] }).symbols) {
        const { getSymbolFilters, roundToStep } = await import('@/lib/v2/scouts/executionMexc');
        const filters = getSymbolFilters(exchangeInfo, symbol);
        
        quantity = roundToStep(quantity, filters.stepSize);

        if (quantity < filters.minQty) {
          log.info(`[Kill Switch] Skipping ${b.asset}: qty ${quantity} below minQty ${filters.minQty} (dust)`);
          continue;
        }

        try {
          const price = await getMexcPrice(symbol);
          if (price > 0 && quantity * price < filters.minNotional) {
            log.info(`[Kill Switch] Skipping ${b.asset}: notional $${(quantity * price).toFixed(2)} below min $${filters.minNotional}`);
            continue;
          }
        } catch {
          // Can't check notional, try anyway
        }
      }

      await placeMexcMarketOrder(symbol, 'SELL', quantity);
      log.info(`[Kill Switch] Sold ${quantity} ${b.asset} for USDT`);
    } catch (err) {
      console.error(`[Kill Switch] Failed to sell ${b.asset}:`, err);
    }
  }
}

/**
 * RUFLO FAZA 3 / BATCH 8 / F9 helper — cancel-all-orders across ALL symbols.
 *
 * Emergency-only: iterates non-USDT balances, issues cancelAllMexcOrders per
 * symbol. Best-effort; per-symbol errors are logged and swallowed so one bad
 * symbol does not block the rest of the flash-crash liquidation.
 *
 * WHY this (not getMexcOpenOrders without symbol): MEXC SPOT sometimes
 * restricts `/openOrders` without symbol param. Iterating balances is
 * authoritative — if there's an open order, the quantity is locked on an
 * asset we hold.
 */
export async function cancelAllOpenOrdersEmergency(): Promise<{ cancelled: string[]; failed: string[] }> {
  assertLiveTradingAllowedForEmergencyExit('cancelAllOpenOrdersEmergency');
  const cancelled: string[] = [];
  const failed: string[] = [];
  let balances: { asset: string; free: number; locked: number }[] = [];
  try {
    balances = await getMexcBalances();
  } catch (err) {
    log.error('[Kill Switch][Cancel-All] getMexcBalances failed — cannot enumerate symbols', { error: (err as Error).message });
    return { cancelled, failed: ['BALANCES_FETCH'] };
  }
  const candidates = balances.filter(b => b.asset !== 'USDT' && (b.locked > 0 || b.free > 0));
  for (const b of candidates) {
    const symbol = `${b.asset}USDT`;
    try {
      await cancelAllMexcOrders(symbol);
      cancelled.push(symbol);
    } catch (err) {
      // Per-symbol failure is not fatal — we still want to try the rest.
      log.warn(`[Kill Switch][Cancel-All] ${symbol} failed`, { error: (err as Error).message });
      failed.push(symbol);
    }
  }
  return { cancelled, failed };
}

// ─── Connection test ───────────────────────────
export async function testMexcConnection(): Promise<{ ok: boolean; mode: string; time?: number; error?: string }> {
  try {
    const time = await getMexcServerTime();
    return { ok: true, mode: 'LIVE', time };
  } catch (err) {
    return { ok: false, mode: 'ERROR', error: (err as Error).message };
  }
}
