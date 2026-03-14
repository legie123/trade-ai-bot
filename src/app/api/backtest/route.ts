// GET /api/backtest — run backtest with query params
// POST /api/backtest — run backtest with custom config
import { NextResponse } from 'next/server';
import { runBacktest } from '@/lib/engine/backtester';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const config = {
      startBalance: Number(url.searchParams.get('balance')) || 1000,
      riskPerTrade: Number(url.searchParams.get('risk')) || 2,
      stopLossPercent: Number(url.searchParams.get('sl')) || 1.5,
      takeProfitPercent: Number(url.searchParams.get('tp')) || 3.0,
      minConfidence: Number(url.searchParams.get('minConf')) || 70,
    };

    const result = runBacktest(config);
    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = runBacktest(body.config || {});
    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
