// ============================================================
// MEXC Client — V3 Spot API with HMAC SHA256 signing
// API docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/
// ============================================================
import crypto from 'crypto';

const MEXC_BASE_URL = 'https://api.mexc.com';

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
  signed = true
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

  const res = await fetch(url, { method, headers });
  const data = await res.json();

  if (data.code && data.code !== 200 && data.code !== 0) {
    throw new Error(`MEXC Error ${data.code}: ${data.msg}`);
  }
  return data;
}

// ─── Public endpoints ────────────────────────────
export async function getMexcServerTime(): Promise<number> {
  const data = await mexcRequest('GET', '/api/v3/time', {}, false);
  return data.serverTime as number;
}

export async function getMexcPrice(symbol: string): Promise<number> {
  const data = await mexcRequest('GET', '/api/v3/ticker/price', { symbol }, false);
  return parseFloat(data.price as string) || 0;
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

export async function getMexcOpenOrders(symbol?: string): Promise<Record<string, unknown>> {
  const params: Record<string, string | number> = {};
  if (symbol) params.symbol = symbol;
  return mexcRequest('GET', '/api/v3/openOrders', params);
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
