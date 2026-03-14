// ============================================================
// Binance Client — Real API integration (Testnet + Live)
// HMAC SHA256 signed requests
// ============================================================
import crypto from 'crypto';

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

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'X-MBX-APIKEY': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const data = await res.json();
  if (data.code && data.code < 0) {
    throw new Error(`Binance Error ${data.code}: ${data.msg}`);
  }
  return data;
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
  return binanceRequest('GET', '/api/v3/account');
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
  return binanceRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity: quantity.toString(),
  });
}

export async function placeLimitOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number
): Promise<Record<string, unknown>> {
  return binanceRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: quantity.toString(),
    price: price.toString(),
  });
}

export async function placeStopLossOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  stopPrice: number,
  price: number
): Promise<Record<string, unknown>> {
  return binanceRequest('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'STOP_LOSS_LIMIT',
    timeInForce: 'GTC',
    quantity: quantity.toString(),
    price: price.toString(),
    stopPrice: stopPrice.toString(),
  });
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

// ─── Connection test ───────────────────────────────
export async function testConnection(): Promise<{ ok: boolean; mode: string; time?: number; error?: string }> {
  try {
    const time = await getServerTime();
    const { testnet } = getConfig();
    return { ok: true, mode: testnet ? 'TESTNET' : 'LIVE', time };
  } catch (err) {
    return { ok: false, mode: 'ERROR', error: (err as Error).message };
  }
}
