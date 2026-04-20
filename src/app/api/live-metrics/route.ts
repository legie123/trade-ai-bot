/**
 * GET /api/live-metrics
 * Fetches curated PromQL results from Grafana Cloud Prometheus via the
 * Grafana datasource proxy (auth = GRAFANA_DASHBOARD_TOKEN, already configured).
 *
 * Purpose: powers crypto-radar page "Live Analytics" section — native React
 * visuals backed by Grafana-indexed Prometheus metrics (tradeai_*).
 *
 * Kill-switch: LIVE_METRICS_ENABLED=0 disables endpoint (returns 503).
 *
 * Added 2026-04-19 (Path B integration — bring Grafana data into site UI).
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STACK = process.env.GRAFANA_STACK_URL || 'https://legie123.grafana.net';
const TOKEN = process.env.GRAFANA_DASHBOARD_TOKEN || '';
const DS_UID = 'grafanacloud-prom';
const BASE = `${STACK}/api/datasources/proxy/uid/${DS_UID}/api/v1`;

// Curated query surface — UI consumes by key, not by raw promql.
const INSTANT: Record<string, string> = {
  netPnl24h:
    'sum(increase(tradeai_trade_pnl_positive_sum{service="trade-ai"}[24h])) - sum(increase(tradeai_trade_pnl_loss_abs_sum{service="trade-ai"}[24h]))',
  pf24h:
    'sum(increase(tradeai_trade_pnl_positive_sum{service="trade-ai"}[24h])) / clamp_min(sum(increase(tradeai_trade_pnl_loss_abs_sum{service="trade-ai"}[24h])), 0.0001)',
  llmBurn24h: 'sum(increase(tradeai_llm_cost_dollars_total{service="trade-ai"}[24h]))',
  selectionLift: 'tradeai_selection_lift_pct{service="trade-ai"}',
  poolSize: 'tradeai_arena_pool_size{service="trade-ai"}',
  alive: 'tradeai_arena_alive_total{service="trade-ai"}',
  killed: 'tradeai_arena_killed_total{service="trade-ai"}',
  popPf: 'tradeai_pop_weighted_pf{service="trade-ai"}',
  popWr: 'tradeai_pop_weighted_winrate{service="trade-ai"}',
  wins24h:
    'sum(increase(tradeai_trade_executions_total{service="trade-ai",result="win"}[24h]))',
  losses24h:
    'sum(increase(tradeai_trade_executions_total{service="trade-ai",result="loss"}[24h]))',
  decisions24h:
    'sum(increase(tradeai_decisions_total{service="trade-ai"}[24h]))',
  llmErrorRate5m:
    'sum(rate(tradeai_llm_calls_total{service="trade-ai",status=~"error|timeout"}[5m])) / clamp_min(sum(rate(tradeai_llm_calls_total{service="trade-ai"}[5m])), 0.0001)',
};

// Sparkline series (query_range). step chosen to return ~24 points.
const RANGE: Record<string, string> = {
  pnlCumulative:
    'sum(tradeai_trade_pnl_positive_sum{service="trade-ai"}) - sum(tradeai_trade_pnl_loss_abs_sum{service="trade-ai"})',
  tradesPerHour:
    'sum(increase(tradeai_trade_executions_total{service="trade-ai",result=~"win|loss"}[1h]))',
};

type QueryStatus = 'ok' | 'error' | 'empty';
type InstantResult = { value: number | null; ts: number | null; status: QueryStatus };
type RangeResult = { points: Array<[number, number]>; status: QueryStatus };

async function promGet(path: string, params: Record<string, string>): Promise<unknown> {
  if (!TOKEN) throw new Error('GRAFANA_DASHBOARD_TOKEN missing');
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${path}?${qs}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      signal: ctrl.signal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next: { revalidate: 0 } as any,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`prom ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseInstant(j: unknown): InstantResult {
  const r = j as { data?: { result?: Array<{ value?: [number, string] }> } } | null;
  const first = r?.data?.result?.[0]?.value;
  if (!first) return { value: null, ts: null, status: 'empty' };
  const v = Number(first[1]);
  return {
    value: Number.isFinite(v) ? v : null,
    ts: first[0] * 1000,
    status: Number.isFinite(v) ? 'ok' : 'empty',
  };
}

function parseRange(j: unknown): RangeResult {
  const r = j as { data?: { result?: Array<{ values?: Array<[number, string]> }> } } | null;
  const vals = r?.data?.result?.[0]?.values || [];
  const points = vals
    .map(([t, v]): [number, number] => [t * 1000, Number(v)])
    .filter(([, v]) => Number.isFinite(v));
  return {
    points,
    status: points.length > 0 ? 'ok' : 'empty',
  };
}

export async function GET() {
  if (process.env.LIVE_METRICS_ENABLED === '0') {
    return NextResponse.json({ error: 'disabled' }, { status: 503 });
  }
  if (!TOKEN) {
    return NextResponse.json(
      { error: 'GRAFANA_DASHBOARD_TOKEN not configured' },
      { status: 500 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const start = now - 24 * 3600;
  const step = 3600; // 1h step → 24 points for sparklines

  const instantResults: Record<string, InstantResult> = {};
  const rangeResults: Record<string, RangeResult> = {};

  // Fire all queries in parallel. Individual failures → null, don't abort response.
  await Promise.all([
    ...Object.entries(INSTANT).map(async ([key, query]) => {
      try {
        const j = await promGet('query', { query });
        instantResults[key] = parseInstant(j);
      } catch {
        instantResults[key] = { value: null, ts: null, status: 'error' };
      }
    }),
    ...Object.entries(RANGE).map(async ([key, query]) => {
      try {
        const j = await promGet('query_range', {
          query,
          start: String(start),
          end: String(now),
          step: String(step),
        });
        rangeResults[key] = parseRange(j);
      } catch {
        rangeResults[key] = { points: [], status: 'error' };
      }
    }),
  ]);

  // Summary counters — let UI compute PartialBadge without iterating.
  const totalQueries = Object.keys(INSTANT).length + Object.keys(RANGE).length;
  const failedQueries =
    Object.values(instantResults).filter((r) => r.status === 'error').length +
    Object.values(rangeResults).filter((r) => r.status === 'error').length;

  return NextResponse.json(
    {
      ok: true,
      fetchedAt: now * 1000,
      instant: instantResults,
      range: rangeResults,
      queryHealth: {
        total: totalQueries,
        failed: failedQueries,
        empty:
          Object.values(instantResults).filter((r) => r.status === 'empty').length +
          Object.values(rangeResults).filter((r) => r.status === 'empty').length,
      },
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
      },
    },
  );
}
