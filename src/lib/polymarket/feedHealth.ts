/**
 * feedHealth.ts — unified stale-feed detector.
 *
 * FAZA 3.4. Aggregates heartbeat state across all upstream feeds the
 * Polymarket brain depends on. Single source of truth for "is any of
 * our inputs dead right now?" Used by:
 *   - /api/v2/polymarket/feed-health  (machine endpoint, Prom scrape)
 *   - <FeedHeartbeatStrip/>           (audit UI header badge)
 *
 * Pure read. No side effects. No throws — any upstream failure degrades
 * to {status:'stale', lagSeconds:null} per feed.
 *
 * Feeds tracked:
 *   - goldsky    — Goldsky subgraph + event ingest       (critical)
 *   - polymarket — Polymarket Gamma/CLOB APIs            (critical)
 *   - scanner    — polymarket_scan_history last run      (critical)
 *   - grafana    — /api/live-metrics fetchedAt           (informational)
 *
 * Freshness thresholds are per-feed because cadences differ:
 *   - goldsky:    fresh ≤ 5min,  stale > 30min
 *   - polymarket: fresh ≤ 5min,  stale > 30min
 *   - scanner:    fresh ≤ 20min, stale > 60min (cron = 15min)
 *   - grafana:    fresh ≤ 30s,   stale > 120s
 */

import { getEventsHealth } from './eventsStore';
import { getGoldskyStatus } from './goldskyClient';
import { listRecentScans } from './scanHistory';

export type FeedStatus = 'fresh' | 'aging' | 'stale' | 'unconfigured' | 'error';

export interface FeedSnapshot {
  name: string;
  status: FeedStatus;
  lastTick: number | null;          // unix ms
  lagSeconds: number | null;
  freshMs: number;                   // below = fresh
  staleMs: number;                   // above = stale
  note: string;                      // human-readable rationale
  sourceHref?: string;               // drill-down URL
  sourceQuery?: string;              // underlying query/endpoint
}

export interface FeedHealthAggregate {
  generatedAt: number;
  aggregateStatus: FeedStatus;       // worst-of across critical feeds
  feeds: FeedSnapshot[];
  criticalFeeds: string[];
  staleFeeds: string[];
}

// FAZA 3.17 — non-null contract. Null/missing lastTick is handled at call sites
// (returns 'unconfigured' snapshot) so statusFromAge only classifies real ages.
function statusFromAge(lagMs: number, freshMs: number, staleMs: number): FeedStatus {
  if (!Number.isFinite(lagMs)) return 'stale';
  if (lagMs <= freshMs) return 'fresh';
  if (lagMs <= staleMs) return 'aging';
  return 'stale';
}

async function probeGoldsky(): Promise<FeedSnapshot> {
  const name = 'goldsky';
  const freshMs = 5 * 60_000;
  const staleMs = 30 * 60_000;
  try {
    const health = await getEventsHealth();
    const cfg = getGoldskyStatus();
    if (!health.configured) {
      return {
        name,
        status: 'unconfigured',
        lastTick: null,
        lagSeconds: null,
        freshMs,
        staleMs,
        note: 'Supabase unconfigured — Goldsky ingest cannot persist.',
        sourceHref: '/polymarket/audit/goldsky',
        sourceQuery: 'polymarket_events',
      };
    }
    const lastTick = health.lastEventAt ? new Date(health.lastEventAt).getTime() : null;
    // FAZA 3.17 — Treat never-fired webhook (lastTick==null) as 'unconfigured', NOT 'stale'.
    // Previously polluted brain-status=RED when Goldsky ingest never received any event
    // (e.g. webhook secret pending, subgraph not yet wired). True staleness requires
    // a prior successful tick that has since gone cold.
    if (lastTick == null) {
      return {
        name,
        status: 'unconfigured',
        lastTick: null,
        lagSeconds: null,
        freshMs,
        staleMs,
        note: `No Goldsky events ever received${cfg.enabled ? '' : ' (subgraph disabled)'} — webhook secret + polymarket_events write-flag pending.`,
        sourceHref: '/polymarket/audit/goldsky',
        sourceQuery: 'polymarket_events (max received_at)',
      };
    }
    const lagMs = Date.now() - lastTick;
    const status = statusFromAge(lagMs, freshMs, staleMs);
    return {
      name,
      status,
      lastTick,
      lagSeconds: health.lagSeconds,
      freshMs,
      staleMs,
      note: status === 'fresh'
        ? `Ingest healthy — subgraph ${cfg.enabled ? 'enabled' : 'cache-only'}, ${health.eventsLast1h} events/h.`
        : status === 'aging'
        ? `Ingest slowing — ${health.eventsLast1h} events/h, last ${Math.floor(lagMs / 60_000)}min ago.`
        : 'Ingest stale — no events in 30min; check webhook secret + write-flag.',
      sourceHref: '/polymarket/audit/goldsky',
      sourceQuery: 'polymarket_events (max received_at)',
    };
  } catch (e) {
    return {
      name,
      status: 'error',
      lastTick: null,
      lagSeconds: null,
      freshMs,
      staleMs,
      note: `Probe error: ${(e as Error).message}`,
      sourceHref: '/polymarket/audit/goldsky',
    };
  }
}

