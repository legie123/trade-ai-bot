// ============================================================
// Exchange API Integration — Paper Trading + Live Ready
// Supports Binance and Bybit APIs
// Currently: simulation mode with real API structure
// ============================================================

export type ExchangeType = 'binance' | 'bybit' | 'simulation';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';
export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export interface ExchangeConfig {
  exchange: ExchangeType;
  apiKey: string;
  apiSecret: string;
  testnet: boolean;   // use testnet/paper trading endpoint
  baseUrl?: string;
}

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;      // for LIMIT orders
  stopPrice?: number;  // for STOP orders
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

export interface OrderResult {
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price: number;
  quantity: number;
  filledAt: string;
  exchange: ExchangeType;
}

export interface Position {
  symbol: string;
  side: OrderSide;
  entryPrice: number;
  quantity: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  openedAt: string;
}

// ─── Paper Trading Store (in-memory, persistent via globalThis) ──
const g = globalThis as unknown as {
  __paperOrders?: OrderResult[];
  __paperPositions?: Position[];
  __paperBalance?: number;
};
if (!g.__paperOrders) g.__paperOrders = [];
if (!g.__paperPositions) g.__paperPositions = [];
if (g.__paperBalance === undefined) g.__paperBalance = 1000;

// ─── Exchange Client ───────────────────────────────
export class ExchangeClient {
  private config: ExchangeConfig;

  constructor(config: Partial<ExchangeConfig> = {}) {
    this.config = {
      exchange: config.exchange || 'simulation',
      apiKey: config.apiKey || '',
      apiSecret: config.apiSecret || '',
      testnet: config.testnet ?? true,
      baseUrl: config.baseUrl,
    };
  }

  // ─── Place Order ─────────────────────────────────
  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    switch (this.config.exchange) {
      case 'binance':
        return this.placeBinanceOrder(req);
      case 'bybit':
        return this.placeBybitOrder(req);
      default:
        return this.placeSimulatedOrder(req);
    }
  }

  // ─── Get Balance ─────────────────────────────────
  async getBalance(): Promise<{ total: number; available: number; inPositions: number }> {
    if (this.config.exchange === 'simulation') {
      const positionValue = (g.__paperPositions || []).reduce(
        (s, p) => s + p.quantity * p.currentPrice, 0
      );
      return {
        total: (g.__paperBalance || 1000) + positionValue,
        available: g.__paperBalance || 1000,
        inPositions: positionValue,
      };
    }

    // Binance/Bybit: would call API here
    return { total: 0, available: 0, inPositions: 0 };
  }

  // ─── Get Positions ───────────────────────────────
  async getPositions(): Promise<Position[]> {
    return g.__paperPositions || [];
  }

  // ─── Get Orders ──────────────────────────────────
  async getOrders(): Promise<OrderResult[]> {
    return g.__paperOrders || [];
  }

  // ─── Simulated Order ─────────────────────────────
  private async placeSimulatedOrder(req: OrderRequest): Promise<OrderResult> {
    const price = req.price || 0;
    const cost = price * req.quantity;

    // Check balance
    if (req.side === 'BUY' && cost > (g.__paperBalance || 0)) {
      return {
        orderId: `sim_${Date.now()}`,
        symbol: req.symbol,
        side: req.side,
        type: req.type,
        status: 'REJECTED',
        price,
        quantity: req.quantity,
        filledAt: new Date().toISOString(),
        exchange: 'simulation',
      };
    }

    // Execute
    if (req.side === 'BUY') {
      g.__paperBalance = (g.__paperBalance || 1000) - cost;
      g.__paperPositions!.push({
        symbol: req.symbol,
        side: 'BUY',
        entryPrice: price,
        quantity: req.quantity,
        currentPrice: price,
        pnl: 0,
        pnlPercent: 0,
        openedAt: new Date().toISOString(),
      });
    } else {
      // Close position
      const posIdx = g.__paperPositions!.findIndex((p) => p.symbol === req.symbol);
      if (posIdx >= 0) {
        const pos = g.__paperPositions![posIdx];
        const pnl = (price - pos.entryPrice) * pos.quantity;
        g.__paperBalance = (g.__paperBalance || 1000) + price * pos.quantity;
        g.__paperPositions!.splice(posIdx, 1);
        console.log(`[Exchange] Closed ${req.symbol}: PnL $${pnl.toFixed(2)}`);
      }
    }

    const order: OrderResult = {
      orderId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      status: 'FILLED',
      price,
      quantity: req.quantity,
      filledAt: new Date().toISOString(),
      exchange: 'simulation',
    };

    g.__paperOrders!.unshift(order);
    if (g.__paperOrders!.length > 100) g.__paperOrders!.length = 100;

    console.log(`[Exchange] ${req.side} ${req.quantity} ${req.symbol} @ $${price} | Balance: $${g.__paperBalance?.toFixed(2)}`);
    return order;
  }

  // ─── Binance (structure ready, API calls commented) ──
  private async placeBinanceOrder(req: OrderRequest): Promise<OrderResult> {
    const baseUrl = this.config.testnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';

    console.log(`[Binance${this.config.testnet ? ' Testnet' : ''}] Would ${req.side} ${req.quantity} ${req.symbol}`);
    console.log(`  URL: ${baseUrl}/fapi/v1/order`);

    // In live mode, this would:
    // 1. Create HMAC signature with apiSecret
    // 2. POST to /fapi/v1/order with signed params
    // 3. Parse response

    // For now, simulate:
    return this.placeSimulatedOrder(req);
  }

  // ─── Bybit (structure ready) ─────────────────────
  private async placeBybitOrder(req: OrderRequest): Promise<OrderResult> {
    const baseUrl = this.config.testnet
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';

    console.log(`[Bybit${this.config.testnet ? ' Testnet' : ''}] Would ${req.side} ${req.quantity} ${req.symbol}`);
    console.log(`  URL: ${baseUrl}/v5/order/create`);

    return this.placeSimulatedOrder(req);
  }

  // ─── Get exchange info ───────────────────────────
  getInfo() {
    return {
      exchange: this.config.exchange,
      testnet: this.config.testnet,
      hasApiKey: !!this.config.apiKey,
      balance: g.__paperBalance,
      openPositions: g.__paperPositions?.length || 0,
      totalOrders: g.__paperOrders?.length || 0,
    };
  }
}

// ─── Singleton client ──────────────────────────────
let _client: ExchangeClient | null = null;
export function getExchangeClient(config?: Partial<ExchangeConfig>): ExchangeClient {
  if (!_client || config) {
    _client = new ExchangeClient(config);
  }
  return _client;
}
