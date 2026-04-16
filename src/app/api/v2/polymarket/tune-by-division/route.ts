// ============================================================
// GET  /api/v2/polymarket/tune-by-division — last per-div recommendation
// POST /api/v2/polymarket/tune-by-division — run per-division sweep now
// Phase 2 Batch 10. Advisory only.
// Query params (POST): ?band=40,50,60,70 ?notional=100 ?limit=200 ?minSample=3
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { tuneThresholdByDivision, lastDivisionTuneResult } from '@/lib/polymarket/thresholdTuner';

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
      last: lastDivisionTuneResult(),
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('TUNE_DIV_FETCH_FAILED', (err as Error).message, 500);
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
    const limit = Math.max(1, Math.min(500, num(searchParams.get('limit'), 200)));
    const minSample = Math.max(1, num(searchParams.get('minSample'), 3));

    const result = await tuneThresholdByDivision({ band, notional, limit, minSample });
    return successResponse({
      status: 'ok',
      ...result,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('TUNE_DIV_RUN_FAILED', (err as Error).message, 500);
  }
}
