// ============================================================
// OKX Client — V5 REST API with HMAC SHA256 + Base64 signing
// Docs: https://www.okx.com/docs-v5/en/
// ============================================================
import crypto from 'crypto';

const OKX_BASE_URL = 'https://www.okx.com';

function getOkxConfig() {
  return {
    apiKey: process.env.OKX_API_KEY || '',
    apiSecret: process.env.OKX_API_SECRET || '',
    passphrase: process.env.OKX_PASSPHRASE || '',
  };
}

function sign(timestamp: string, method: string, path: string, body: string = ''): string {
  const { apiSecret } = getOkxConfig();
  const prehash = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac('sha256', apiSecret).update(prehash).digest('base64');
}

async function okxRequest(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number> = {},
  signed = true
): Promise<Record<string, unknown>> {
  const { apiKey, passphrase } = getOkxConfig();
  const timestamp = new Date().toISOString();

  let url = `${OKX_BASE_URL}${path}`;
  let body = '';

  if (method === 'GET' && Object.keys(params).length > 0) {
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
    url += `?${qs}`;
  }
  if (method === 'POST' && Object.keys(params).length > 0) {
    body = JSON.stringify(params);
  }

  const requestPath = method === 'GET' && Object.keys(params).length > 0
    ? `${path}?${Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')}`
    : path;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (signed) {
    headers['OK-ACCESS-KEY'] = apiKey;
    headers['OK-ACCESS-SIGN'] = sign(timestamp, method, requestPath, body);
    headers['OK-ACCESS-TIMESTAMP'] = timestamp;
    headers['OK-ACCESS-PASSPHRASE'] = passphrase;
  }

  const res = await fetch(url, { method, headers, body: body || undefined });
  const data = await res.json();

  if (data.code && data.code !== '0') {
    throw new Error(`OKX Error ${data.code}: ${data.msg}`);
  }
  return data;
}

// ─── Public endpoints ────────────────────────────
export async function getOkxServerTime(): Promise<string> {
  const data = await okxRequest('GET', '/api/v5/public/time', {}, false);
  const arr = data.data as { ts: string }[];
  return arr?.[0]?.ts || '';
}

export async function getOkxPrice(symbol: string): Promise<number> {
  // OKX uses instId format: BTC-USDT
  const instId = symbol.replace('USDT', '-USDT').replace('USDC', '-USDC');
  const data = await okxRequest('GET', '/api/v5/market/ticker', { instId }, false);
  const arr = data.data as { last: string }[];
  return parseFloat(arr?.[0]?.last || '0');
}

export async function getOkxTicker24h(symbol: string): Promise<Record<string, unknown>> {
  const instId = symbol.replace('USDT', '-USDT');
  const data = await okxRequest('GET', '/api/v5/market/ticker', { instId }, false);
  return (data.data as Record<string, unknown>[])?.[0] || {};
}

export async function getOkxOrderbook(symbol: string, sz = '10'): Promise<Record<string, unknown>> {
  const instId = symbol.replace('USDT', '-USDT');
  const data = await okxRequest('GET', '/api/v5/market/books', { instId, sz }, false);
  return (data.data as Record<string, unknown>[])?.[0] || {};
}

// ─── Account endpoints (signed) ─────────────────
export async function getOkxBalance(): Promise<{ ccy: string; availBal: number; frozenBal: number }[]> {
  const data = await okxRequest('GET', '/api/v5/account/balance');
  const details = ((data.data as Record<string, unknown>[])?.[0] as { details?: Record<string, string>[] })?.details || [];
  return details.map((d) => ({
    ccy: d.ccy,
    availBal: parseFloat(d.availBal || '0'),
    frozenBal: parseFloat(d.frozenBal || '0'),
  })).filter(b => b.availBal > 0 || b.frozenBal > 0);
}

// ─── Trading endpoints ──────────────────────────
export async function placeOkxMarketOrder(
  symbol: string,
  side: 'buy' | 'sell',
  sz: string,
  tdMode: string = 'cash'
): Promise<Record<string, unknown>> {
  const instId = symbol.replace('USDT', '-USDT');
  const data = await okxRequest('POST', '/api/v5/trade/order', {
    instId,
    tdMode,
    side,
    ordType: 'market',
    sz,
  });
  return (data.data as Record<string, unknown>[])?.[0] || {};
}

export async function placeOkxLimitOrder(
  symbol: string,
  side: 'buy' | 'sell',
  sz: string,
  px: string,
  tdMode: string = 'cash'
): Promise<Record<string, unknown>> {
  const instId = symbol.replace('USDT', '-USDT');
  const data = await okxRequest('POST', '/api/v5/trade/order', {
    instId,
    tdMode,
    side,
    ordType: 'limit',
    sz,
    px,
  });
  return (data.data as Record<string, unknown>[])?.[0] || {};
}

export async function cancelOkxOrder(symbol: string, ordId: string): Promise<Record<string, unknown>> {
  const instId = symbol.replace('USDT', '-USDT');
  const data = await okxRequest('POST', '/api/v5/trade/cancel-order', { instId, ordId });
  return (data.data as Record<string, unknown>[])?.[0] || {};
}

export async function getOkxOpenOrders(symbol?: string): Promise<Record<string, unknown>[]> {
  const params: Record<string, string | number> = {};
  if (symbol) params.instId = symbol.replace('USDT', '-USDT');
  const data = await okxRequest('GET', '/api/v5/trade/orders-pending', params);
  return (data.data as Record<string, unknown>[]) || [];
}

// ─── Connection test ───────────────────────────
export async function testOkxConnection(): Promise<{ ok: boolean; mode: string; time?: string; error?: string }> {
  try {
    const time = await getOkxServerTime();
    return { ok: true, mode: 'LIVE', time };
  } catch (err) {
    return { ok: false, mode: 'ERROR', error: (err as Error).message };
  }
}
