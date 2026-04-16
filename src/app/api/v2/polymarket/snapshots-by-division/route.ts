// ============================================================
// GET  /api/v2/polymarket/snapshots-by-division — list
// POST /api/v2/polymarket/snapshots-by-division — capture now
// Phase 2 Batch 12.
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { captureDivisionSnapshot, recentDivisionSnapshots } from '@/lib/polymarket/backtestSnapshots';

export const dynamic = 'force-dynamic';

function num(s: string | null, fallback: number): number {
  if (s == null) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(2000, num(searchParams.get('limit'), 500)));
    const rows = recentDivisionSnapshots(limit);
    return successResponse({
      status: 'ok',
      count: rows.length,
      rows,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('DIV_SNAPSHOT_FETCH_FAILED', (err as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const minEdge = Math.max(0, Math.min(100, num(searchParams.get('minEdge'), 50)));
    const notional = Math.max(1, num(searchParams.get('notional'), 100));
    const limit = Math.max(1, Math.min(500, num(searchParams.get('limit'), 150)));
    const rows = await captureDivisionSnapshot({ minEdgeScore: minEdge, notional, limit });
    return successResponse({
      status: rows.length ? 'captured' : 'skipped',
      count: rows.length,
      rows,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('DIV_SNAPSHOT_CAPTURE_FAILED', (err as Error).message, 500);
  }
}
