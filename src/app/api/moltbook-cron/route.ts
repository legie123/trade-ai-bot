import { NextResponse } from 'next/server';
import { runMoltbookDailySweep } from '@/lib/moltbook/discoveryFeed';
import { createLogger } from '@/lib/core/logger';
import { getWatchdogState } from '@/lib/core/watchdog';
import { extractWinningBehaviors } from '@/lib/v2/forge/dnaExtractor';

const log = createLogger('MoltbookCron');

export async function GET(request: Request) {
  // Security Authentication for Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    request.headers.get('x-cron-secret') !== process.env.CRON_SECRET
  ) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const watchdog = getWatchdogState();
  if (watchdog.status !== 'HEALTHY' && watchdog.status !== 'WARNING') {
    log.error('Watchdog reports degraded state. Halting cron sweep to preserve resources.');
    return NextResponse.json({ success: false, error: 'System not healthy.' }, { status: 503 });
  }

  log.info('Triggering Moltbook Cron: Data Extraction & Network Sweep...');

  try {
    let forgeStats;
    try {
      forgeStats = extractWinningBehaviors();
      log.info(`Forge Progress: ${forgeStats.progressPercent}% (${forgeStats.totalWinsAssimilated} wins assimilated)`);
    } catch (err) {
      log.warn('Unable to extract forge stats, continuing without them', { error: String(err) });
      forgeStats = undefined;
    }

    const sweepResult = await runMoltbookDailySweep(forgeStats);
    
    return NextResponse.json({
        success: true,
        forge: forgeStats || { message: 'Forge stats unavailable' },
        data: sweepResult
    });
  } catch (err: unknown) {
    log.error('Moltbook Cron failed', { error: (err as Error).message });
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
