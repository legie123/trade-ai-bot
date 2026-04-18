import { NextResponse } from 'next/server';
import { positionManager } from '@/lib/v2/manager/positionManager';
import { createLogger } from '@/lib/core/logger';
import { initDB, getLivePositions } from '@/lib/store/db';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { isKillSwitchEngaged } from '@/lib/core/killSwitch';

const log = createLogger('Cron-PositionManager');

// Cron job triggered externally (e.g. Google Cloud Scheduler or Vercel Cron)
// Designed to run every 1 minute.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    // Ensure DB is loaded (important for Serverless environments like Cloud Run)
    await initDB();

    // FIX: Check kill switch before evaluating — prevents redundant orders during liquidation
    if (isKillSwitchEngaged()) {
      log.warn('[Cron] Kill switch engaged — skipping position evaluation');
      return NextResponse.json({ status: 'skipped', reason: 'kill_switch_engaged', timestamp: new Date().toISOString() });
    }

    const openPositions = getLivePositions().filter(p => p.status === 'OPEN');
    log.info(`[Cron] Position Manager tick — ${openPositions.length} open positions.`);

    // FIX: Add 45s timeout to prevent cron cascade when MEXC is slow
    const evalPromise = positionManager.evaluateLivePositions();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Position evaluation timed out after 45s')), 45_000)
    );

    await Promise.race([evalPromise, timeoutPromise]);

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
