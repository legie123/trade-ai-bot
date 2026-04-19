/**
 * GET /api/v2/polymarket/learning/weekly
 *
 * Returns a weekly learning-loop report for Polymarket decisions: per-division
 * activity + selection lift + skip-reason histogram + factor distributions +
 * week-over-week drift + gladiator dormancy signals.
 *
 * FAZA 3.6 diagnostic endpoint. Cron-auth (report exposes raw factor
 * multipliers which are internal trade-secret detail, not public).
 *
 * Kill-switch: POLY_LEARNING_ENABLED=0 → endpoint returns enabled:false but
 * 200 OK so the audit UI can still render the "disabled" state.
 */
import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { buildWeeklyReport, getLearningConfig } from '@/lib/polymarket/learningLoop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const report = await buildWeeklyReport();
    return NextResponse.json({
      ok: true,
      config: getLearningConfig(),
      report,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
