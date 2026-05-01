/**
 * FAZA 3.14 — Brain Status Aggregator.
 *
 * Composes the four independent Polymarket observability signals into a
 * single operator-friendly verdict:
 *
 *   edgeWatchdog  (realized PF/WR)      → UNKNOWN | HEALTHY | DEGRADED | UNHEALTHY
 *   settlementHealth (pipeline liveness)→ idle | green | yellow | red | unknown
 *   feedHealth   (goldsky/scanner/poly) → fresh | aging | stale | unconfigured | error
 *   opsFlags      (kill-switch state)   → count of CRITICAL flags with state='off'
 *
 * Output verdict: GREEN | AMBER | RED | UNKNOWN (plus per-source breakdown).
 * Answers "is the brain ready to place money?" at a glance.
 *
 * Rules (strictest wins):
 *   RED   — any signal RED-equivalent:
 *             edgeWatchdog=UNHEALTHY OR
 *             settlementHealth=red OR
 *             feedHealth aggregate=stale OR
 *             >=1 CRITICAL ops flag off
 *   AMBER — any signal DEGRADED-equivalent:
 *             edgeWatchdog=DEGRADED OR
 *             settlementHealth=yellow OR
 *             feedHealth aggregate=aging OR
 *             >=1 HIGH-risk ops flag off
 *   GREEN — all checked signals healthy AND at least one is informative
 *           (prevents "GREEN because nothing is wired yet")
 *   UNKNOWN — everything UNKNOWN/idle/unconfigured
 *
 * Soft-fail: each probe wrapped in try/catch; a single source error
 * degrades that input to UNKNOWN without poisoning the rest.
 *
 * Kill-switch: BRAIN_STATUS_ENABLED=0 → {enabled:false, verdict:'UNKNOWN'}.
 */
import { getEdgeWatchdogState, EdgeVerdict } from './edgeWatchdog';
import { probeSettlementHealth, HealthStatus as SettlementStatus } from './settlementHealth';
import { getFeedHealth, FeedStatus } from './feedHealth';
import { getOpsFlagsSnapshot, Risk } from './opsFlags';
import { logBrainStatusSnapshot } from './brainStatusLog';

export type BrainVerdict = 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN';

export interface BrainSignal {
  source: 'edge' | 'settlement' | 'feed' | 'ops';
  verdict: 'green' | 'amber' | 'red' | 'unknown';
  summary: string;                 // short human-readable
  detail?: Record<string, unknown>; // optional drill-down payload
  error?: string | null;
}

export interface BrainStatus {
  enabled: boolean;
  verdict: BrainVerdict;
  generatedAt: string;
  signals: BrainSignal[];
  /** What pushed the verdict to its color — names of contributing signals. */
  topReasons: string[];
  cacheHit: boolean;
}

let cache: { status: BrainStatus; expiresAt: number } | null = null;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function mapEdge(v: EdgeVerdict): BrainSignal['verdict'] {
  switch (v) {
    case 'HEALTHY':   return 'green';
    case 'DEGRADED':  return 'amber';
    case 'UNHEALTHY': return 'red';
    default:          return 'unknown';
  }
}

function mapSettlement(s: SettlementStatus): BrainSignal['verdict'] {
  switch (s) {
    case 'green':    return 'green';
    case 'yellow':   return 'amber';
    case 'red':      return 'red';
    default:         return 'unknown';     // idle | unknown
  }
}

function mapFeed(s: FeedStatus): BrainSignal['verdict'] {
  switch (s) {
    case 'fresh':         return 'green';
    case 'aging':         return 'amber';
    case 'stale':         return 'red';
    case 'error':         return 'red';
    default:              return 'unknown'; // unconfigured
  }
}

