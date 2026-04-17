// ============================================================
// Binance Client — V3 Spot API with HMAC SHA256 signing
// API docs: https://binance-docs.github.io/apidocs/
// ============================================================
import crypto from 'crypto';
import { recordProviderHealth } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';
import { assertLiveTradingAllowed } from '@/lib/core/tradingMode';

const log = createLogger('BinanceClient');
const BINANCE_BASE_URL = 'https://api.binance.com';

// ─── Rate Limiter ──
const rateLimiter = {
  lastCall: 0,
  minIntervalMs: 50, // 50ms minimum between calls (~20 req/s)
  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastCall = Date.now();
  }
};

function getBinanceConfig() {
  return {
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
  };
}

function sign(queryString: string): string {
  const { apiSecret } = getBinanceConfig();
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function binanceRequest(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  params: Record<string, string | number> = {},
  signed = true,
  retries = 2
): Promise<Record<string, unknown>> {
  const { apiKey } = getBinanceConfig();

  if (signed) {
    params.timestamp = Date.now();
    params.recvWindow = 5000;
  }

  // AUDIT FIX T2.7: URL-encode params to prevent injection & broken queries
  const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(String(k))}=${encodeURIComponent(String(v))}`).join('&');
  let url = `${BINANCE_BASE_URL}${endpoint}`;

  if (signed) {
    const signature = sign(qs);
    url += `?${qs}&signature=${signature}`;
  } else if (qs) {
    url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (signed && apiKey) {
    headers['X-MBX-APIKEY'] = apiKey;
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
        log.warn(`[BINANCE] Rate limited, backing off ${wait}ms (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      const data = await res.json();

      if (data.code && data.code !== 200 && data.code !== 0) {
        throw new Error(`Binance Error ${data.code}: ${data.msg}`);
      }

      recordProviderHealth('binance', true, Date.now() - start);
      return data;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        const wait = 500 * Math.pow(2, attempt);
        log.warn(`[BINANCE] Request failed, retrying in ${wait}ms: ${lastError.message}`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }

  recordProviderHealth('binance', false, Date.now() - start);
  throw lastError || new Error('[BINANCE] Unknown error');
}

// ─── Price ─────────────────────────────────
export async function getBinancePrice(symbol: string): Promise<number> {
  const tickerSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
  const data = await binanceRequest('GET', '/api/v3/ticker/price', { symbol: tickerSymbol }, false);
  return parseFloat((data as { price: string }).price);
}

// ─── Balances ──────────────────────────────
export interface BinanceBalance {
  asset: string;
  free: number;
  locked: number;
}

export async function getBinanceBalances(): Promise<BinanceBalance[]> {
  const data = await binanceRequest('GET', '/api/v3/account', {}, true);
  return ((data as { balances: { asset: string; free: string; locked: string }[] }).balances || []).map(b => ({
    asset: b.asset,
    free: parseFloat(b.free),
    locked: parseFloat(b.locked),
  }));
}

// ─── Limit Order ───────────────────────────
export async function placeBinanceLimitOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number
): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`placeBinanceLimitOrder(${symbol},${side},${quantity}@${price})`);
  const tickerSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
  return binanceRequest('POST', '/api/v3/order', {
    symbol: tickerSymbol,
    side,
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: quantity.toString(),
    price: price.toString(),
  }, true);
}

// ─── Market Order ──────────────────────────
export async function placeBinanceMarketOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number
): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`placeBinanceMarketOrder(${symbol},${side},${quantity})`);
  const tickerSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
  return binanceRequest('POST', '/api/v3/order', {
    symbol: tickerSymbol,
    side,
    type: 'MARKET',
    quantity: quantity.toString(),
  }, true);
}

// ─── Stop Loss Order ────────────────────────
export async function placeBinanceStopLossOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  stopPrice: number
): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`placeBinanceStopLossOrder(${symbol},${side},${quantity}@${stopPrice})`);
  const tickerSymbol = symbol.includes('USDT') ? symbol : `${symbol}USDT`;
  return binanceRequest('POST', '/api/v3/order', {
    symbol: tickerSymbol,
    side,
    type: 'STOP_LOSS_LIMIT',
    timeInForce: 'GTC',
    quantity: quantity.toString(),
    price: stopPrice.toString(),
    stopPrice: stopPrice.toString(),
  }, true);
}

// ─── Open Positions ────────────────────────
export async function getBinanceOpenPositions(): Promise<Record<string, unknown>[]> {
  try {
    const data = await binanceRequest('GET', '/api/v3/openOrders', {}, true);
    return (data as unknown as Record<string, unknown>[]) || [];
  } catch (err) {
    log.warn(`[BINANCE] Failed to fetch open positions: ${(err as Error).message}`);
    return [];
  }
}

// ─── Exchange Info (for filters) ──────────
export async function getBinanceExchangeInfo(): Promise<Record<string, unknown>> {
  return binanceRequest('GET', '/api/v3/exchangeInfo', {}, false);
}

// ─── Test Connection ───────────────────────
export async function testBinanceConnection(): Promise<{ ok: boolean; mode: string; error?: string }> {
  const config = getBinanceConfig();

  if (!config.apiKey || !config.apiSecret) {
    return { ok: false, mode: 'OFFLINE', error: 'Missing BINANCE_API_KEY or BINANCE_API_SECRET' };
  }

  try {
    const start = Date.now();
    const data = await binanceRequest('GET', '/api/v3/account', {}, true);
    const latency = Date.now() - start;

    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response');
    }

    log.info(`[BINANCE] Connected (latency: ${latency}ms)`);
    return { ok: true, mode: 'LIVE', error: undefined };
  } catch (err) {
    log.error(`[BINANCE] Connection failed: ${(err as Error).message}`);
    return { ok: false, mode: 'OFFLINE', error: (err as Error).message };
  }
}
