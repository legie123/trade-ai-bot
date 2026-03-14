// GET /api/executor — execution log and pipeline status
// POST /api/executor — trigger execution pipeline
import { NextResponse } from 'next/server';
import { runExecutionPipeline, getExecutionLog } from '@/lib/engine/executor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const log = getExecutionLog();
    const recent = log.slice(-20);
    const executed = log.filter(r => r.executed);
    const errors = log.filter(r => r.error);

    return NextResponse.json({
      status: 'ok',
      autoTradeEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
      totalExecuted: executed.length,
      totalErrors: errors.length,
      recentOrders: recent.map(r => ({
        symbol: r.symbol,
        side: r.side,
        price: r.price,
        quantity: r.quantity,
        value: r.orderValue,
        mlScore: r.mlScore,
        executed: r.executed,
        reason: r.reason,
        telegramSent: r.telegramSent,
      })),
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const balance = body.balance || 1000;

    const result = await runExecutionPipeline(balance);

    return NextResponse.json({
      status: 'ok',
      ...result,
      summary: `Executed: ${result.totalExecuted} | Skipped: ${result.totalSkipped} | Errors: ${result.errors.length}`,
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
