/**
 * GET /api/v2/analytics
 * Performance analytics: equity curve, drawdown, Sharpe, Sortino, expectancy,
 * streak analysis, by-symbol/direction breakdown.
 *
 * Auth: cron_secret (same as other protected endpoints)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { supabase } from '@/lib/store/db';
import {
  computeSharpeRatio,
  computeExpectancy,
  computeConsistency,
  computeConsecutiveLosses,
  type TradeRecord,
} from '@/lib/v2/metrics/gladiatorMetrics';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Analytics');

export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    // Fetch equity curve
    const { data: equityData } = await supabase
      .from('equity_history')
      .select('equity, timestamp')
      .order('timestamp', { ascending: true })
      .limit(1000);

    // Fetch gladiator battles (trade records)
    const { data: battles } = await supabase
      .from('gladiator_battles')
      .select('gladiator_id, symbol, direction, pnl_percent, is_win, created_at')
      .order('created_at', { ascending: true })
      .limit(5000);

    const trades: TradeRecord[] = (battles || []).map(b => ({
      pnlPercent: b.pnl_percent || 0,
      isWin: b.is_win || false,
      timestamp: new Date(b.created_at).getTime(),
    }));

    // Aggregate metrics
    const returns = trades.map(t => t.pnlPercent);
    const sharpe = computeSharpeRatio(returns);
    const expectancy = computeExpectancy(trades);
    const consistency = computeConsistency(trades);
    const maxConsecutiveLosses = computeConsecutiveLosses(trades);

    // Sortino Ratio (downside deviation only)
    const negativeReturns = returns.filter(r => r < 0);
    const meanReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const downsideVariance = negativeReturns.length > 0
      ? negativeReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / negativeReturns.length
      : 0;
    const downsideDev = Math.sqrt(downsideVariance);
    const sortino = downsideDev > 0 ? (meanReturn / downsideDev) * Math.sqrt(1250) : 0;

    // Drawdown from equity curve
    let maxDrawdown = 0;
    let peak = 0;
    for (const point of (equityData || [])) {
      const eq = point.equity || 0;
      if (eq > peak) peak = eq;
      if (peak > 0) {
        const dd = ((peak - eq) / peak) * 100;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    }

    // By-symbol breakdown
    const symbolMap: Record<string, { wins: number; total: number; pnl: number }> = {};
    for (const b of (battles || [])) {
      const sym = b.symbol || 'UNKNOWN';
      if (!symbolMap[sym]) symbolMap[sym] = { wins: 0, total: 0, pnl: 0 };
      symbolMap[sym].total++;
      if (b.is_win) symbolMap[sym].wins++;
      symbolMap[sym].pnl += b.pnl_percent || 0;
    }
    const bySymbol = Object.entries(symbolMap).map(([symbol, data]) => ({
      symbol,
      trades: data.total,
      winRate: data.total > 0 ? Math.round((data.wins / data.total) * 10000) / 100 : 0,
      totalPnl: Math.round(data.pnl * 100) / 100,
    })).sort((a, b) => b.totalPnl - a.totalPnl);

    // By-direction breakdown
    const directionMap: Record<string, { wins: number; total: number; pnl: number }> = {};
    for (const b of (battles || [])) {
      const dir = b.direction || 'UNKNOWN';
      if (!directionMap[dir]) directionMap[dir] = { wins: 0, total: 0, pnl: 0 };
      directionMap[dir].total++;
      if (b.is_win) directionMap[dir].wins++;
      directionMap[dir].pnl += b.pnl_percent || 0;
    }
    const byDirection = Object.entries(directionMap).map(([direction, data]) => ({
      direction,
      trades: data.total,
      winRate: data.total > 0 ? Math.round((data.wins / data.total) * 10000) / 100 : 0,
      totalPnl: Math.round(data.pnl * 100) / 100,
    }));

    // Win/Loss streaks
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    for (const t of trades) {
      if (t.isWin) {
        currentWinStreak++;
        currentLossStreak = 0;
        maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
      } else {
        currentLossStreak++;
        currentWinStreak = 0;
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      }
    }

    return NextResponse.json({
      success: true,
      status: 'ok',
      data: {
        totalTrades: trades.length,
        winRate: trades.length > 0
          ? Math.round((trades.filter(t => t.isWin).length / trades.length) * 10000) / 100
          : 0,
        sharpeRatio: Math.round(sharpe * 100) / 100,
        sortinoRatio: Math.round(sortino * 100) / 100,
        expectancy: Math.round(expectancy * 100) / 100,
        consistency: Math.round(consistency * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        maxConsecutiveLosses,
        streaks: { maxWinStreak, maxLossStreak },
        equityCurvePoints: (equityData || []).length,
        bySymbol: bySymbol.slice(0, 20),
        byDirection,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Analytics endpoint error', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to compute analytics' },
      { status: 500 },
    );
  }
}
