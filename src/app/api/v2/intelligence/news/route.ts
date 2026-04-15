// ============================================================
// GET /api/v2/intelligence/news — deduped news from all enabled adapters
// Query params:
//   ?force=1             bypass cache
//   ?limit=50            max items
//   ?symbol=BTC          filter by extracted symbol
//   ?topic=macro         filter by topic
// ============================================================
import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { newsCollector } from '@/lib/v2/intelligence/agents/newsCollector';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === '1';
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || 50)));
    const symbol = (searchParams.get('symbol') || '').toUpperCase().trim();
    const topic = (searchParams.get('topic') || '').toLowerCase().trim();

    const all = await newsCollector.getLatest(force);
    let filtered = all;
    if (symbol) filtered = filtered.filter((n) => n.symbols.includes(symbol));
    if (topic) filtered = filtered.filter((n) => n.topics.includes(topic));
    const items = filtered.slice(0, limit);

    return successResponse({
      status: 'ok',
      count: items.length,
      totalCached: all.length,
      filters: { symbol: symbol || null, topic: topic || null, limit },
      items,
      timestamp: Date.now(),
    });
  } catch (err) {
    return errorResponse('INTEL_NEWS_FAILED', (err as Error).message, 500);
  }
}
