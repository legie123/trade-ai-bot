/**
 * GET /api/v2/polymarket/scans/[runId]
 * Returns a single scan run + all decisions correlated during that run.
 *
 * FAZA 3.4 drill-down endpoint for the UI "Scan Inspector" (FAZA 3.5).
 * Cron-auth only — runs contain env snapshot + raw opportunities.
 */
import { NextResponse } from 'next/server';
import { getScanRun } from '@/lib/polymarket/scanHistory';
import { requireCronAuth } from '@/lib/core/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ runId: string }> },
) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const { runId } = await ctx.params;
  if (!runId) {
    return NextResponse.json({ ok: false, error: 'missing runId' }, { status: 400 });
  }

  const result = await getScanRun(runId);
  if (!result) {
    return NextResponse.json({ ok: false, error: 'not_found_or_unconfigured', runId }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    runId,
    run: result.run,
    decisions: result.decisions,
    decisionCount: result.decisions.length,
  });
}
