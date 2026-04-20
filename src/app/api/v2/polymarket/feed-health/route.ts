/**
 * /api/v2/polymarket/feed-health — unified upstream feed heartbeat.
 *
 * FAZA 3.4. Thin GET wrapper around getFeedHealth(). One endpoint,
 * four probes, worst-of aggregate. Scraped by:
 *   - <FeedHeartbeatStrip/>  (audit UI, 30s poll)
 *   - ops smoke tests        (is ingest dead?)
 *
 * Response shape:
 *   {
 *     generatedAt: ms,
 *     aggregateStatus: 'fresh' | 'aging' | 'stale' | 'unconfigured' | 'error',
 *     feeds: FeedSnapshot[],
 *     criticalFeeds: string[],
 *     staleFeeds: string[]
 *   }
 *
 * Cache: dynamic, no caching. 15s max-age hint for UI polling budget.
 * Never throws — any probe failure degrades to per-feed {status:'error'}.
 */
import { NextResponse } from 'next/server';
import { getFeedHealth } from '@/lib/polymarket/feedHealth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const agg = await getFeedHealth();
    return NextResponse.json(agg, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Feed-Status': agg.aggregateStatus,
      },
    });
  } catch (e) {
    // Defensive: aggregator itself should not throw, but hedge anyway.
    return NextResponse.json(
      {
        generatedAt: Date.now(),
        aggregateStatus: 'error',
        feeds: [],
        criticalFeeds: [],
        staleFeeds: [],
        error: (e as Error).message,
      },
      { status: 500 }
    );
  }
}
