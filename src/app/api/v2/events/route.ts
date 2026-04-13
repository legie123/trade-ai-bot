// ============================================================
// Events API — Recent system events for dashboard + monitoring
// ============================================================
import { NextResponse } from 'next/server';
import { getRecentEvents } from '@/lib/v2/alerts/eventHub';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
  const category = searchParams.get('category') || null;
  const severity = searchParams.get('severity') || null;

  let events = getRecentEvents(100);

  // Filter by category
  if (category) {
    events = events.filter(e => e.category === category.toUpperCase());
  }

  // Filter by severity
  if (severity) {
    events = events.filter(e => e.severity === severity.toUpperCase());
  }

  return NextResponse.json({
    events: events.slice(0, limit),
    total: events.length,
    timestamp: new Date().toISOString(),
  });
}
