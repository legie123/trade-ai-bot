// ============================================================
// GET /api/v2/intelligence/feed-health — aggregated health across
// news adapters, sentiment adapter, and WS feeds.
// ============================================================
import { successResponse, errorResponse } from '@/lib/api-response';
import { getAggregateFeedHealth } from '@/lib/v2/intelligence/agents/feedHealthMonitor';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snap = getAggregateFeedHealth();
    return successResponse({ status: 'ok', ...snap });
  } catch (err) {
    return errorResponse('INTEL_FEED_HEALTH_FAILED', (err as Error).message, 500);
  }
}
