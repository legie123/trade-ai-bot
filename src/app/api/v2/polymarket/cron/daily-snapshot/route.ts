// GET /api/v2/polymarket/cron/daily-snapshot — Phase 5 daily snapshot endpoint
import { NextResponse } from 'next/server';
import { ensureInitialized, waitForInit } from '@/lib/polymarket/polyState';
import { captureDailySnapshot } from '@/lib/polymarket/paperForward/snapshot';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolymarketCronDailySnapshot');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    ensureInitialized();
    await waitForInit();

    const result = await captureDailySnapshot();
    return NextResponse.json({ status: 'ok', result, timestamp: Date.now() });
  } catch (err) {
    log.error('Daily snapshot cron error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
