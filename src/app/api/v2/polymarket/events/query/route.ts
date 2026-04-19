/**
 * GET /api/v2/polymarket/events/query — paginated query over polymarket_events.
 *
 * Filters (all optional): pipeline, conditionId, entityType, sinceIso, beforeId, limit.
 * Auth: CRON_SECRET (x-cron-secret or Authorization: Bearer). Events can contain
 * market/actor data that shouldn't be public; gated same as cron endpoints.
 *
 * Cursor pagination: response.nextCursor = beforeId for the next page.
 */
import { NextResponse } from 'next/server';
import { queryEvents } from '@/lib/polymarket/eventsStore';
import { requireCronAuth } from '@/lib/core/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const pipeline = url.searchParams.get('pipeline') || undefined;
  const conditionId = url.searchParams.get('conditionId') || undefined;
  const entityType = url.searchParams.get('entityType') || undefined;
  const sinceIso = url.searchParams.get('sinceIso') || undefined;
  const beforeIdRaw = url.searchParams.get('beforeId');
  const beforeId = beforeIdRaw ? Number.parseInt(beforeIdRaw, 10) : undefined;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const result = await queryEvents({ pipeline, conditionId, entityType, sinceIso, beforeId, limit });
  if (result.error) {
    return NextResponse.json({ ok: false, reason: result.error, events: [], nextCursor: null }, { status: 200 });
  }
  return NextResponse.json({
    ok: true,
    count: result.events.length,
    events: result.events,
    nextCursor: result.nextCursor,
  });
}
