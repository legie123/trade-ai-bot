// ============================================================
// GET /api/v2/intelligence/sentiment — scored + aggregated sentiment
// Query params:
//   ?force=1            bypass cache
//   ?symbol=BTC         return single-symbol sentiment
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { sentimentAgent } from '@/lib/v2/intelligence/agents/sentimentAgent';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === '1';
    const symbol = (searchParams.get('symbol') || '').toUpperCase().trim();

    const snap = await sentimentAgent.getSnapshot(force);

    if (symbol) {
      const symSent = sentimentAgent.getSymbolScore(symbol);
      return successResponse({
        status: 'ok',
        symbol,
        sentiment: symSent,
        overall: snap.overall,
        generatedAt: snap.generatedAt,
        adapter: snap.adapter,
        timestamp: Date.now(),
      });
    }

    return successResponse({
      status: 'ok',
      adapter: snap.adapter,
      overall: snap.overall,
      totalItems: snap.totalItems,
      bySymbol: snap.bySymbol.slice(0, 50),
      generatedAt: snap.generatedAt,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('INTEL_SENTIMENT_FAILED', (err as Error).message, 500);
  }
}
