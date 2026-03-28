import { NextResponse } from 'next/server';
import { runCloudBacktest } from '@/lib/engine/cloudBacktester';
import { getStrategies } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('API-BacktestRule');

export const dynamic = 'force-dynamic';
// For Vercel Hobby max execution time (if we use Edge runtime we get more, but let's stick to Node.js for now)
export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { strategyId, symbol = 'SOLUSDT', days = 30 } = body;

    if (!strategyId) {
      return NextResponse.json({ success: false, error: 'Missing strategyId' }, { status: 400 });
    }

    const strategies = getStrategies();
    const strategy = strategies.find(s => s.id === strategyId);

    if (!strategy) {
      return NextResponse.json({ success: false, error: 'Strategy not found in database' }, { status: 404 });
    }

    // Run the massive backtest simulation
    const report = await runCloudBacktest(strategy, symbol, days);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      report
    });

  } catch (err) {
    log.error('Backtest rule execution failed', { error: String(err) });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
