// ============================================================
// GET  /api/v2/polymarket/sentinel-coupling — evaluate coupling now
// POST /api/v2/polymarket/sentinel-coupling — same; intended for cron
// Phase 2 Batch 12. Safe to call frequently (every 1-5 min).
// ============================================================
import { successResponse, errorResponse } from '@/lib/api-response';
import { evaluateSentinelCoupling, lastCouplingState } from '@/lib/polymarket/sentinelCoupling';

export const dynamic = 'force-dynamic';

async function handle() {
  try {
    const report = await evaluateSentinelCoupling();
    return successResponse({
      status: 'ok',
      report,
      lastState: lastCouplingState(),
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('SENTINEL_COUPLING_FAILED', (err as Error).message, 500);
  }
}

export async function GET() { return handle(); }
export async function POST() { return handle(); }
