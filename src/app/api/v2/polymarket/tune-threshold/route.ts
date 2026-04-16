// ============================================================
// GET  /api/v2/polymarket/tune-threshold  — last recommendation
// POST /api/v2/polymarket/tune-threshold  — run sweep now
// Phase 2 Batch 9. Advisory only — does NOT mutate scanner config.
// Query params (POST):
//   ?band=40,50,55,60,65,70,75,80   comma-separated edge levels
//   ?notional=100
//   ?limit=150
//   ?minSample=5
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { tuneThreshold, lastTuneResult } from '@/lib/polymarket/thresholdTuner';

export const dynamic = 'force-dynamic';

function num(s: string | null, fallback: number): number {
  if (s == null) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET() {
  try {
    return successResponse({
      status: 'ok',
      last: lastTuneResult(),
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('TUNE_FETCH_FAILED', (err as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bandRaw = searchParams.get('band');
    const band = bandRaw
      ? bandRaw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n >= 0 && n <= 100)
      : undefined;
    const notional = Math.max(1, num(searchParams.get('notional'), 100));
    const limit = Math.max(1, Math.min(500, num(searchParams.get('limit'), 150)));
    const minSample = Math.max(1, num(searchParams.get('minSample'), 5));

    const result = await tuneThreshold({ band, notional, limit, minSample });
    return successResponse({
      status: 'ok',
      ...result,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('TUNE_RUN_FAILED', (err as Error).message, 500);
  }
}