async function probeScanner(): Promise<FeedSnapshot> {
  const name = 'scanner';
  const freshMs = 20 * 60_000;
  const staleMs = 60 * 60_000;
  try {
    const scans = await listRecentScans(1);
    const last = scans[0] as { started_at?: string } | undefined;
    if (!last) {
      return {
        name,
        status: 'unconfigured',
        lastTick: null,
        lagSeconds: null,
        freshMs,
        staleMs,
        note: 'No scan runs logged — cron may be disabled or migration not applied.',
        sourceHref: '/polymarket/audit',
        sourceQuery: 'polymarket_scan_history',
      };
    }
    const lastTick = last.started_at ? new Date(last.started_at).getTime() : null;
    // FAZA 3.17 — Row present but started_at missing ⇒ unconfigured (migration drift),
    // not stale. Stale requires a real clock to compare against.
    if (lastTick == null) {
      return {
        name,
        status: 'unconfigured',
        lastTick: null,
        lagSeconds: null,
        freshMs,
        staleMs,
        note: 'Scan row missing started_at — schema drift; check polymarket_scan_history migration.',
        sourceHref: '/polymarket/audit',
        sourceQuery: 'polymarket_scan_history.started_at',
      };
    }
    const lagMs = Date.now() - lastTick;
    const status = statusFromAge(lagMs, freshMs, staleMs);
    return {
      name,
      status,
      lastTick,
      lagSeconds: Math.floor(lagMs / 1000),
      freshMs,
      staleMs,
      note: status === 'fresh'
        ? 'Scanner cron running on schedule.'
        : status === 'aging'
        ? `Last scan ${Math.floor(lagMs / 60_000)}min ago — cron expected every 15min.`
        : 'Scanner stale — cron likely down.',
      sourceHref: '/polymarket/audit',
      sourceQuery: 'polymarket_scan_history.started_at',
    };
  } catch (e) {
    return {
      name,
      status: 'error',
      lastTick: null,
      lagSeconds: null,
      freshMs,
      staleMs,
      note: `Probe error: ${(e as Error).message}`,
      sourceHref: '/polymarket/audit',
    };
  }
}

async function probePolymarketApi(): Promise<FeedSnapshot> {
  const name = 'polymarket';
  const freshMs = 5 * 60_000;
  const staleMs = 30 * 60_000;
  // Cheap liveness: fetch Gamma markets index, head-only.
  const url = 'https://gamma-api.polymarket.com/markets?limit=1&active=true';
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const ok = res.ok;
    const lagMs = Date.now() - started;
    if (!ok) {
      return {
        name,
        status: 'stale',
        lastTick: null,
        lagSeconds: null,
        freshMs,
        staleMs,
        note: `Gamma API returned ${res.status}.`,
        sourceHref: 'https://gamma-api.polymarket.com',
        sourceQuery: url,
      };
    }
    return {
      name,
      status: 'fresh',
      lastTick: Date.now(),
      lagSeconds: Math.round(lagMs / 1000),
      freshMs,
      staleMs,
      note: `Gamma API reachable (round-trip ${lagMs}ms).`,
      sourceHref: 'https://gamma-api.polymarket.com',
      sourceQuery: url,
    };
  } catch (e) {
    return {
      name,
      status: 'error',
      lastTick: null,
      lagSeconds: null,
      freshMs,
      staleMs,
      note: `Gamma unreachable: ${(e as Error).message}`,
      sourceHref: 'https://gamma-api.polymarket.com',
    };
  }
}

async function probeGrafana(): Promise<FeedSnapshot> {
  const name = 'grafana';
  const freshMs = 30_000;
  const staleMs = 120_000;
  const configured = !!process.env.GRAFANA_DASHBOARD_TOKEN;
  if (!configured) {
    return {
      name,
      status: 'unconfigured',
      lastTick: null,
      lagSeconds: null,
      freshMs,
      staleMs,
      note: 'GRAFANA_DASHBOARD_TOKEN not set — Prom datasource proxy unavailable.',
      sourceHref: '/crypto-radar',
      sourceQuery: '/api/live-metrics',
    };
  }
  // Defer to live-metrics route itself — caller already proxies.
  return {
    name,
    status: 'fresh',
    lastTick: Date.now(),
    lagSeconds: 0,
    freshMs,
    staleMs,
    note: 'Grafana datasource token configured. Real freshness measured by /api/live-metrics itself.',
    sourceHref: '/crypto-radar',
    sourceQuery: '/api/live-metrics',
  };
}

export const CRITICAL_FEEDS = new Set(['goldsky', 'scanner', 'polymarket']);

export async function getFeedHealth(): Promise<FeedHealthAggregate> {
  const [goldsky, scanner, poly, graf] = await Promise.all([
    probeGoldsky(),
    probeScanner(),
    probePolymarketApi(),
    probeGrafana(),
  ]);
  const feeds: FeedSnapshot[] = [goldsky, scanner, poly, graf];

  // Aggregate status = worst-of across critical feeds
  const order: Record<FeedStatus, number> = {
    fresh: 0,
    aging: 1,
    unconfigured: 2,
    stale: 3,
    error: 3,
  };
  let worst: FeedStatus = 'fresh';
  const staleFeeds: string[] = [];
  for (const f of feeds) {
    if (!CRITICAL_FEEDS.has(f.name)) continue;
    if (order[f.status] > order[worst]) worst = f.status;
    if (f.status === 'stale' || f.status === 'error') staleFeeds.push(f.name);
  }

  return {
    generatedAt: Date.now(),
    aggregateStatus: worst,
    feeds,
    criticalFeeds: Array.from(CRITICAL_FEEDS),
    staleFeeds,
  };
}
