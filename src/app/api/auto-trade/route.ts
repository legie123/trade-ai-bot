// GET /api/auto-trade — return engine running status (Informational - Phoenix V2)
// POST /api/auto-trade — test connections
import { NextResponse } from 'next/server';
import { testConnection, getBalances, getPrice } from '@/lib/exchange/binanceClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      status: 'ok',
      autoTradeEnabled: true, // Phoenix V2 is always listening
      version: 'Phoenix V2 (GTC)',
      message: 'The system runs autonomously via webhooks and crons in the Sindicat.',
      candidates: [], // Removed in V2, check Crypto Radar for active combats
      mlScores: [], // Obsolete, replaced by AlphaScout / MasterSyndicate
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.action === 'test-binance') {
      const conn = await testConnection();
      let balances: { asset: string; free: number }[] = [];
      if (conn.ok) {
        try { balances = await getBalances(); } catch { /* testnet may not have funds */ }
      }
      return NextResponse.json({ status: 'ok', connection: conn, balances });
    }

    if (body.action === 'get-price') {
      const price = await getPrice(body.symbol || 'BTCUSDT');
      return NextResponse.json({ status: 'ok', symbol: body.symbol, price });
    }

    return NextResponse.json({ status: 'error', error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
