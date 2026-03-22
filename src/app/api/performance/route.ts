// GET /api/performance — aggregated performance data for dashboard
import { NextResponse } from 'next/server';
import { getDecisions, getBotConfig } from '@/lib/store/db';
import { getPortfolio } from '@/lib/engine/portfolio';
import { runBacktest, runWalkForwardBacktest } from '@/lib/engine/backtester';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const decisions = getDecisions();
    const portfolio = await getPortfolio();
    const config = getBotConfig() as { paperBalance?: number; mode?: string };
    const backtest = runBacktest();
    const walkforward = runWalkForwardBacktest();

    const today = new Date().toISOString().slice(0, 10);
    const todayDecs = decisions.filter(d => d.timestamp.startsWith(today));
    const allEvaluated = decisions.filter(d => d.outcome !== 'PENDING');
    const wins = allEvaluated.filter(d => d.outcome === 'WIN');
    const losses = allEvaluated.filter(d => d.outcome === 'LOSS');

    // Hourly distribution
    const hourlyMap: Record<number, { trades: number; wins: number }> = {};
    for (let h = 0; h < 24; h++) hourlyMap[h] = { trades: 0, wins: 0 };
    for (const d of allEvaluated) {
      const hour = new Date(d.timestamp).getHours();
      hourlyMap[hour].trades++;
      if (d.outcome === 'WIN') hourlyMap[hour].wins++;
    }

    // Symbol performance
    const symbolMap: Record<string, { trades: number; wins: number; pnl: number }> = {};
    for (const d of allEvaluated) {
      if (!symbolMap[d.symbol]) symbolMap[d.symbol] = { trades: 0, wins: 0, pnl: 0 };
      symbolMap[d.symbol].trades++;
      if (d.outcome === 'WIN') symbolMap[d.symbol].wins++;
      symbolMap[d.symbol].pnl += d.pnlPercent || 0;
    }

    // Win streak
    let streak = 0;
    let maxStreak = 0;
    for (const d of allEvaluated) {
      if (d.outcome === 'WIN') { streak++; maxStreak = Math.max(maxStreak, streak); }
      else streak = 0;
    }

    // Daily PnL history
    const dailyMap: Record<string, { pnl: number; trades: number; wins: number }> = {};
    for (const d of allEvaluated) {
      const day = d.timestamp.slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { pnl: 0, trades: 0, wins: 0 };
      dailyMap[day].pnl += d.pnlPercent || 0;
      dailyMap[day].trades++;
      if (d.outcome === 'WIN') dailyMap[day].wins++;
    }

    return NextResponse.json({
      overview: {
        totalBalance: portfolio.totalBalance,
        paperBalance: config.paperBalance || 1000,
        pnlPercent: ((portfolio.totalBalance - (config.paperBalance || 1000)) / (config.paperBalance || 1000) * 100),
        totalPnl: portfolio.totalPnl,
        mode: config.mode || 'PAPER',
        positions: portfolio.positions.length,
      },
      stats: {
        totalDecisions: decisions.length,
        todayDecisions: todayDecs.length,
        totalEvaluated: allEvaluated.length,
        wins: wins.length,
        losses: losses.length,
        winRate: allEvaluated.length > 0 ? Math.round((wins.length / allEvaluated.length) * 100) : 0,
        avgWin: wins.length > 0 ? Math.round(wins.reduce((s, d) => s + (d.pnlPercent || 0), 0) / wins.length * 100) / 100 : 0,
        avgLoss: losses.length > 0 ? Math.round(Math.abs(losses.reduce((s, d) => s + (d.pnlPercent || 0), 0) / losses.length) * 100) / 100 : 0,
        maxStreak,
        currentStreak: streak,
      },
      backtest: {
        sharpe: backtest.stats.sharpeApprox,
        profitFactor: backtest.stats.profitFactor,
        maxDrawdown: backtest.stats.maxDrawdownPercent,
        totalTrades: backtest.stats.totalTrades,
      },
      walkforward: {
        trainWinRate: walkforward.analysis.trainWinRate,
        testWinRate: walkforward.analysis.testWinRate,
        consistency: walkforward.analysis.consistencyRatio,
        overfitRisk: walkforward.analysis.overfitRisk,
        verdict: walkforward.analysis.verdict,
      },
      equityCurve: backtest.equityCurve,
      hourlyDistribution: Object.entries(hourlyMap).map(([h, v]) => ({ hour: parseInt(h), ...v })),
      symbolPerformance: Object.entries(symbolMap)
        .map(([symbol, v]) => ({ symbol, ...v, winRate: v.trades > 0 ? Math.round((v.wins / v.trades) * 100) : 0 }))
        .sort((a, b) => b.trades - a.trades)
        .slice(0, 10),
      dailyPnl: Object.entries(dailyMap)
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      recentTrades: decisions.slice(0, 15).map(d => ({
        symbol: d.symbol,
        signal: d.signal,
        price: d.price,
        confidence: d.confidence,
        outcome: d.outcome,
        pnl: d.pnlPercent || 0,
        timestamp: d.timestamp,
        source: d.source || 'Engine',
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
