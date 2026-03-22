// GET /api/auto-trade — scan for executable trades + ML scores
// POST /api/auto-trade — toggle auto-trading, execute manual
import { NextResponse } from 'next/server';
import { scanForAutoTrades, getAutoTradeConfig } from '@/lib/engine/autoTrader';
import { scoreRecentSignals } from '@/lib/engine/mlFilter';
import { testConnection, getBalances, getPrice } from '@/lib/exchange/binanceClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = getAutoTradeConfig();
    const trades = await scanForAutoTrades();
    const mlScores = scoreRecentSignals(5);

    return NextResponse.json({
      status: 'ok',
      autoTradeEnabled: config.enabled,
      config,
      candidates: trades.map((t) => ({
        symbol: t.decision.symbol,
        signal: t.decision.signal,
        confidence: t.decision.confidence,
        shouldExecute: t.shouldExecute,
        reason: t.reason,
        risk: t.risk,
        confluence: {
          confirmedTFs: t.confluence.confirmedTFs,
          confluenceScore: t.confluence.confluenceScore,
        },
      })),
      mlScores: mlScores.map((s) => ({
        symbol: s.symbol,
        signal: s.signal,
        score: s.score,
        verdict: s.verdict,
        reasons: s.reasons,
      })),
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
