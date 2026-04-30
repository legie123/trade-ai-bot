// ============================================================
// Bybit Client — Multi-Exchange Support
// Testnet + Live, HMAC SHA256 signed requests
// ============================================================
import crypto from 'crypto';
import { assertLiveTradingAllowed } from '@/lib/core/tradingMode';

const BYBIT_TESTNET_URL = 'https://api-testnet.bybit.com';
const BYBIT_LIVE_URL = 'https://api.bybit.com';

function getBybitConfig() {
  return {
    apiKey: process.env.BYBIT_API_KEY || '',
    apiSecret: process.env.BYBIT_API_SECRET || '',
    testnet: process.env.BYBIT_TESTNET === 'true', // AUDIT FIX API-2: Default to LIVE (was testnet=true)
  };
}

function getBaseUrl(): string {
  return getBybitConfig().testnet ? BYBIT_TESTNET_URL : BYBIT_LIVE_URL;
}

// AUDIT FIX API-2: Added timeout, retry with backoff, rate limiting
const bybitRateLimiter = {
  lastCall: 0,
  minIntervalMs: 100,
  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastCall = Date.now();
  }
};

async function bybitRequest(
  method: 'GET' | 'POST',
  endpoint: string,
  params: Record<string, string | number> = {},
  signed = true,
  retries = 2
): Promise<Record<string, unknown>> {
  const { apiKey, apiSecret } = getBybitConfig();
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  let queryString = '';
  let body = '';

  if (method === 'GET') {
    queryString = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  } else {
    body = JSON.stringify(params);
  }

  // Bybit V5 signature
  let signPayload = '';
  if (signed) {
    signPayload = `${timestamp}${apiKey}${recvWindow}${method === 'GET' ? queryString : body}`;
  }

  const signature = signed
    ? crypto.createHmac('sha256', apiSecret).update(signPayload).digest('hex')
    : '';

  const url = `${getBaseUrl()}${endpoint}${queryString ? `?${queryString}` : ''}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (signed) {
    headers['X-BAPI-API-KEY'] = apiKey;
    headers['X-BAPI-SIGN'] = signature;
    headers['X-BAPI-TIMESTAMP'] = timestamp;
    headers['X-BAPI-RECV-WINDOW'] = recvWindow;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await bybitRateLimiter.wait();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const res = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        ...(method === 'POST' ? { body } : {}),
      });
      clearTimeout(timer);

      // Rate limited — backoff
      if (res.status === 429) {
        const wait = 1000 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      const data = await res.json();
      if (data.retCode !== 0 && data.retCode !== undefined) {
        throw new Error(`Bybit Error ${data.retCode}: ${data.retMsg}`);
      }
      return data;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        const wait = 500 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastError || new Error('[BYBIT] Unknown error');
}

// ─── Public endpoints ────────────────────────────
export async function getBybitServerTime(): Promise<number> {
  const data = await bybitRequest('GET', '/v5/market/time', {}, false);
  return parseInt((data.result as { timeSecond: string })?.timeSecond || '0') * 1000;
}

export async function getBybitPrice(symbol: string): Promise<number> {
  const data = await bybitRequest('GET', '/v5/market/tickers', { category: 'spot', symbol }, false);
  const list = (data.result as { list: { lastPrice: string }[] })?.list;
  return list?.[0] ? parseFloat(list[0].lastPrice) : 0;
}

export async function getBybitOrderbook(symbol: string): Promise<Record<string, unknown>> {
  return bybitRequest('GET', '/v5/market/orderbook', { category: 'spot', symbol, limit: 5 }, false);
}

// ─── Account endpoints (signed) ────────────────
export async function getBybitBalance(): Promise<{ coin: string; free: number; locked: number }[]> {
  const data = await bybitRequest('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
  const accounts = (data.result as { list: { coin: { coin: string; walletBalance: string; locked: string }[] }[] })?.list;
  if (!accounts?.[0]?.coin) return [];
  return accounts[0].coin
    .map(c => ({
      coin: c.coin,
      free: parseFloat(c.walletBalance) - parseFloat(c.locked || '0'),
      locked: parseFloat(c.locked || '0'),
    }))
    .filter(c => c.free > 0 || c.locked > 0);
}

// ─── Trading endpoints ────────────────────────
export async function placeBybitOrder(
  symbol: string,
  side: 'Buy' | 'Sell',
  qty: number,
  orderType: 'Market' | 'Limit' = 'Market',
  price?: number
): Promise<Record<string, unknown>> {
  assertLiveTradingAllowed(`placeBybitOrder(${symbol},${side},${qty},${orderType})`);
  const params: Record<string, string | number> = {
    category: 'spot',
    symbol,
    side,
    orderType,
    qty: qty.toString(),
  };
  if (orderType === 'Limit' && price) {
    params.price = price.toString();
    params.timeInForce = 'GTC';
  }
  return bybitRequest('POST', '/v5/order/create', params);
}

// ─── Connection test ───────────────────────────
export async function testBybitConnection(): Promise<{ ok: boolean; mode: string; error?: string }> {
  try {
    await getBybitServerTime();
    const { testnet } = getBybitConfig();
    return { ok: true, mode: testnet ? 'TESTNET' : 'LIVE' };
  } catch (err) {
    return { ok: false, mode: 'ERROR', error: (err as Error).message };
  }
}
