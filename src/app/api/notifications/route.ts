// ============================================================
// Push Notifications — Desktop alerts for high-confidence signals
// Uses the browser Notification API (no external service needed)
// Exposed via API endpoint for server-side triggering
// ============================================================
import { NextResponse } from 'next/server';
import { getDecisions } from '@/lib/store/db';

export const dynamic = 'force-dynamic';

// GET /api/notifications — get pending high-confidence signals for notification
export async function GET() {
  try {
    const decisions = getDecisions();
    const recent = decisions.filter((d) => {
      const age = Date.now() - new Date(d.timestamp).getTime();
      return age < 5 * 60_000 && d.confidence >= 85; // last 5 min, >85% confidence
    });

    return NextResponse.json({
      status: 'ok',
      alerts: recent.map((d) => ({
        id: d.id,
        symbol: d.symbol,
        signal: d.signal,
        direction: d.direction,
        confidence: d.confidence,
        price: d.price,
        timestamp: d.timestamp,
        source: d.source,
      })),
      count: recent.length,
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
