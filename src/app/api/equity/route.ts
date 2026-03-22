// ============================================================
// Equity Curve API — Tracks cumulative P&L over time
// Returns balance history, drawdown, and performance metrics
// ============================================================

import { NextResponse } from 'next/server';
import { getDecisions, getPerformance } from '@/lib/store/db';
import { getExecutionLog } from '@/lib/engine/executor';

export const dynamic = 'force-dynamic';

interface EquityPoint {
  timestamp: string;
  balance: number;
  pnl: number;
  tradeCount: number;
  event: string;
}

export async function GET() {
  try {
    const decisions = getDecisions();
    const execLog = getExecutionLog();
    const perf = getPerformance();

    // Build equity curve from resolved decisions
    const resolved = decisions
      .filter(d => d.outcome === 'WIN' || d.outcome === 'LOSS')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let balance = 1000; // Starting balance
    const riskPerTrade = 1.5; // 1.5% risk per trade
    const curve: EquityPoint[] = [
      { timestamp: new Date(Date.now() - 30 * 86400000).toISOString(), balance: 1000, pnl: 0, tradeCount: 0, event: 'START' }
    ];

    let peakBalance = 1000;
    let maxDrawdown = 0;
    let winStreak = 0;
    let lossStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let totalWins = 0;
    let totalLosses = 0;

    for (const d of resolved) {
      const pnlPct = d.pnlPercent || 0;
      const riskAmount = balance * (riskPerTrade / 100);
      const slPct = d.symbol === 'BTC' ? 0.5 : 1.0;
      const leverage = riskAmount / (balance * (slPct / 100));
      const tradePnl = balance * leverage * (pnlPct / 100);
      
      balance += tradePnl;
      if (balance < 0) balance = 0;

      // Track drawdown
      if (balance > peakBalance) peakBalance = balance;
      const currentDD = ((peakBalance - balance) / peakBalance) * 100;
      if (currentDD > maxDrawdown) maxDrawdown = currentDD;

      // Track streaks
      if (d.outcome === 'WIN') {
        totalWins++;
        winStreak++;
        lossStreak = 0;
        if (winStreak > maxWinStreak) maxWinStreak = winStreak;
      } else {
        totalLosses++;
        lossStreak++;
        winStreak = 0;
        if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
      }

      curve.push({
        timestamp: d.evaluatedAt || d.timestamp,
        balance: Math.round(balance * 100) / 100,
        pnl: Math.round(tradePnl * 100) / 100,
        tradeCount: totalWins + totalLosses,
        event: `${d.outcome} ${d.symbol} ${pnlPct > 0 ? '+' : ''}${pnlPct}%`,
      });
    }

    // Today's snapshot
    curve.push({
      timestamp: new Date().toISOString(),
      balance: Math.round(balance * 100) / 100,
      pnl: 0,
      tradeCount: totalWins + totalLosses,
      event: 'NOW',
    });

    // Daily aggregation for chart
    const dailyMap = new Map<string, { balance: number; trades: number }>();
    for (const point of curve) {
      const day = point.timestamp.split('T')[0];
      dailyMap.set(day, { balance: point.balance, trades: point.tradeCount });
    }
    const dailyCurve = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      balance: data.balance,
      trades: data.trades,
    }));

    // Summary metrics
    const totalReturn = ((balance - 1000) / 1000) * 100;
    const winRate = (totalWins + totalLosses) > 0 
      ? Math.round((totalWins / (totalWins + totalLosses)) * 100) 
      : 0;
    const avgWin = totalWins > 0
      ? resolved.filter(d => d.outcome === 'WIN').reduce((s, d) => s + (d.pnlPercent || 0), 0) / totalWins
      : 0;
    const avgLoss = totalLosses > 0
      ? resolved.filter(d => d.outcome === 'LOSS').reduce((s, d) => s + Math.abs(d.pnlPercent || 0), 0) / totalLosses
      : 0;
    const profitFactor = avgLoss > 0 ? (avgWin * totalWins) / (avgLoss * totalLosses) : 0;

    return NextResponse.json({
      curve: dailyCurve,
      currentBalance: Math.round(balance * 100) / 100,
      startingBalance: 1000,
      totalReturn: Math.round(totalReturn * 100) / 100,
      peakBalance: Math.round(peakBalance * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      totalTrades: totalWins + totalLosses,
      wins: totalWins,
      losses: totalLosses,
      winRate,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      maxWinStreak,
      maxLossStreak,
      pendingTrades: decisions.filter(d => d.outcome === 'PENDING').length,
      executedPaperTrades: execLog.filter(e => e.executed).length,
      performanceHistory: perf.slice(-30), // Last 30 performance records
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
