// ============================================================
// Multi-Exchange API — Unified endpoint for all exchanges
// GET /api/exchanges — list exchanges + status
// POST /api/exchanges — execute on specific exchange
// Supported: Binance, Bybit, MEXC, OKX
// ============================================================
import { successResponse, errorResponse } from '@/lib/api-response';
import { isAuthenticated } from '@/lib/auth';
import { getTradingModeSummary, isLiveTradingEnabled } from '@/lib/core/tradingMode';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('ExchangesAPI');

export const dynamic = 'force-dynamic';

interface ExchangeStatus {
  name: string;
  enabled: boolean;
  mode: string;
  connected: boolean;
  error?: string;
}

export async function GET() {
  const exchanges: ExchangeStatus[] = [];

  // Binance
  try {
    const { testBinanceConnection } = await import('@/lib/exchange/binanceClient');
    const conn = await testBinanceConnection();
    exchanges.push({ name: 'binance', enabled: !!process.env.BINANCE_API_KEY, mode: conn.mode, connected: conn.ok, error: conn.error });
  } catch (err) {
    exchanges.push({ name: 'binance', enabled: !!process.env.BINANCE_API_KEY, mode: 'UNKNOWN', connected: false, error: (err as Error).message });
  }

  // Bybit
  try {
    const { testBybitConnection } = await import('@/lib/exchange/bybitClient');
    const conn = await testBybitConnection();
    exchanges.push({ name: 'bybit', enabled: !!process.env.BYBIT_API_KEY, mode: conn.mode, connected: conn.ok, error: conn.error });
  } catch (err) {
    exchanges.push({ name: 'bybit', enabled: !!process.env.BYBIT_API_KEY, mode: 'UNKNOWN', connected: false, error: (err as Error).message });
  }

  // MEXC
  try {
    const { testMexcConnection } = await import('@/lib/exchange/mexcClient');
    const conn = await testMexcConnection();
    exchanges.push({ name: 'mexc', enabled: !!process.env.MEXC_API_KEY, mode: conn.mode, connected: conn.ok, error: conn.error });
  } catch (err) {
    exchanges.push({ name: 'mexc', enabled: !!process.env.MEXC_API_KEY, mode: 'UNKNOWN', connected: false, error: (err as Error).message });
  }

  // OKX
  try {
    const { testOkxConnection } = await import('@/lib/exchange/okxClient');
    const conn = await testOkxConnection();
    exchanges.push({ name: 'okx', enabled: !!process.env.OKX_API_KEY, mode: conn.mode, connected: conn.ok, error: conn.error });
  } catch (err) {
    exchanges.push({ name: 'okx', enabled: !!process.env.OKX_API_KEY, mode: 'UNKNOWN', connected: false, error: (err as Error).message });
  }

  const activeExchange = process.env.ACTIVE_EXCHANGE || 'mexc';

  return successResponse({
    activeExchange,
    exchanges,
    supported: ['binance', 'bybit', 'mexc', 'okx'],
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  try {
    // ─── AUTH GATE ───
    if (!isAuthenticated(request)) {
      return errorResponse('UNAUTHENTICATED', 'Authentication required', 401);
    }

    const body = await request.json();
    const exchange = body.exchange || process.env.ACTIVE_EXCHANGE || 'mexc';
    const action = body.action;
    const symbol = body.symbol;

    // ─── TRADING MODE GATE (order action only) ───
    if (action === 'order' && !isLiveTradingEnabled()) {
      const summary = getTradingModeSummary();
      log.warn('[ExchangesAPI] Live order refused: TRADING_MODE=PAPER', { exchange, symbol, side: body.side });
      return errorResponse(
        'LIVE_TRADING_DISABLED',
        `Live orders blocked — TRADING_MODE=${summary.mode}. Paper mode enforced. To enable live: set TRADING_MODE=LIVE and LIVE_TRADING_CONFIRM=YES_I_UNDERSTAND_RISK.`,
        403
      );
    }

    // ─── Binance ───
    if (exchange === 'binance') {
      const binance = await import('@/lib/exchange/binanceClient');
      if (action === 'price') {
        const price = await binance.getBinancePrice(symbol);
        return successResponse({ exchange: 'binance', symbol, price });
      }
      if (action === 'balance') {
        const balances = await binance.getBinanceBalances();
        return successResponse({ exchange: 'binance', balances });
      }
      if (action === 'order') {
        const result = await binance.placeBinanceMarketOrder(symbol, body.side, body.qty);
        return successResponse({ exchange: 'binance', order: result });
      }
    }

    // ─── OKX ───
    if (exchange === 'okx') {
      const okx = await import('@/lib/exchange/okxClient');
      if (action === 'price') {
        const price = await okx.getOkxPrice(symbol);
        return successResponse({ exchange: 'okx', symbol, price });
      }
      if (action === 'balance') {
        const balances = await okx.getOkxBalance();
        return successResponse({ exchange: 'okx', balances });
      }
      if (action === 'order') {
        const result = await okx.placeOkxMarketOrder(symbol, body.side?.toLowerCase(), body.qty?.toString());
        return successResponse({ exchange: 'okx', order: result });
      }
    }

    // ─── MEXC ───
    if (exchange === 'mexc') {
      const mexc = await import('@/lib/exchange/mexcClient');
      if (action === 'price') {
        const price = await mexc.getMexcPrice(symbol);
        return successResponse({ exchange: 'mexc', symbol, price });
      }
      if (action === 'balance') {
        const balances = await mexc.getMexcBalances();
        return successResponse({ exchange: 'mexc', balances });
      }
      if (action === 'order') {
        const result = await mexc.placeMexcMarketOrder(symbol, body.side, body.qty);
        return successResponse({ exchange: 'mexc', order: result });
      }
    }

    // ─── Bybit ───
    if (exchange === 'bybit') {
      const bybit = await import('@/lib/exchange/bybitClient');
      if (action === 'price') {
        const price = await bybit.getBybitPrice(symbol);
        return successResponse({ exchange: 'bybit', symbol, price });
      }
      if (action === 'balance') {
        const balances = await bybit.getBybitBalance();
        return successResponse({ exchange: 'bybit', balances });
      }
      if (action === 'order') {
        const result = await bybit.placeBybitOrder(symbol, body.side, body.qty, body.orderType || 'Market', body.price);
        return successResponse({ exchange: 'bybit', order: result });
      }
    }

    return errorResponse('INVALID_ACTION', `Invalid exchange "${exchange}" or action "${action}". Supported exchanges: mexc, binance, okx, bybit. Actions: price, balance, order`, 400);
  } catch (err) {
    return errorResponse('EXCHANGE_ERROR', (err as Error).message, 500);
  }
}
