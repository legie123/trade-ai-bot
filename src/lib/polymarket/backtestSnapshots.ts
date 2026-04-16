// ============================================================
// Backtest Snapshots — Phase 2 Batch 8
//
// ADDITIVE. Stores rolling snapshots of `BacktestSummary` totals
// for trend analysis. In-memory ring buffer + best-effort Supabase
// persist to `poly_backtest_snapshots`.
//
// Retention: RING_MAX=168 (7 days @ 1/hr).
// ============================================================
import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { runPaperBacktest, BacktestSummary } from './paperBacktest';

const log = createLogger('BacktestSnapshots');

export interface SnapshotRow {
  capturedAt: number;
  evaluated: number;
  hitRate: number;
  totalPnlUsd: number;
  avgPnlUsd: number;
  wins: number;
  losses: number;
  minEdgeScore: number;
  notionalPerSignal: number;
}

const RING_MAX = 168;
const ring: SnapshotRow[] = [];

function summaryToRow(s: BacktestSummary, minEdge: number): SnapshotRow {
  return {
    capturedAt: s.generatedAt,
    evaluated: s.totals.evaluated,
    hitRate: s.totals.hitRate,
    totalPnlUsd: s.totals.totalPnlUsd,
    avgPnlUsd: s.totals.avgPnlUsd,
    wins: s.totals.wins,
    losses: s.totals.losses,
    minEdgeScore: minEdge,
    notionalPerSignal: s.notionalPerSignal,
  };
}

/**
 * Capture one snapshot. Runs backtest internally. Safe to call periodically
 * (cron) — never throws, persists best-effort.
 */
export async function captureSnapshot(opts: {
  minEdgeScore?: number;
  notional?: number;
  limit?: number;
} = {}): Promise<SnapshotRow | null> {
  try {
    const minEdge = opts.minEdgeScore ?? 50;
    const summary = await runPaperBacktest({
      limit: opts.limit ?? 100,
      minEdgeScore: minEdge,
      notionalPerSignal: opts.notional ?? 100,
    });
    // Skip empty runs (no evaluable signals) — avoid polluting trend data
    if (summary.totals.evaluated === 0) {
      log.debug('snapshot skipped — no evaluable signals');
      return null;
    }
    const row = summaryToRow(summary, minEdge);
    ring.push(row);
    while (ring.length > RING_MAX) ring.shift();
    void persistAsync(row);
    log.info('snapshot captured', { evaluated: row.evaluated, pnl: row.totalPnlUsd });
    return row;
  } catch (e) {
    log.warn('snapshot failed', { error: String(e) });
    return null;
  }
}

async function persistAsync(row: SnapshotRow): Promise<void> {
  try {
    await supabase.from('poly_backtest_snapshots').insert({
      captured_at: new Date(row.capturedAt).toISOString(),
      evaluated: row.evaluated,
      hit_rate: row.hitRate,
      total_pnl_usd: row.totalPnlUsd,
      avg_pnl_usd: row.avgPnlUsd,
      wins: row.wins,
      losses: row.losses,
      min_edge_score: row.minEdgeScore,
      notional_per_signal: row.notionalPerSignal,
    });
  } catch {
    // table may not exist — ring buffer still serves the data
  }
}

export function recentSnapshots(limit = 168): SnapshotRow[] {
  const slice = ring.slice(-Math.max(1, Math.min(limit, RING_MAX)));
  return slice.slice();
}

export function snapshotStats(): { count: number; firstAt: number | null; lastAt: number | null } {
  if (!ring.length) return { count: 0, firstAt: null, lastAt: null };
  return {
    count: ring.length,
    firstAt: ring[0].capturedAt,
    lastAt: ring[ring.length - 1].capturedAt,
  };
}

// ─── Per-division snapshots ───────────────────────────────
// Batch 12: capture division breakdown alongside global totals.
export interface DivisionSnapshotRow {
  capturedAt: number;
  division: string;
  n: number;
  pnlUsd: number;
  minEdgeScore: number;
}

const divRing: DivisionSnapshotRow[] = [];
const DIV_RING_MAX = 168 * 16; // 7d × 16 divisions

export async function captureDivisionSnapshot(opts: {
  minEdgeScore?: number;
  notional?: number;
  limit?: number;
} = {}): Promise<DivisionSnapshotRow[]> {
  try {
    const minEdge = opts.minEdgeScore ?? 50;
    const summary = await runPaperBacktest({
      limit: opts.limit ?? 150,
      minEdgeScore: minEdge,
      notionalPerSignal: opts.notional ?? 100,
    });
    if (summary.totals.evaluated === 0) return [];
    const rows: DivisionSnapshotRow[] = [];
    const now = summary.generatedAt;
    for (const [div, v] of Object.entries(summary.byDivision)) {
      rows.push({ capturedAt: now, division: div, n: v.n, pnlUsd: v.pnlUsd, minEdgeScore: minEdge });
    }
    for (const r of rows) divRing.push(r);
    while (divRing.length > DIV_RING_MAX) divRing.shift();
    void persistDivAsync(rows);
    log.info('division snapshot captured', { divisions: rows.length });
    return rows;
  } catch (e) {
    log.warn('division snapshot failed', { error: String(e) });
    return [];
  }
}

async function persistDivAsync(rows: DivisionSnapshotRow[]): Promise<void> {
  try {
    await supabase.from('poly_backtest_snapshots_division').insert(
      rows.map(r => ({
        captured_at: new Date(r.capturedAt).toISOString(),
        division: r.division,
        n: r.n,
        pnl_usd: r.pnlUsd,
        min_edge_score: r.minEdgeScore,
      })),
    );
  } catch { /* table optional */ }
}

export function recentDivisionSnapshots(limit = 500): DivisionSnapshotRow[] {
  const slice = divRing.slice(-Math.max(1, Math.min(limit, DIV_RING_MAX)));
  return slice.slice();
}
