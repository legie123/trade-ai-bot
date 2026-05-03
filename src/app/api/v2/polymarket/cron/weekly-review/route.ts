// GET /api/v2/polymarket/cron/weekly-review — Phase 5 weekly aggregate report
import { NextResponse } from 'next/server';
import { generateWeeklyReview } from '@/lib/polymarket/paperForward/weeklyReview';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolymarketCronWeeklyReview');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const result = await generateWeeklyReview();
    return NextResponse.json({ status: 'ok', result, timestamp: Date.now() });
  } catch (err) {
    log.error('Weekly review cron error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
