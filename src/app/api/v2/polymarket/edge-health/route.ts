/**
 * GET /api/v2/polymarket/edge-health — FAZA 3.13 Edge Watchdog readout.
 *
 * Returns JSON snapshot of the realized-edge verdict (UNKNOWN/HEALTHY/
 * DEGRADED/UNHEALTHY) computed from learningLoop OVERALL SettlementStats.
 * Response headers surface the verdict + enforce flag for cheap cron probes.
 *
 * Soft-fail: errors return 200 with verdict=UNKNOWN + errorMsg populated
 * so downstream pollers never see 5xx from this endpoint.
 */
import { NextResponse } from 'next/server';
import { getEdgeWatchdogState } from '@/lib/polymarket/edgeWatchdog';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const state = await getEdgeWatchdogState();
  return NextResponse.json(state, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Edge-Verdict': state.verdict,
      'X-Edge-Enforce': state.enforce ? '1' : '0',
      'X-Edge-Enabled': state.enabled ? '1' : '0',
      'X-Edge-Shadow-Blocks': String(state.shadowBlockCount),
    },
  });
}
