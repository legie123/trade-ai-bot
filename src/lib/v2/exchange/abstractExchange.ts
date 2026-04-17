/**
 * Abstract Exchange Connector — Step 3.3
 *
 * ADDITIVE. Unified interface over MEXC, OKX, Bybit (and future exchanges).
 * Does NOT replace existing exchange clients — wraps them behind a common API.
 *
 * Architecture:
 *   ExecutionArena / SentinelGuard → ExchangeRouter.get(exchangeId) → AbstractExchange
 *     → delegates to mexcClient / okxClient / bybitClient
 *
 * Usage:
 *   const exchange = ExchangeRouter.get('mexc');
 *   const price = await exchange.getPrice('BTCUSDT');
 *   const order = await exchange.marketOrder('BTCUSDT', 'BUY', 0.001);
 *
 * Kill-switch: N/A — this is a wrapper, not a decision-maker.
 *
 * ASSUMPTION: All exchanges use the same symbol format (e.g., BTCUSDT).
 *   Symbol normalization is the caller's responsibility.
 *   MEXC/Bybit use BTCUSDT, OKX uses BTC-USDT. Adapter handles conversion.
 */

import { createLogger } from '@/lib/core/logger';

const log = createLogger('AbstractExchange');

// ─── Unified Types ──────────────────────────────────────────

export interface ExchangeBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS';
  status: 'FILLED' | 'PENDING' | 'REJECTED' | 'CANCELLED';
  price?: number;
  quantity: number;
  raw?: Record<string, unknown>;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  volume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
}

export interface OrderbookSnapshot {
  symbol: string;
  bids: [number, number][];  // [price, quantity]
  asks: [number, number][];
  timestamp: number;
}

export interface ConnectionTest {
  ok: boolean;
  exchange: string;
  mode: string;
  latencyMs: number;
  error?: string;
}

// ─── Abstract Interface ─────────────────────────────────────

export interface IExchange {
  readonly exchangeId: string;

  // Market Data
  getPrice(symbol: string): Promise<number>;
  getTicker24h(symbol: string): Promise<Ticker24h>;
  getOrderbook(symbol: string, limit?: number): Promise<OrderbookSnapshot>;

  // Account
  getBalances(): Promise<ExchangeBalance[]>;

  // Orders
  marketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<OrderResult>;
  limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number, price: number): Promise<OrderResult>;
  cancelOrder(symbol: string, orderId: string): Promise<OrderResult>;
  getOpenOrders(symbol?: string): Promise<OrderResult[]>;
  cancelAllOrders(symbol: string): Promise<void>;

  // Emergency
  sellAllToUsdt(): Promise<void>;

  // Health
  testConnection(): Promise<ConnectionTest>;
}

// ─── MEXC Adapter ───────────────────────────────────────────

class MexcAdapter implements IExchange {
  readonly exchangeId = 'mexc';

  async getPrice(symbol: string): Promise<number> {
    const { getMexcPrice } = await import('@/lib/exchange/mexcClient');
    return getMexcPrice(symbol);
  }

  async getTicker24h(symbol: string): Promise<Ticker24h> {
    const { getMexcTicker24h } = await import('@/lib/exchange/mexcClient');
    const raw = await getMexcTicker24h(symbol);
    return {
      symbol,
      lastPrice: Number(raw.lastPrice) || 0,
      volume24h: Number(raw.volume) || 0,
      priceChange24h: Number(raw.priceChange) || 0,
      priceChangePercent24h: Number(raw.priceChangePercent) || 0,
      high24h: Number(raw.highPrice) || 0,
      low24h: Number(raw.lowPrice) || 0,
    };
  }

  async getOrderbook(symbol: string, limit = 10): Promise<OrderbookSnapshot> {
    const { getMexcOrderbook } = await import('@/lib/exchange/mexcClient');
    const raw = await getMexcOrderbook(symbol, limit);
    return {
      symbol,
      bids: (raw.bids as [string, string][] || []).map(([p, q]) => [Number(p), Number(q)]),
      asks: (raw.asks as [string, string][] || []).map(([p, q]) => [Number(p), Number(q)]),
      timestamp: Date.now(),
    };
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const { getMexcBalances } = await import('@/lib/exchange/mexcClient');
    return getMexcBalances();
  }

