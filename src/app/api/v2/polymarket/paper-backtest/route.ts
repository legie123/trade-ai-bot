// ============================================================
// GET /api/v2/polymarket/paper-backtest
// Phase 2 Batch 7 — read-only backtest over paper signal ring buffer.
// Query params:
//   ?limit=N       1..200 signals (default 50)
//   ?notional=N    USD per signal (default 100)
//   ?fee=0.006     round-trip fee fraction (default 0.006)
//   ?minEdge=50    min edge score filter (default 50)
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { runPaperBacktest } from '@/lib/polymarket/paperBacktest';

export const dynamic = 'force-dynamic';

function num(s: string | null, fallback: number): number {
  if (s == null) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(200, num(searchParams.get('limit'), 50)));
    const notional = Math.max(1, num(searchParams.get('notional'), 100));
    const fee = Math.max(0, Math.min(0.1, num(searchParams.get('fee'), 0.006)));
    const minEdge = Math.max(0, Math.min(100, num(searchParams.get('minEdge'), 50)));

    const summary = await runPaperBacktest({
      limit,
      notionalPerSignal: notional,
      feePctRoundTrip: fee,
      minEdgeScore: minEdge,
    });

    return successResponse({
      status: 'ok',
      ...summary,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('PAPER_BACKTEST_FAILED', (err as Error).message, 500);
  }
}
