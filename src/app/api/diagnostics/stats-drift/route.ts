// GET /api/diagnostics/stats-drift
// INSTITUTIONAL PURPOSE: Detects divergence between gladiator.stats (in-memory store)
// and ground-truth aggregate from gladiator_battles Supabase table.
//
// AUDIT-R3 context (2026-04-18): stats sync is fired only at PRIMARY_HORIZON=60
// from src/app/api/cron/route.ts A1 block. If the A1 block silently fails,
// or if gladiatorStore is rehydrated from stale DB, store.stats drifts from
// the dedicated battles ledger. This endpoint surfaces that drift.
//
// No-auth GET (diagnostics parity with /api/diagnostics/master).
//
// ASSUMPTION: battle rows expose { isWin: boolean, decision: string, pnl_percent: number }.
// If the schema rename (isWin -> is_win) happens, adapter below handles both.

import { NextResponse, NextRequest } from 'next/server';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { getGladiatorBattles } from '@/lib/store/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface DriftRow {
  id: string;
  name: string;
  isOmega?: boolean;
  stats_tt: number;
  battles_tt: number;
  drift_tt: number;
  stats_wins: number;
  battles_wins: number;
  stats_wr_pct: number;
  battles_wr_pct: number;
  drift_wr_pct: number;
  battles_long_n: number;
  battles_short_n: number;
  battles_long_wr_pct: number;
  battles_short_wr_pct: number;
  severity: 'OK' | 'MINOR' | 'MAJOR' | 'CRITICAL';
}

function pickWin(b: Record<string, unknown>): boolean | null {
  // Supports both legacy and renamed schemas
  const a = b.isWin;
  const c = (b as Record<string, unknown>).is_win;
  if (typeof a === 'boolean') return a;
  if (typeof c === 'boolean') return c;
  return null;
}

function pickDir(b: Record<string, unknown>): string {
  const d = (b.decision || (b as Record<string, unknown>).direction || 'UNK') as string;
  return String(d).toUpperCase();
}

export async function GET() {
  try {
    const gladiators = gladiatorStore.getGladiators();

    const rows: DriftRow[] = [];

    for (const g of gladiators) {
      const battles = await getGladiatorBattles(g.id, 1000);

      const battles_tt = battles.length;
      let battles_wins = 0;
      let long_n = 0, long_wins = 0;
      let short_n = 0, short_wins = 0;

      for (const b of battles as Record<string, unknown>[]) {
        const w = pickWin(b);
        const dir = pickDir(b);
        if (w === true) battles_wins += 1;
        if (dir === 'LONG') {
          long_n += 1;
          if (w === true) long_wins += 1;
        } else if (dir === 'SHORT') {
          short_n += 1;
          if (w === true) short_wins += 1;
        }
      }

      const stats_tt = g.stats.totalTrades || 0;
      const stats_wr_pct = g.stats.winRate || 0;
      const stats_wins = stats_tt > 0 ? Math.round((stats_wr_pct / 100) * stats_tt) : 0;

      const battles_wr_pct = battles_tt > 0 ? (battles_wins / battles_tt) * 100 : 0;
      const long_wr_pct = long_n > 0 ? (long_wins / long_n) * 100 : 0;
      const short_wr_pct = short_n > 0 ? (short_wins / short_n) * 100 : 0;

      const drift_tt = stats_tt - battles_tt;
      const drift_wr_pct = stats_wr_pct - battles_wr_pct;

      // Severity heuristic — tuned for operational alerting, not statistical testing
      let severity: DriftRow['severity'] = 'OK';
      const absDriftTt = Math.abs(drift_tt);
      const absDriftWr = Math.abs(drift_wr_pct);
      if (battles_tt >= 20 && (absDriftTt >= 20 || absDriftWr >= 20)) severity = 'CRITICAL';
      else if (battles_tt >= 10 && (absDriftTt >= 10 || absDriftWr >= 10)) severity = 'MAJOR';
      else if (absDriftTt >= 3 || absDriftWr >= 5) severity = 'MINOR';

      rows.push({
        id: g.id,
        name: g.name,
        isOmega: g.isOmega,
        stats_tt,
        battles_tt,
        drift_tt,
        stats_wins,
        battles_wins,
        stats_wr_pct: parseFloat(stats_wr_pct.toFixed(2)),
        battles_wr_pct: parseFloat(battles_wr_pct.toFixed(2)),
        drift_wr_pct: parseFloat(drift_wr_pct.toFixed(2)),
        battles_long_n: long_n,
        battles_short_n: short_n,
        battles_long_wr_pct: parseFloat(long_wr_pct.toFixed(2)),
        battles_short_wr_pct: parseFloat(short_wr_pct.toFixed(2)),
        severity,
      });
    }

    // Sort: CRITICAL first, then MAJOR, then MINOR
    const sevRank: Record<DriftRow['severity'], number> = { CRITICAL: 0, MAJOR: 1, MINOR: 2, OK: 3 };
    rows.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

    const agg = {
      gladiators: rows.length,
      critical: rows.filter(r => r.severity === 'CRITICAL').length,
      major: rows.filter(r => r.severity === 'MAJOR').length,
      minor: rows.filter(r => r.severity === 'MINOR').length,
      ok: rows.filter(r => r.severity === 'OK').length,
      total_stats_tt: rows.reduce((s, r) => s + r.stats_tt, 0),
      total_battles_tt: rows.reduce((s, r) => s + r.battles_tt, 0),
    };

    // Operational verdict
    let verdict = 'STATS_SYNC_HEALTHY';
    if (agg.critical > 0) verdict = 'STATS_SYNC_BROKEN';
    else if (agg.major > 0) verdict = 'STATS_SYNC_DRIFTING';
    else if (agg.minor > agg.ok) verdict = 'STATS_SYNC_NOISY';

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      verdict,
      summary: agg,
      gladiators: rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'stats-drift analysis failed', detail: (err as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/diagnostics/stats-drift
 * AUTH: requires Authorization: Bearer ${CRON_SECRET}
 * ACTION: calls gladiatorStore.reconcileStatsFromBattles() — recomputes stats
 * from gladiator_battles ground truth. Idempotent. Safe to call repeatedly.
 *
 * KILL-SWITCH: env STATS_RECONCILE_OFF=1 disables the action (returns 403).
 *
 * VALIDATION: compare before/after via a subsequent GET to this endpoint.
 * Expected: CRITICAL count drops toward 0; store.total_tt ≈ battles.total_tt
 * for non-Omega gladiators.
 */
export async function POST(req: NextRequest) {
  // Kill-switch
  if (process.env.STATS_RECONCILE_OFF === '1') {
    return NextResponse.json(
      { error: 'reconciliation disabled by STATS_RECONCILE_OFF' },
      { status: 403 }
    );
  }

  // Auth: CRON_SECRET required (same pattern as /api/cron)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    );
  }
  const auth =
    req.headers.get('authorization') ||
    req.headers.get('x-cron-secret') ||
    req.nextUrl.searchParams.get('secret');
  if (auth !== cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized. Set Authorization: Bearer <CRON_SECRET>.' },
      { status: 401 }
    );
  }

  try {
    const result = await gladiatorStore.reconcileStatsFromBattles();
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      action: 'reconcile-stats-from-battles',
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'reconciliation failed', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
