// ============================================================
// GET /api/v2/polymarket/paper-signals
// Phase 2 Batch 6 — observability endpoint for paper signal feeder.
// Query params:
//   ?limit=N   max signals to return (1..200, default 50)
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { recentPaperSignals, paperFeederStatus } from '@/lib/polymarket/paperSignalFeeder';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;

    const status = paperFeederStatus();
    const signals = recentPaperSignals(limit);

    return successResponse({
      status: 'ok',
      feeder: status,
      count: signals.length,
      signals,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('PAPER_SIGNALS_FAILED', (err as Error).message, 500);
  }
}
