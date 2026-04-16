// ============================================================
// Paper Backtest Harness — Phase 2 Batch 7
//
// ADDITIVE. Reads paper signals (ring buffer first, then optional
// Supabase table) and computes mark-to-market P&L using the current
// Polymarket quote for each signal's market.
//
// Model (conservative):
//   - Entry at the signal's recorded yes/no price at emit time.
//   - Exit at the current live yes/no price returned by polyClient.
//   - Fixed notional per signal (configurable, default $100).
//   - Transaction cost per round-trip: 0.6% (configurable).
//   - BUY_YES: pnl = notional * (yesNow - yesAtSignal) / yesAtSignal - cost
//   - BUY_NO : pnl = notional * (noNow  - noAtSignal ) / noAtSignal  - cost
//   - SKIP   : excluded.
//
// Safety: pure read-only. No exchange calls, no writes.
// ============================================================
import { recentPaperSignals, PaperSignal } from './paperSignalFeeder';
import { getMarket } from './polyClient';

export interface BacktestRow {
  signalId: string;
  marketId: string;
  marketTitle: string;
  recommendation: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  edgeScore: number;
  entryPrice: number | null;
  exitPrice: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  emittedAt: number;
  ageSec: number;
  note?: string;
}

export interface BacktestSummary {
  generatedAt: number;
  window: { from: number; to: number } | null;
  notionalPerSignal: number;
  feePctRoundTrip: number;
  totals: {
    evaluated: number;
    wins: number;
    losses: number;
    hitRate: number;       // 0..1
    totalPnlUsd: number;
    avgPnlUsd: number;
    bestPnlUsd: number;
    worstPnlUsd: number;
  };
  byDivision: Record<string, { n: number; pnlUsd: number }>;
  rows: BacktestRow[];
}

export interface BacktestOptions {
  limit?: number;                // max signals to evaluate (default 50)
  notionalPerSignal?: number;    // USD per signal (default 100)
  feePctRoundTrip?: number;      // 0..1 (default 0.006)
  minEdgeScore?: number;         // filter (default 50)
  division?: string;             // filter by division (Batch 15)
}

export async function runPaperBacktest(opts: BacktestOptions = {}): Promise<BacktestSummary> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const notional = opts.notionalPerSignal ?? 100;
  const fee = opts.feePctRoundTrip ?? 0.006;
  const minEdge = opts.minEdgeScore ?? 50;

  const divisionFilter = opts.division?.toUpperCase();
  const signals: PaperSignal[] = recentPaperSignals(limit).filter(
    s => s.recommendation !== 'SKIP' && s.edgeScore >= minEdge
      && (!divisionFilter || s.division?.toUpperCase() === divisionFilter),
  );

  const rows: BacktestRow[] = [];
  const byDivision: Record<string, { n: number; pnlUsd: number }> = {};

  // Fetch live quotes in parallel, bounded concurrency (Promise.all is OK for ≤200)
  const quotes = await Promise.allSettled(
    signals.map(s => getMarket(s.marketId)),
  );

  const now = Date.now();
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    const q = quotes[i];
    const liveMarket = q.status === 'fulfilled' ? q.value : null;

    const yesNow = liveMarket?.outcomes?.[0]?.price ?? null;
    const noNow = liveMarket?.outcomes?.[1]?.price ?? null;

    let entry: number | null = null;
    let exit: number | null = null;
    let pnlPct: number | null = null;
    let pnlUsd: number | null = null;
    let note: string | undefined;

    if (s.recommendation === 'BUY_YES') {
      entry = s.yesPrice;
      exit = yesNow;
    } else if (s.recommendation === 'BUY_NO') {
      entry = s.noPrice;
      exit = noNow;
    }

    if (entry != null && exit != null && entry > 0) {
      pnlPct = (exit - entry) / entry - fee;
      pnlUsd = notional * pnlPct;
    } else {
      note = liveMarket ? 'missing-price' : 'quote-unavailable';
    }

    const row: BacktestRow = {
      signalId: s.id,
      marketId: s.marketId,
      marketTitle: s.marketTitle,
      recommendation: s.recommendation,
      edgeScore: s.edgeScore,
      entryPrice: entry,
      exitPrice: exit,
      pnlUsd,
      pnlPct,
      emittedAt: s.emittedAt,
      ageSec: Math.max(0, Math.round((now - s.emittedAt) / 1000)),
      note,
    };
    rows.push(row);

    if (pnlUsd != null) {
      const d = s.division as string;
      if (!byDivision[d]) byDivision[d] = { n: 0, pnlUsd: 0 };
      byDivision[d].n += 1;
      byDivision[d].pnlUsd += pnlUsd;
    }
  }

  const evaluated = rows.filter(r => r.pnlUsd != null);
  const wins = evaluated.filter(r => (r.pnlUsd ?? 0) > 0).length;
  const losses = evaluated.filter(r => (r.pnlUsd ?? 0) < 0).length;
  const totalPnl = evaluated.reduce((acc, r) => acc + (r.pnlUsd ?? 0), 0);
  const pnls = evaluated.map(r => r.pnlUsd ?? 0);
  const best = pnls.length ? Math.max(...pnls) : 0;
  const worst = pnls.length ? Math.min(...pnls) : 0;
  const avg = evaluated.length ? totalPnl / evaluated.length : 0;
  const hitRate = evaluated.length ? wins / evaluated.length : 0;

  const window = signals.length
    ? { from: signals[signals.length - 1].emittedAt, to: signals[0].emittedAt }
    : null;

  // Round monetary values for readable JSON
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  for (const row of rows) {
    if (row.pnlUsd != null) row.pnlUsd = r2(row.pnlUsd);
    if (row.pnlPct != null) row.pnlPct = r4(row.pnlPct);
  }
  for (const d of Object.keys(byDivision)) {
    byDivision[d].pnlUsd = r2(byDivision[d].pnlUsd);
  }

  return {
    generatedAt: now,
    window,
    notionalPerSignal: notional,
    feePctRoundTrip: fee,
    totals: {
      evaluated: evaluated.length,
      wins,
      losses,
      hitRate: r4(hitRate),
      totalPnlUsd: r2(totalPnl),
      avgPnlUsd: r2(avg),
      bestPnlUsd: r2(best),
      worstPnlUsd: r2(worst),
    },
    byDivision,
    rows,
  };
}