  async marketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<OrderResult> {
    const { placeMexcMarketOrder } = await import('@/lib/exchange/mexcClient');
    const raw = await placeMexcMarketOrder(symbol, side, quantity);
    return this.parseOrder(raw, symbol, side, 'MARKET', quantity);
  }

  async limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number, price: number): Promise<OrderResult> {
    const { placeMexcLimitOrder } = await import('@/lib/exchange/mexcClient');
    const raw = await placeMexcLimitOrder(symbol, side, quantity, price);
    return this.parseOrder(raw, symbol, side, 'LIMIT', quantity);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<OrderResult> {
    const { cancelMexcOrder } = await import('@/lib/exchange/mexcClient');
    const raw = await cancelMexcOrder(symbol, orderId);
    return {
      orderId,
      symbol,
      side: 'BUY', // Unknown from cancel response
      type: 'MARKET',
      status: 'CANCELLED',
      quantity: 0,
      raw,
    };
  }

  async getOpenOrders(symbol?: string): Promise<OrderResult[]> {
    const { getMexcOpenOrders } = await import('@/lib/exchange/mexcClient');
    const orders = await getMexcOpenOrders(symbol);
    return orders.map(o => ({
      orderId: String(o.orderId || ''),
      symbol: String(o.symbol || ''),
      side: (String(o.side) || 'BUY') as 'BUY' | 'SELL',
      type: (String(o.type) || 'LIMIT') as 'MARKET' | 'LIMIT',
      status: 'PENDING' as const,
      price: Number(o.price) || undefined,
      quantity: Number(o.origQty) || 0,
      raw: o,
    }));
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const { cancelAllMexcOrders } = await import('@/lib/exchange/mexcClient');
    await cancelAllMexcOrders(symbol);
  }

  async sellAllToUsdt(): Promise<void> {
    const { sellAllAssetsToUsdt } = await import('@/lib/exchange/mexcClient');
    await sellAllAssetsToUsdt();
  }

  async testConnection(): Promise<ConnectionTest> {
    const t0 = Date.now();
    const { testMexcConnection } = await import('@/lib/exchange/mexcClient');
    const result = await testMexcConnection();
    return {
      ok: result.ok,
      exchange: 'mexc',
      mode: result.mode,
      latencyMs: Date.now() - t0,
      error: result.error,
    };
  }

  private parseOrder(
    raw: Record<string, unknown>, symbol: string, side: 'BUY' | 'SELL',
    type: 'MARKET' | 'LIMIT', quantity: number,
  ): OrderResult {
    return {
      orderId: String(raw.orderId || raw.id || ''),
      symbol,
      side,
      type,
      status: raw.status === 'FILLED' ? 'FILLED' : 'PENDING',
      price: Number(raw.price) || undefined,
      quantity,
      raw,
    };
  }
}

// ─── OKX Adapter ────────────────────────────────────────────

class OkxAdapter implements IExchange {
  readonly exchangeId = 'okx';

  /** OKX uses BTC-USDT format, convert from BTCUSDT */
  private toOkxSymbol(symbol: string): string {
    // BTCUSDT → BTC-USDT
    const match = symbol.match(/^(\w+)(USDT|USDC|BTC|ETH)$/);
    if (match) return `${match[1]}-${match[2]}`;
    return symbol;
  }

  async getPrice(symbol: string): Promise<number> {
    const { getOkxPrice } = await import('@/lib/exchange/okxClient');
    return getOkxPrice(this.toOkxSymbol(symbol));
  }

  async getTicker24h(symbol: string): Promise<Ticker24h> {
    const { getOkxTicker24h } = await import('@/lib/exchange/okxClient');
    const raw = await getOkxTicker24h(this.toOkxSymbol(symbol));
    return {
      symbol,
      lastPrice: Number(raw.last) || 0,
      volume24h: Number(raw.vol24h) || 0,
      priceChange24h: 0,
      priceChangePercent24h: 0,
      high24h: Number(raw.high24h) || 0,
      low24h: Number(raw.low24h) || 0,
    };
  }

