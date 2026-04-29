/**
 * GET /api/v2/polymarket/scans?limit=50
 * Lists recent cron scan runs (newest first).
 *
 * FAZA 3.4 index endpoint for drill-down UI. Cron-auth only because
 * env_snapshot may include threshold values tied to strategy.
 */
import { NextResponse } from 'next/server';
import { listRecentScans } from '@/lib/polymarket/scanHistory';
import { requireCronAuth } from '@/lib/core/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);

    const scans = await listRecentScans(limit);
    return NextResponse.json({ ok: true, count: scans.length, scans });
  } catch (err) {
    return NextResponse.json(
      { error: 'scans_list_failed', message: (err as Error).message },
      { status: 500 }
    );
  }
}
