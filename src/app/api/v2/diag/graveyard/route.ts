// ============================================================
// /api/v2/diag/graveyard — FAZA 3 Batch 5/9
// ============================================================
// Diagnostic endpoint for the Butcher graveyard. Exposes:
//   - graveyard config + mode
//   - recent killed entries (capped)
//   - population stats: alive vs killed, trade-weighted WR/PF,
//     selection lift (the survivorship bias magnitude we're fixing)
//
// Usage:
//   GET /api/v2/diag/graveyard              → summary + 100 entries
//   GET /api/v2/diag/graveyard?limit=500    → up to 500 entries
//   GET /api/v2/diag/graveyard?entries=0    → stats only, no row dump
//
// PURE READ: no writes, no decision impact. Safe to probe on prod.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getGraveyardConfig,
  getGraveyardEntries,
  getPopulationStats,
} from '@/lib/v2/gladiators/graveyard';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('DiagGraveyard');

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams;
    const limitRaw = q.get('limit');
    const entriesFlag = q.get('entries');
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 1000) : 100;
    const includeEntries = entriesFlag !== '0';

    const t0 = Date.now();
    const config = getGraveyardConfig();
    const alive = gladiatorStore.getGladiators();

    // Run pop-stats + entries in parallel. Both read the same table
    // so DB cost is essentially a single round-trip (pop-stats fetches
    // up to 5000, entries fetches up to `limit`).
    const [popStats, entries] = await Promise.all([
      getPopulationStats(alive),
      includeEntries ? getGraveyardEntries(limit) : Promise.resolve([]),
    ]);

    const computeMs = Date.now() - t0;

    return NextResponse.json({
      success: true,
      computeMs,
      config,
      populationStats: popStats,
      // Warning banner: if mode='off' or Supabase not configured, graveyard
      // is dark → aliveAvgWinRate will NOT reflect real population.
      interpretation: {
        trustworthy:
          config.configured &&
          config.mode !== 'off' &&
          popStats.killed > 0,
        selectionLiftPp: Number(popStats.selectionLiftPct.toFixed(2)),
        note:
          popStats.killed === 0
            ? 'Graveyard empty: either no kills yet, mode=off, or migration not applied. Selection lift is undefined.'
            : 'selectionLiftPp = aliveAvgWR - popWeightedWR*100. Large positive lift = alive stats are survivorship-biased upward.',
      },
      ...(includeEntries ? { entries } : {}),
    });
  } catch (err) {
    log.error('diag/graveyard failed', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
