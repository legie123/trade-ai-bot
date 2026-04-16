// ============================================================
// Gladiator Attribution API — Phase 2 Batch 16
// Aggregates per-gladiator P&L from DecisionSnapshot data.
// GET /api/v2/gladiator-attribution
// ADDITIVE. Read-only. No side effects.
// ============================================================
import { NextResponse } from 'next/server';
import { getDecisions } from '@/lib/store/db';

interface GladiatorStats {
  gladiatorId: string;
  trades: number;
  wins: number;
  losses: number;
  pending: number;
  hitRate: number;          // 0..1
  totalPnlPct: number;
  avgPnlPct: number;
  bestPnlPct: number;
  worstPnlPct: number;
  lastTradeAt: string;
}

export async function GET() {
  try {
    const decisions = getDecisions();

    // Group by gladiatorId
    const map = new Map<string, typeof decisions>();
    for (const d of decisions) {
      const gid = d.gladiatorId || 'unknown';
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(d);
    }

    const gladiators: GladiatorStats[] = [];

    for (const [gid, trades] of map.entries()) {
      const evaluated = trades.filter(t => t.outcome !== 'PENDING' && t.pnlPercent != null);
      const wins = evaluated.filter(t => t.outcome === 'WIN').length;
      const losses = evaluated.filter(t => t.outcome === 'LOSS').length;
      const pending = trades.filter(t => t.outcome === 'PENDING').length;
      const pnls = evaluated.map(t => t.pnlPercent ?? 0);
      const totalPnl = pnls.reduce((a, b) => a + b, 0);
      const best = pnls.length ? Math.max(...pnls) : 0;
      const worst = pnls.length ? Math.min(...pnls) : 0;
      const avg = evaluated.length ? totalPnl / evaluated.length : 0;
      const hitRate = evaluated.length ? wins / evaluated.length : 0;

      // Latest trade timestamp
      const sorted = [...trades].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      const r2 = (n: number) => Math.round(n * 100) / 100;
      const r4 = (n: number) => Math.round(n * 10000) / 10000;

      gladiators.push({
        gladiatorId: gid,
        trades: trades.length,
        wins,
        losses,
        pending,
        hitRate: r4(hitRate),
        totalPnlPct: r2(totalPnl),
        avgPnlPct: r2(avg),
        bestPnlPct: r2(best),
        worstPnlPct: r2(worst),
        lastTradeAt: sorted[0]?.timestamp ?? '',
      });
    }

    // Sort by totalPnlPct descending
    gladiators.sort((a, b) => b.totalPnlPct - a.totalPnlPct);

    return NextResponse.json({
      success: true,
      data: {
        generatedAt: Date.now(),
        totalDecisions: decisions.length,
        gladiators,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: { message: (e as Error).message } },
      { status: 500 },
    );
  }
}
