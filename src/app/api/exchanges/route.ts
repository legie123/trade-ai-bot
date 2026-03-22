// ============================================================
// Multi-Exchange API — Unified endpoint for all exchanges
// GET /api/exchanges — list exchanges + status
// POST /api/exchanges — execute on specific exchange
// Supported: Binance, Bybit, MEXC, OKX
// ============================================================
import { NextResponse } from 'next/server';

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
    const { testConnection } = await import('@/lib/exchange/binanceClient');
    const conn = await testConnection();
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

  const activeExchange = process.env.ACTIVE_EXCHANGE || 'binance';

  return NextResponse.json({
    activeExchange,
    exchanges,
    supported: ['binance', 'bybit', 'mexc', 'okx'],
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const exchange = body.exchange || process.env.ACTIVE_EXCHANGE || 'binance';
    const action = body.action;
    const symbol = body.symbol;

    // ─── OKX ───
    if (exchange === 'okx') {
      const okx = await import('@/lib/exchange/okxClient');
      if (action === 'price') {
        const price = await okx.getOkxPrice(symbol);
        return NextResponse.json({ exchange: 'okx', symbol, price });
      }
      if (action === 'balance') {
        const balances = await okx.getOkxBalance();
        return NextResponse.json({ exchange: 'okx', balances });
      }
      if (action === 'order') {
        const result = await okx.placeOkxMarketOrder(symbol, body.side?.toLowerCase(), body.qty?.toString());
        return NextResponse.json({ exchange: 'okx', order: result });
      }
    }

    // ─── MEXC ───
    if (exchange === 'mexc') {
      const mexc = await import('@/lib/exchange/mexcClient');
      if (action === 'price') {
        const price = await mexc.getMexcPrice(symbol);
        return NextResponse.json({ exchange: 'mexc', symbol, price });
      }
      if (action === 'balance') {
        const balances = await mexc.getMexcBalances();
        return NextResponse.json({ exchange: 'mexc', balances });
      }
      if (action === 'order') {
        const result = await mexc.placeMexcMarketOrder(symbol, body.side, body.qty);
        return NextResponse.json({ exchange: 'mexc', order: result });
      }
    }

    // ─── Bybit ───
    if (exchange === 'bybit') {
      const bybit = await import('@/lib/exchange/bybitClient');
      if (action === 'price') {
        const price = await bybit.getBybitPrice(symbol);
        return NextResponse.json({ exchange: 'bybit', symbol, price });
      }
      if (action === 'balance') {
        const balances = await bybit.getBybitBalance();
        return NextResponse.json({ exchange: 'bybit', balances });
      }
      if (action === 'order') {
        const result = await bybit.placeBybitOrder(symbol, body.side, body.qty, body.orderType || 'Market', body.price);
        return NextResponse.json({ exchange: 'bybit', order: result });
      }
    }

    // ─── Binance (default) ───
    const binance = await import('@/lib/exchange/binanceClient');
    if (action === 'price') {
      const price = await binance.getPrice(symbol);
      return NextResponse.json({ exchange: 'binance', symbol, price });
    }
    if (action === 'balance') {
      const balances = await binance.getBalances();
      return NextResponse.json({ exchange: 'binance', balances });
    }
    if (action === 'order') {
      const result = await binance.placeMarketOrder(symbol, body.side, body.qty);
      return NextResponse.json({ exchange: 'binance', order: result });
    }

    return NextResponse.json({ error: 'Invalid action. Use: price, balance, order' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
