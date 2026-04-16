// ============================================================
// GET   /api/v2/polymarket/ranker-config — active runtime floors
// POST  /api/v2/polymarket/ranker-config — manual promote
//        body: { global?: number, perDivision?: { DIV: number, ... } }
//        Gated by POLY_EDGE_AUTOPROMOTE=true.
// Phase 2 Batch 11.
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import {
  getActiveConfigSync,
  refreshActiveConfig,
  promoteFloor,
} from '@/lib/polymarket/rankerConfig';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const fresh = (await refreshActiveConfig()) || getActiveConfigSync();
    return successResponse({
      status: 'ok',
      active: fresh,
      autopromoteEnabled: (process.env.POLY_EDGE_AUTOPROMOTE || '').toLowerCase() === 'true',
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('RANKER_CFG_FETCH_FAILED', (err as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      global?: number;
      perDivision?: Record<string, number>;
      source?: string;
    };
    // Validate values
    const validateFloor = (n: unknown): n is number =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
    if (body.global !== undefined && !validateFloor(body.global)) {
      return errorResponse('INVALID_GLOBAL', 'global must be 0..100', 400);
    }
    const perDiv: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.perDivision || {})) {
      if (!validateFloor(v)) {
        return errorResponse('INVALID_PER_DIV', `${k} must be 0..100`, 400);
      }
      perDiv[k.toUpperCase()] = v;
    }

    const updated = await promoteFloor({
      global: body.global,
      perDivision: perDiv,
      source: body.source || 'manual',
    });
    if (!updated) {
      return successResponse({
        status: 'skipped',
        reason: 'POLY_EDGE_AUTOPROMOTE not enabled',
        timestamp: Date.now(),
      });
    }
    return successResponse({
      status: 'promoted',
      active: updated,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('RANKER_CFG_PROMOTE_FAILED', (err as Error).message, 500);
  }
}