  async getOrderbook(symbol: string, limit = 10): Promise<OrderbookSnapshot> {
    const { getOkxOrderbook } = await import('@/lib/exchange/okxClient');
    const raw = await getOkxOrderbook(this.toOkxSymbol(symbol), String(limit));
    const books = (raw.data as Record<string, unknown>[])?.[0] || raw;
    return {
      symbol,
      bids: (books.bids as [string, string][] || []).map(([p, q]) => [Number(p), Number(q)]),
      asks: (books.asks as [string, string][] || []).map(([p, q]) => [Number(p), Number(q)]),
      timestamp: Date.now(),
    };
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const { getOkxBalance } = await import('@/lib/exchange/okxClient');
    const balances = await getOkxBalance();
    return balances.map(b => ({
      asset: b.ccy,
      free: b.availBal,
      locked: b.frozenBal,
    }));
  }

  async marketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<OrderResult> {
    const { placeOkxMarketOrder } = await import('@/lib/exchange/okxClient');
    const okxSide = side.toLowerCase() as 'buy' | 'sell';
    const raw = await placeOkxMarketOrder(this.toOkxSymbol(symbol), okxSide, String(quantity));
    const rawObj = raw as Record<string, unknown>;
    const dataArr = Array.isArray(rawObj.data) ? rawObj.data : [];
    return {
      orderId: String(rawObj.ordId || (dataArr[0] as Record<string, unknown>)?.ordId || ''),
      symbol, side, type: 'MARKET', status: 'FILLED', quantity, raw: rawObj,
    };
  }

