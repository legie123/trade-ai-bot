// GET /api/diagnostics/signal-quality — Per-Source Signal Performance Analysis
// INSTITUTIONAL PURPOSE: Identifies which signal sources produce profitable trades
// and which are dragging down the system's Win Rate.
import { NextResponse } from 'next/server';
import { getDecisions } from '@/lib/store/db';
import type { DecisionSnapshot } from '@/lib/types/radar';

export const dynamic = 'force-dynamic';

interface SourceMetrics {
  source: string;
  totalTrades: number;
  wins: number;
  losses: number;
  neutral: number;
  winRate: number;
  avgPnlPercent: number;
  bestTrade: number;
  worstTrade: number;
  expectancy: number;
  status: 'HEALTHY' | 'DEGRADED' | 'TOXIC';
}

export async function GET() {
  try {
    const decisions = getDecisions();
    const evaluated = decisions.filter(
      (d: DecisionSnapshot) => d.outcome === 'WIN' || d.outcome === 'LOSS'
    );

    if (evaluated.length === 0) {
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        totalEvaluated: 0,
        sources: [],
        systemWinRate: 0,
        recommendation: 'No evaluated trades yet. System is in warm-up phase.',
      });
    }

    // Group by source
    const sourceMap = new Map<string, DecisionSnapshot[]>();
    for (const d of evaluated) {
      const src = d.source || 'UNKNOWN';
      const arr = sourceMap.get(src) || [];
      arr.push(d);
      sourceMap.set(src, arr);
    }

    const sources: SourceMetrics[] = [];

    for (const [source, trades] of sourceMap) {
      const wins = trades.filter(t => t.outcome === 'WIN').length;
      const losses = trades.filter(t => t.outcome === 'LOSS').length;
      const neutral = trades.length - wins - losses;
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

      const pnls = trades.map(t => t.pnlPercent || 0);
      const avgPnlPercent = pnls.length > 0
        ? pnls.reduce((a, b) => a + b, 0) / pnls.length
        : 0;

      const winPnls = trades.filter(t => t.outcome === 'WIN').map(t => t.pnlPercent || 0);
      const lossPnls = trades.filter(t => t.outcome === 'LOSS').map(t => Math.abs(t.pnlPercent || 0));

      const avgWin = winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : 0;
      const avgLoss = lossPnls.length > 0 ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : 0;
      const wr = winRate / 100;
      const expectancy = (wr * avgWin) - ((1 - wr) * avgLoss);

      // Classification
      let status: 'HEALTHY' | 'DEGRADED' | 'TOXIC' = 'HEALTHY';
      if (trades.length >= 10 && winRate < 35) status = 'TOXIC';
      else if (trades.length >= 10 && winRate < 45) status = 'DEGRADED';

      sources.push({
        source,
        totalTrades: trades.length,
        wins,
        losses,
        neutral,
        winRate: parseFloat(winRate.toFixed(1)),
        avgPnlPercent: parseFloat(avgPnlPercent.toFixed(2)),
        bestTrade: Math.max(...pnls, 0),
        worstTrade: Math.min(...pnls, 0),
        expectancy: parseFloat(expectancy.toFixed(3)),
        status,
      });
    }

    // Sort by expectancy descending (best sources first)
    sources.sort((a, b) => b.expectancy - a.expectancy);

    // System-wide metrics
    const totalWins = evaluated.filter(d => d.outcome === 'WIN').length;
    const systemWinRate = parseFloat(((totalWins / evaluated.length) * 100).toFixed(1));

    const toxicSources = sources.filter(s => s.status === 'TOXIC');
    const healthySources = sources.filter(s => s.status === 'HEALTHY');

    let recommendation = 'System operating within normal parameters.';
    if (toxicSources.length > 0) {
      const toxicNames = toxicSources.map(s => `${s.source} (WR: ${s.winRate}%)`).join(', ');
      recommendation = `TOXIC sources detected: ${toxicNames}. Consider disabling these sources to improve system WR from ${systemWinRate}%.`;
    }

    // Last 30 days filter
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recent30d = evaluated.filter(d => d.timestamp > thirtyDaysAgo);
    const recent30dWins = recent30d.filter(d => d.outcome === 'WIN').length;
    const recent30dWR = recent30d.length > 0
      ? parseFloat(((recent30dWins / recent30d.length) * 100).toFixed(1))
      : 0;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      totalEvaluated: evaluated.length,
      systemWinRate,
      recent30dWinRate: recent30dWR,
      recent30dTrades: recent30d.length,
      sources,
      healthySources: healthySources.length,
      toxicSources: toxicSources.length,
      recommendation,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Signal quality analysis failed', detail: (err as Error).message },
      { status: 500 }
    );
  }
}
