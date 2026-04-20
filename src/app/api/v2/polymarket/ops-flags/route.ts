/**
 * GET /api/v2/polymarket/ops-flags — JSON snapshot of every kill-switch.
 *
 * FAZA 3.9. Thin wrapper over getOpsFlagsSnapshot(). Cache-disabled so
 * operator always sees live env. Response header X-Ops-Flags-Off for
 * cheap Prom scraping / alerting on unexpected off-count spikes.
 */
import { NextResponse } from 'next/server';
import { getOpsFlagsSnapshot } from '@/lib/polymarket/opsFlags';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const snap = getOpsFlagsSnapshot();
    return NextResponse.json(snap, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Ops-Flags-Off': String(snap.offCount),
        'X-Ops-Flags-Overridden': String(snap.overriddenCount),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        generatedAt: Date.now(),
        error: err instanceof Error ? err.message : 'unknown',
        totalFlags: 0,
        overriddenCount: 0,
        offCount: 0,
        byDomain: {},
        all: [],
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
