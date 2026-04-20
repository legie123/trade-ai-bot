/**
 * GET /api/v2/polymarket/brain-status — FAZA 3.14 Brain Status aggregator.
 *
 * Single-verdict readout composed from edgeWatchdog + settlementHealth +
 * feedHealth + opsFlags. Response headers surface the verdict for cheap
 * cron/Grafana probes.
 *
 * Soft-fail: each sub-probe is independently try/caught — endpoint never
 * returns 5xx. Aggregator verdict will collapse to UNKNOWN if all probes
 * fail.
 */
import { NextResponse } from 'next/server';
import { getBrainStatus } from '@/lib/polymarket/brainStatus';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const status = await getBrainStatus();
  return NextResponse.json(status, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Brain-Verdict': status.verdict,
      'X-Brain-Enabled': status.enabled ? '1' : '0',
      'X-Brain-Signals': status.signals.map((s) => `${s.source}=${s.verdict}`).join(','),
    },
  });
}
