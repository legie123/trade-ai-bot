// ============================================================
// Binance Client — Real API integration (Testnet + Live)
// Hardened with retry/backoff, health tracking, timeouts
// HMAC SHA256 signed requests
// ============================================================
import crypto from 'crypto';
import { fetchWithRetry } from '@/lib/providers/base';
import { createLogger } from '@/lib/core/logger';
import { recordProviderHealth } from '@/lib/core/heartbeat';

const log = createLogger('BinanceClient');

const BINANCE_TESTNET_URL = 'https://testnet.binance.vision';
const BINANCE_LIVE_URL = 'https://api.binance.com';

function getConfig() {
  return {
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    testnet: process.env.BINANCE_TESTNET === 'true',
  };
}

function getBaseUrl(): string {
  return getConfig().testnet ? BINANCE_TESTNET_URL : BINANCE_LIVE_URL;
}

function sign(queryString: string): string {
  const { apiSecret } = getConfig();
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function binanceRequest(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  params: Record<string, string | number> = {},
  signed = true
): Promise<Record<string, unknown>> {
  const { apiKey } = getConfig();
  const url = new URL(`${getBaseUrl()}${endpoint}`);

  if (signed) {
    params.timestamp = Date.now();
    params.recvWindow = 5000;
  }

  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');

  if (signed) {
    const signature = sign(qs);
    url.search = `${qs}&signature=${signature}`;
  } else {
    url.search = qs;
  }

  const start = Date.now();

  try {
    // Rely on base fetchWithRetry for timeout (default 10s) and exponential backoff
    const res = await fetchWithRetry(url.toString(), {
      retries: 2,
      timeoutMs: 8000,
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = await res.json();
    if (data.code && data.code < 0) {
      throw new Error(`Binance Error ${data.code}: ${data.msg}`);
    }
    recordProviderHealth('binance', true, Date.now() - start);
    return data;
  } catch (err) {
    recordProviderHealth('binance', false, Date.now() - start);
    log.error(`API Request failed: ${endpoint}`, { error: (err as Error).message });
    throw err;
  }
}

// ─── Public endpoints ──────────────────────────────
export async function getServerTime(): Promise<number> {
  const data = await binanceRequest('GET', '/api/v3/time', {}, false);
  return data.serverTime as number;
}

export async function getPrice(symbol: string): Promise<number> {
  const data = await binanceRequest('GET', '/api/v3/ticker/price', { symbol }, false);
  return parseFloat(data.price as string) || 0;
}

export async function getExchangeInfo(symbol?: string): Promise<Record<string, unknown>> {
  const params: Record<string, string | number> = symbol ? { symbol } : {};
  return binanceRequest('GET', '/api/v3/exchangeInfo', params, false);
}

// ─── Account endpoints (signed) ────────────────────
export async function getAccountInfo(): Promise<Record<string, unknown>> {
  try {
    return await binanceRequest('GET', '/api/v3/account');
  } catch {
    // Silently return empty account in PAPER mode when keys are invalid
    return { balances: [], makerCommission: 0, takerCommission: 0 };
  }
}

export async function getBalances(): Promise<{ asset: string; free: number; locked: number }[]> {
  const account = await getAccountInfo();
  const balances = (account.balances as { asset: string; free: string; locked: string }[]) || [];
  return balances
    .map((b) => ({
      asset: b.asset,
      free: parseFloat(b.free),
      locked: parseFloat(b.locked),
    }))
    .filter((b) => b.free > 0 || b.locked > 0);
}

// ─── Trading endpoints ─────────────────────────────
export async function placeMarketOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number
): Promise<Record<string, unknown>> {
  // PAPER TRADING SAFETY GUARD
  log.warn('Attempted to place live order — intercepted by PAPER TRADING safeguard', { symbol, side, quantity });
  throw new Error('PAPER TRADING ONLY — Live orders disabled');
}

export async function placeLimitOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price?: number
): Promise<Record<string, unknown>> {
  log.warn('Attempted to place limit order — intercepted by PAPER TRADING safeguard', { symbol, side, quantity, price });
  throw new Error('PAPER TRADING ONLY — Live orders disabled');
}

export async function placeStopLossOrder(): Promise<Record<string, unknown>> {
  throw new Error('PAPER TRADING ONLY — Live orders disabled');
}

export async function cancelOrder(symbol: string, orderId: number): Promise<Record<string, unknown>> {
  return binanceRequest('DELETE', '/api/v3/order', { symbol, orderId });
}

export async function getOpenOrders(symbol?: string): Promise<Record<string, unknown>[]> {
  const params: Record<string, string | number> = symbol ? { symbol } : {};
  const data = await binanceRequest('GET', '/api/v3/openOrders', params);
  return Array.isArray(data) ? data : [];
}

export async function getOrderHistory(symbol: string, limit = 20): Promise<Record<string, unknown>[]> {
  const data = await binanceRequest('GET', '/api/v3/allOrders', { symbol, limit });
  return Array.isArray(data) ? data : [];
}

// ─── Connection test (with fallback) ───────────────
export async function testConnection(): Promise<{ ok: boolean; mode: string; time?: number; error?: string }> {
  const { testnet } = getConfig();

  // Try Binance first
  try {
    const time = await getServerTime();
    return { ok: true, mode: testnet ? 'TESTNET' : 'LIVE', time };
  } catch {
    // Binance blocked — try OKX
  }

  try {
    const res = await fetch('https://www.okx.com/api/v5/public/time', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json();
      return { ok: true, mode: 'OKX_FALLBACK', time: parseInt(json?.data?.[0]?.ts || '0') };
    }
  } catch {
    // OKX also failed — try CryptoCompare
  }

  try {
    const res = await fetch('https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USDT', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { ok: true, mode: 'CC_FALLBACK', time: Date.now() };
    }
  } catch {
    // All failed
  }

  return { ok: false, mode: 'ERROR', error: 'All providers (Binance/OKX/CC) failed' };
}
