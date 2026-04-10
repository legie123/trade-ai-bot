// ============================================================
// MEXC Client — V3 Spot API with HMAC SHA256 signing
// Hardened: retry + backoff, timeout, rate limiter, health tracking
// API docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/
// ============================================================
import crypto from 'crypto';
import { addInvalidSymbol, isSymbolValid } from '@/lib/store/db';
import { recordProviderHealth } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';

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
  return {
    apiKey: process.env.MEXC_API_KEY || '',
    apiSecret: process.env.MEXC_API_SECRET || '',
  };
}

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

  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
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
  if (signed || apiKey) {
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
  
  try {
    const data = await mexcRequest('GET', '/api/v3/ticker/price', { symbol }, false);
    return parseFloat(data.price as string) || 0;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Invalid symbol') || msg.includes('400') || msg.includes('404')) {
      addInvalidSymbol(symbol);
    }
    return 0;
  }
}

export async function getMexcTicker24h(symbol: string): Promise<Record<string, unknown>> {
  return mexcRequest('GET', '/api/v3/ticker/24hr', { symbol }, false);
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
  return mexcRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'LIMIT',
    quantity: quantity.toString(),
    price: price.toString(),
  });
}

export async function cancelMexcOrder(symbol: string, orderId: string): Promise<Record<string, unknown>> {
  return mexcRequest('DELETE', '/api/v3/order', { symbol, orderId });
}

export async function placeMexcStopLossOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  stopPrice: number
): Promise<Record<string, unknown>> {
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
  return mexcRequest('DELETE', '/api/v3/openOrders', { symbol });
}

/**
 * Emergency Exit: Sells all non-USDT assets to USDT at Market price.
 * OMEGA FIX: Now applies roundToStep + minNotional validation per symbol.
 */
export async function sellAllAssetsToUsdt(): Promise<void> {
  const balances = await getMexcBalances();
  const nonUsdt = balances.filter(b => b.asset !== 'USDT' && b.asset !== 'MX' && b.free > 0);

  if (nonUsdt.length === 0) {
    console.log('[Kill Switch] No non-USDT assets to sell.');
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
          console.log(`[Kill Switch] Skipping ${b.asset}: qty ${quantity} below minQty ${filters.minQty} (dust)`);
          continue;
        }

        try {
          const price = await getMexcPrice(symbol);
          if (price > 0 && quantity * price < filters.minNotional) {
            console.log(`[Kill Switch] Skipping ${b.asset}: notional $${(quantity * price).toFixed(2)} below min $${filters.minNotional}`);
            continue;
          }
        } catch {
          // Can't check notional, try anyway
        }
      }

      await placeMexcMarketOrder(symbol, 'SELL', quantity);
      console.log(`[Kill Switch] Sold ${quantity} ${b.asset} for USDT`);
    } catch (err) {
      console.error(`[Kill Switch] Failed to sell ${b.asset}:`, err);
    }
  }
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
