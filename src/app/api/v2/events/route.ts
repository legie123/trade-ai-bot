/**
 * GET /api/v2/events
 * Returns recent system events from EventHub in-memory log.
 * Query params: ?category=KILL_SWITCH&severity=CRITICAL&limit=50
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { getRecentEvents, type EventCategory, type EventSeverity } from '@/lib/v2/alerts/eventHub';

export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') as EventCategory | null;
  const severity = searchParams.get('severity') as EventSeverity | null;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  let events = getRecentEvents(100);

  if (category) {
    events = events.filter(e => e.category === category);
  }
  if (severity) {
    events = events.filter(e => e.severity === severity);
  }

  events = events.slice(0, limit);

  return NextResponse.json({
    success: true,
    status: 'ok',
    count: events.length,
    events,
    timestamp: new Date().toISOString(),
  });
}
