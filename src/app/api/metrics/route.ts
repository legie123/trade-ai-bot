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
import { refreshPoolGauges } from '@/lib/observability/poolGauges';
import { refreshBrainStatusGauges } from '@/lib/observability/brainStatusGauges';
import { refreshDecisionBudgetGauges } from '@/lib/observability/decisionBudgetGauges';

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

  // Refresh pool-state gauges before scrape (60s TTL inside, fail-soft).
  await refreshPoolGauges();
  // FAZA 3.15 — Brain Status composite gauge (30s aggregator cache, fail-soft).
  await refreshBrainStatusGauges();
  // FAZA 3.16 — Decision Budget Gate gauges (15s classifier cache, fail-soft).
  await refreshDecisionBudgetGauges();

  const body = await registry.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': registry.contentType,
      'Cache-Control': 'no-store',
    },
  });
}
