/**
 * GET /api/v2/polymarket/settlement-health
 *
 * Observability probe for the FAZA 3.7 settlement loop. Returns 7d + 30d
 * settlement windows with coverage, pending age, horizon distribution,
 * and a health classifier (idle | green | yellow | red | unknown).
 *
 * Cron-auth gated: exposes counts that could reveal strategy activity.
 * Pure read-side. Soft-fails to status='unknown' on DB outage.
 */
import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { probeSettlementHealth } from '@/lib/polymarket/settlementHealth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const health = await probeSettlementHealth();
    return NextResponse.json({ ok: true, ...health });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
