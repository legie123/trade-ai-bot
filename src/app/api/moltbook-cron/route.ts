import { NextResponse } from 'next/server';
import { runMoltbookDailySweep } from '@/lib/moltbook/discoveryFeed';
import { createLogger } from '@/lib/core/logger';

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

  log.info('Triggering manual / cron run for Moltbook Autonomous Agent...');

  try {
    const sweepResult = await runMoltbookDailySweep();
    return NextResponse.json({
        success: true,
        data: sweepResult
    });
  } catch (err: any) {
    log.error('Moltbook Cron failed', { error: err.message });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
