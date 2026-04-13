// ============================================================
// OKX Client — V5 REST API with HMAC SHA256 + Base64 signing
// Hardened: retry + backoff, timeout, health tracking
// Docs: https://www.okx.com/docs-v5/en/
// ============================================================
import crypto from 'crypto';
import { recordProviderHealth } from '@/lib/core/heartbeat';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('OkxClient');
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
  signed = true,
  retries = 2
): Promise<Record<string, unknown>> {
  const { apiKey, passphrase } = getOkxConfig();

  // AUDIT FIX API-4: Build query string ONCE, reuse for URL and signature
  const hasParams = Object.keys(params).length > 0;
  const qs = hasParams ? Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&') : '';
  let body = '';

  let url = `${OKX_BASE_URL}${path}`;
  if (method === 'GET' && qs) {
    url += `?${qs}`;
  }
  if (method === 'POST' && hasParams) {
    body = JSON.stringify(params);
  }

  const requestPath = (method === 'GET' && qs) ? `${path}?${qs}` : path;

  let lastError: Error | null = null;
  const start = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const timestamp = new Date().toISOString();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (signed) {
        headers['OK-ACCESS-KEY'] = apiKey;
        headers['OK-ACCESS-SIGN'] = sign(timestamp, method, requestPath, body);
        headers['OK-ACCESS-TIMESTAMP'] = timestamp;
        headers['OK-ACCESS-PASSPHRASE'] = passphrase;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, { method, headers, body: body || undefined, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 429) {
        const wait = 1000 * Math.pow(2, attempt);
        log.warn(`[OKX] Rate limited, backing off ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      const data = await res.json();

      if (data.code && data.code !== '0') {
        throw new Error(`OKX Error ${data.code}: ${data.msg}`);
      }

      recordProviderHealth('okx', true, Date.now() - start);
      return data;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }

  recordProviderHealth('okx', false, Date.now() - start);
  log.error(`[OKX] Request failed after ${retries + 1} attempts: ${path}`, { error: lastError?.message });
  throw lastError ?? new Error('OKX request failed');
}

// ─── Public endpoints ────────────────────────────
export async function getOkxServerTime(): Promise<string> {
  const data = await okxRequest('GET', '/api/v5/public/time', {}, false);
  const arr = data.data as { ts: string }[];
  return arr?.[0]?.ts || '';
}

export async function getOkxPrice(symbol: string): Promise<number> {
  // AUDIT FIX BUG-8: Use regex with $ anchor to avoid USDTUSD → USD-TUSDT-USD
  const instId = symbol.replace(/USDT$/, '-USDT').replace(/USDC$/, '-USDC');
  const data = await okxRequest('GET', '/api/v5/market/ticker', { instId }, false);
  const arr = data.data as { last: string }[];
  return parseFloat(arr?.[0]?.last || '0');
}

export async function getOkxTicker24h(symbol: string): Promise<Record<string, unknown>> {
  const instId = symbol.replace(/USDT$/, '-USDT');
  const data = await okxRequest('GET', '/api/v5/market/ticker', { instId }, false);
  return (data.data as Record<string, unknown>[])?.[0] || {};
}

export async function getOkxOrderbook(symbol: string, sz = '10'): Promise<Record<string, unknown>> {
  const instId = symbol.replace(/USDT$/, '-USDT');
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
  const instId = symbol.replace(/USDT$/, '-USDT');
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
  const instId = symbol.replace(/USDT$/, '-USDT');
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
  const instId = symbol.replace(/USDT$/, '-USDT');
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
