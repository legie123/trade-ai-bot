// ============================================================
// FAZA A BATCH 1 — Prometheus scrape endpoint
// GET /api/metrics
// Auth: Bearer METRICS_TOKEN (shared secret with Grafana Cloud scraper)
//
// Returns Prometheus text format 0.0.4 (prom-client default).
// Kill-switch: unset METRICS_TOKEN → endpoint returns 503 (fail-closed).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { registry } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = process.env.METRICS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'metrics_disabled', hint: 'METRICS_TOKEN not configured' },
      { status: 503 }
    );
  }

  const header = req.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided !== token) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': registry.contentType,
      'Cache-Control': 'no-store',
    },
  });
}
