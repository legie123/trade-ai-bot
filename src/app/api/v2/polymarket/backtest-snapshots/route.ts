// ============================================================
// GET  /api/v2/polymarket/backtest-snapshots — list recent snapshots
// POST /api/v2/polymarket/backtest-snapshots — capture a snapshot now
// Phase 2 Batch 8. Intended to be called hourly via cron.
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { captureSnapshot, recentSnapshots, snapshotStats } from '@/lib/polymarket/backtestSnapshots';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = parseInt(searchParams.get('limit') || '168', 10);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(168, raw)) : 168;
    return successResponse({
      status: 'ok',
      stats: snapshotStats(),
      count: recentSnapshots(limit).length,
      snapshots: recentSnapshots(limit),
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('SNAPSHOTS_FETCH_FAILED', (err as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const minEdge = parseInt(searchParams.get('minEdge') || '50', 10);
    const notional = parseInt(searchParams.get('notional') || '100', 10);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const row = await captureSnapshot({
      minEdgeScore: Number.isFinite(minEdge) ? minEdge : 50,
      notional: Number.isFinite(notional) ? notional : 100,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return successResponse({
      status: row ? 'captured' : 'skipped',
      row,
      stats: snapshotStats(),
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('SNAPSHOT_CAPTURE_FAILED', (err as Error).message, 500);
  }
}
