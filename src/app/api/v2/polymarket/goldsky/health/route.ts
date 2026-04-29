/**
 * GET /api/v2/polymarket/goldsky/health — Goldsky pipeline freshness probe.
 *
 * Public (no auth) — used by dashboard health widget. Response contains only
 * aggregate counts and last timestamps, no raw payload.
 *
 * Returns:
 *   ok, configured, writeEnabled, lastEventAt, lagSeconds,
 *   eventsLast5min, eventsLast1h, eventsLast24h, perPipeline[]
 *
 * Degradation: if Supabase is unreachable, ok=false + error message, HTTP 200
 * (so dashboard shows a yellow-not-red status).
 */
import { NextResponse } from 'next/server';
import { getEventsHealth } from '@/lib/polymarket/eventsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const health = await getEventsHealth();
    return NextResponse.json({
      ...health,
      service: 'polymarket-goldsky',
      ingestEnabled: process.env.POLYMARKET_INGEST_ENABLED !== '0',
      authConfigured: !!process.env.POLYMARKET_WEBHOOK_SECRET,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'goldsky_health_failed', message: (err as Error).message },
      { status: 500 }
    );
  }
}
