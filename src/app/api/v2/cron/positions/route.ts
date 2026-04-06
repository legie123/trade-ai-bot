import { NextResponse } from 'next/server';
import { positionManager } from '@/lib/v2/manager/positionManager';
import { createLogger } from '@/lib/core/logger';
import { initDB, getLivePositions } from '@/lib/store/db';

const log = createLogger('Cron-PositionManager');

// Cron job triggered externally (e.g. Google Cloud Scheduler or Vercel Cron)
// Designed to run every 1 minute.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Ensure DB is loaded (important for Serverless environments like Cloud Run)
    await initDB();

    const openPositions = getLivePositions().filter(p => p.status === 'OPEN');
    log.info(`[Cron] Position Manager tick — ${openPositions.length} open positions.`);

    // Trigger position evaluation
    await positionManager.evaluateLivePositions();

    return NextResponse.json({ 
      status: 'ok', 
      openPositions: openPositions.length,
      positions: openPositions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        partialTPHit: p.partialTPHit,
        highestObserved: p.highestPriceObserved,
      })),
      timestamp: new Date().toISOString() 
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('Position Manager Cron Failed:', { error: errorMsg });
    return NextResponse.json({ status: 'error', message: errorMsg }, { status: 500 });
  }
}
