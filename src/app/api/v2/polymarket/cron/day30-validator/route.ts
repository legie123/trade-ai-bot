// GET /api/v2/polymarket/cron/day30-validator — Phase 5 final verdict
import { NextResponse } from 'next/server';
import { runDay30Validation } from '@/lib/polymarket/paperForward/day30Validator';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolymarketCronDay30');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const result = await runDay30Validation();
    return NextResponse.json({ status: 'ok', result, timestamp: Date.now() });
  } catch (err) {
    log.error('Day-30 validator cron error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