async function probeEdge(): Promise<BrainSignal> {
  try {
    const st = await getEdgeWatchdogState();
    return {
      source: 'edge',
      verdict: mapEdge(st.verdict),
      summary: `watchdog=${st.verdict}${st.enforce ? ' [ENFORCE]' : ''}`,
      detail: {
        enabled: st.enabled,
        enforce: st.enforce,
        nDecisive: st.stats?.nDecisive ?? 0,
        profitFactor: st.stats?.profitFactor ?? null,
        winRate: st.stats?.winRate ?? null,
      },
      error: st.errorMsg,
    };
  } catch (err) {
    return {
      source: 'edge',
      verdict: 'unknown',
      summary: 'watchdog probe error',
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

async function probeSettlement(): Promise<BrainSignal> {
  try {
    const h = await probeSettlementHealth();
    return {
      source: 'settlement',
      verdict: mapSettlement(h.status),
      summary: `settlement=${h.status} (${h.reason})`,
      detail: { status: h.status, reason: h.reason, windows: h.windows.map((w) => w.label) },
      error: null,
    };
  } catch (err) {
    return {
      source: 'settlement',
      verdict: 'unknown',
      summary: 'settlement probe error',
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

async function probeFeed(): Promise<BrainSignal> {
  try {
    const f = await getFeedHealth();
    return {
      source: 'feed',
      verdict: mapFeed(f.aggregateStatus),
      summary: `feed=${f.aggregateStatus}${f.staleFeeds.length ? ` (stale: ${f.staleFeeds.join(',')})` : ''}`,
      detail: {
        aggregate: f.aggregateStatus,
        staleFeeds: f.staleFeeds,
        critical: f.criticalFeeds,
      },
      error: null,
    };
  } catch (err) {
    return {
      source: 'feed',
      verdict: 'unknown',
      summary: 'feed probe error',
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

/**
 * Ops-flag signal:
 *   RED if >=1 CRITICAL flag with state='off' (kill-switch pulled on a
 *        critical protection).
 *   AMBER if >=1 HIGH flag with state='off'.
 *   GREEN otherwise (all criticals + highs on or shadow).
 *   UNKNOWN never — flag catalog is always readable.
 */
function probeOps(): BrainSignal {
  try {
    const snap = getOpsFlagsSnapshot();
    const criticalOff: string[] = [];
    const highOff: string[] = [];
    for (const fr of snap.all) {
      if (fr.state !== 'off') continue;
      if ((fr.risk as Risk) === 'critical') criticalOff.push(fr.name);
      else if ((fr.risk as Risk) === 'high') highOff.push(fr.name);
    }
    let verdict: BrainSignal['verdict'] = 'green';
    if (criticalOff.length > 0) verdict = 'red';
    else if (highOff.length > 0) verdict = 'amber';
    return {
      source: 'ops',
      verdict,
      summary:
        criticalOff.length > 0
          ? `ops=red (${criticalOff.length} critical off: ${criticalOff.slice(0, 3).join(',')})`
          : highOff.length > 0
          ? `ops=amber (${highOff.length} high off)`
          : `ops=green (all protections on; ${snap.offCount}/${snap.totalFlags} flags off)`,
      detail: {
        totalFlags: snap.totalFlags,
        offCount: snap.offCount,
        criticalOff,
        highOff,
      },
      error: null,
    };
  } catch (err) {
    return {
      source: 'ops',
      verdict: 'unknown',
      summary: 'ops probe error',
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

/**
 * Strictest-wins verdict roll-up. Returns final color + contributing source names.
 */
export function rollup(signals: BrainSignal[]): { verdict: BrainVerdict; topReasons: string[] } {
  const red = signals.filter((s) => s.verdict === 'red');
  if (red.length > 0) {
    return { verdict: 'RED', topReasons: red.map((s) => s.summary) };
  }
  const amber = signals.filter((s) => s.verdict === 'amber');
  if (amber.length > 0) {
    return { verdict: 'AMBER', topReasons: amber.map((s) => s.summary) };
  }
  const green = signals.filter((s) => s.verdict === 'green');
  if (green.length > 0) {
    return { verdict: 'GREEN', topReasons: green.map((s) => s.summary) };
  }
  return { verdict: 'UNKNOWN', topReasons: ['no informative signals'] };
}

export async function getBrainStatus(): Promise<BrainStatus> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return { ...cache.status, cacheHit: true };
  }

  const enabled = (process.env.BRAIN_STATUS_ENABLED ?? '1') !== '0';
  if (!enabled) {
    const st: BrainStatus = {
      enabled: false,
      verdict: 'UNKNOWN',
      generatedAt: new Date().toISOString(),
      signals: [],
      topReasons: ['BRAIN_STATUS_ENABLED=0'],
      cacheHit: false,
    };
    cache = { status: st, expiresAt: now + envInt('BRAIN_STATUS_CACHE_MS', 30_000) };
    return st;
  }

  // Parallel probes — each is independently soft-failed.
  const [edge, settlement, feed] = await Promise.all([
    probeEdge(),
    probeSettlement(),
    probeFeed(),
  ]);
  const ops = probeOps();

  const signals = [edge, settlement, feed, ops];
  const { verdict, topReasons } = rollup(signals);

  const status: BrainStatus = {
    enabled: true,
    verdict,
    generatedAt: new Date().toISOString(),
    signals,
    topReasons,
    cacheHit: false,
  };
  cache = { status, expiresAt: now + envInt('BRAIN_STATUS_CACHE_MS', 30_000) };
  // Batch 3.18 — fire-and-forget snapshot persister. Wired here at the
  // tail of the cache-miss compute path: every fresh rollup gets logged
  // to polymarket_brain_status_log. Self-gated by BRAIN_STATUS_LOG_ENABLED;
  // never throws. cache-hit path skips it (writer also re-checks).
  logBrainStatusSnapshot(status);
  return status;
}

/** Test hook. */
export function __resetBrainStatusForTests(): void {
  cache = null;
}