  async limitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number, price: number): Promise<OrderResult> {
    const { placeOkxLimitOrder } = await import('@/lib/exchange/okxClient');
    const okxSide = side.toLowerCase() as 'buy' | 'sell';
    const raw = await placeOkxLimitOrder(this.toOkxSymbol(symbol), okxSide, String(quantity), String(price));
    const rawObj = raw as Record<string, unknown>;
    const dataArr = Array.isArray(rawObj.data) ? rawObj.data : [];
    return {
      orderId: String(rawObj.ordId || (dataArr[0] as Record<string, unknown>)?.ordId || ''),
      symbol, side, type: 'LIMIT', status: 'PENDING', price, quantity, raw: rawObj,
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<OrderResult> {
    const { cancelOkxOrder } = await import('@/lib/exchange/okxClient');
    await cancelOkxOrder(this.toOkxSymbol(symbol), orderId);
    return { orderId, symbol, side: 'BUY', type: 'MARKET', status: 'CANCELLED', quantity: 0 };
  }

  async getOpenOrders(symbol?: string): Promise<OrderResult[]> {
    const { getOkxOpenOrders } = await import('@/lib/exchange/okxClient');
    const orders = await getOkxOpenOrders(symbol ? this.toOkxSymbol(symbol) : undefined);
    return orders.map(o => ({
      orderId: String(o.ordId || ''),
      symbol: String(o.instId || ''),
      side: (String(o.side) === 'buy' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
      type: 'LIMIT' as const,
      status: 'PENDING' as const,
      quantity: Number(o.sz) || 0,
    }));
  }

  async cancelAllOrders(_symbol: string): Promise<void> {
    // OKX doesn't have a batch cancel by symbol in our client
    const orders = await this.getOpenOrders(_symbol);
    for (const o of orders) {
      await this.cancelOrder(_symbol, o.orderId).catch(() => {});
    }
  }

  async sellAllToUsdt(): Promise<void> {
    log.warn('[OKX] sellAllToUsdt not implemented — use MEXC as primary');
    // TODO: Implement OKX emergency liquidation when OKX goes live
  }

  async testConnection(): Promise<ConnectionTest> {
    const t0 = Date.now();
    const { testOkxConnection } = await import('@/lib/exchange/okxClient');
    const result = await testOkxConnection();
    return {
      ok: result.ok,
      exchange: 'okx',
      mode: result.mode,
      latencyMs: Date.now() - t0,
      error: result.error,
    };
  }
}

// ─── Bybit Adapter ──────────────────────────────────────────

class BybitAdapter implements IExchange {
  readonly exchangeId = 'bybit';

  async getPrice(symbol: string): Promise<number> {
    const { getBybitPrice } = await import('@/lib/exchange/bybitClient');
    return getBybitPrice(symbol);
  }

  async getTicker24h(symbol: string): Promise<Ticker24h> {
    // Bybit ticker not fully implemented in existing client — basic fallback
    const price = await this.getPrice(symbol);
    return {
      symbol, lastPrice: price, volume24h: 0,
      priceChange24h: 0, priceChangePercent24h: 0, high24h: 0, low24h: 0,
    };
  }

  async getOrderbook(symbol: string, _limit = 10): Promise<OrderbookSnapshot> {
    const { getBybitOrderbook } = await import('@/lib/exchange/bybitClient');
    const raw = await getBybitOrderbook(symbol);
    const result = (raw.result as Record<string, unknown>) || raw;
    return {
      symbol,
      bids: (result.b as [string, string][] || []).map(([p, q]) => [Number(p), Number(q)]),
      asks: (result.a as [string, string][] || []).map(([p, q]) => [Number(p), Number(q)]),
      timestamp: Date.now(),
    };
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const { getBybitBalance } = await import('@/lib/exchange/bybitClient');
    const balances = await getBybitBalance();
    return balances.map(b => ({
      asset: b.coin,
      free: b.free,
      locked: b.locked,
    }));
  }

  async marketOrder(_symbol: string, _side: 'BUY' | 'SELL', _quantity: number): Promise<OrderResult> {
    // TODO: Implement when Bybit trading goes live
    throw new Error('Bybit trading not yet implemented');
  }

  async limitOrder(_symbol: string, _side: 'BUY' | 'SELL', _quantity: number, _price: number): Promise<OrderResult> {
    throw new Error('Bybit trading not yet implemented');
  }

  async cancelOrder(_symbol: string, _orderId: string): Promise<OrderResult> {
    throw new Error('Bybit trading not yet implemented');
  }

  async getOpenOrders(_symbol?: string): Promise<OrderResult[]> {
    return []; // TODO: Implement
  }

  async cancelAllOrders(_symbol: string): Promise<void> {
    // TODO: Implement
  }

  async sellAllToUsdt(): Promise<void> {
    log.warn('[Bybit] sellAllToUsdt not implemented');
  }

  async testConnection(): Promise<ConnectionTest> {
    const t0 = Date.now();
    try {
      const { getBybitServerTime } = await import('@/lib/exchange/bybitClient');
      await getBybitServerTime();
      return { ok: true, exchange: 'bybit', mode: 'connected', latencyMs: Date.now() - t0 };
    } catch (err) {
      return { ok: false, exchange: 'bybit', mode: 'error', latencyMs: Date.now() - t0, error: String(err) };
    }
  }
}

// ─── Exchange Router (singleton registry) ───────────────────

export class ExchangeRouter {
  private static adapters: Map<string, IExchange> = new Map();

  static {
    ExchangeRouter.adapters.set('mexc', new MexcAdapter());
    ExchangeRouter.adapters.set('okx', new OkxAdapter());
    ExchangeRouter.adapters.set('bybit', new BybitAdapter());
  }

  /**
   * Get exchange adapter by ID.
   * @throws if exchange not registered
   */
  static get(exchangeId: string): IExchange {
    const adapter = ExchangeRouter.adapters.get(exchangeId.toLowerCase());
    if (!adapter) {
      throw new Error(`Exchange '${exchangeId}' not registered. Available: ${[...ExchangeRouter.adapters.keys()].join(', ')}`);
    }
    return adapter;
  }

  /** Get the primary exchange (MEXC for now) */
  static getPrimary(): IExchange {
    return ExchangeRouter.get('mexc');
  }

  /** Register a custom exchange adapter */
  static register(adapter: IExchange): void {
    ExchangeRouter.adapters.set(adapter.exchangeId.toLowerCase(), adapter);
    log.info(`[Router] Registered exchange: ${adapter.exchangeId}`);
  }

  /** List all registered exchanges */
  static list(): string[] {
    return [...ExchangeRouter.adapters.keys()];
  }

  /** Test all exchange connections in parallel */
  static async testAll(): Promise<ConnectionTest[]> {
    const tests = [...ExchangeRouter.adapters.values()].map(a =>
      a.testConnection().catch(err => ({
        ok: false,
        exchange: a.exchangeId,
        mode: 'error',
        latencyMs: 0,
        error: String(err),
      }))
    );
    return Promise.all(tests);
  }
}
