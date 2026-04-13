// ============================================================
// Performance Analytics API — Equity curve, Drawdown, Sharpe, PnL
// GET /api/v2/analytics?gladiatorId=X&period=30d
// ============================================================
import { NextResponse } from 'next/server';
import { getGladiatorsFromDb, getGladiatorBattles } from '@/lib/store/db';

export const dynamic = 'force-dynamic';

interface TradeRecord {
  pnlPercent: number;
  timestamp: number;
  symbol: string;
  direction: string;
  result: 'WIN' | 'LOSS';
}

interface AnalyticsResult {
  gladiatorId: string;
  gladiatorName: string;
  period: string;
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;        // avg return per trade
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  equityCurve: { timestamp: number; equity: number }[];
  drawdownCurve: { timestamp: number; drawdown: number }[];
  winStreak: number;
  lossStreak: number;
  bestTrade: number;
  worstTrade: number;
  avgWin: number;
  avgLoss: number;
  tradesBySymbol: Record<string, { count: number; winRate: number; pnl: number }>;
  tradesByDirection: Record<string, { count: number; winRate: number }>;
}

function parseTrades(battles: Record<string, unknown>[]): TradeRecord[] {
  return battles
    .filter(b => typeof b.pnl_percent === 'number' || typeof b.pnlPercent === 'number')
    .map(b => ({
      pnlPercent: (b.pnl_percent as number) ?? (b.pnlPercent as number) ?? 0,
      timestamp: (b.created_at ? new Date(b.created_at as string).getTime() : (b.timestamp as number)) ?? Date.now(),
      symbol: (b.symbol as string) ?? 'UNKNOWN',
      direction: (b.direction as string) ?? (b.signal as string) ?? 'UNKNOWN',
      result: ((b.pnl_percent as number) ?? (b.pnlPercent as number) ?? 0) >= 0 ? 'WIN' as const : 'LOSS' as const,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function computeAnalytics(gladiatorId: string, gladiatorName: string, trades: TradeRecord[], period: string): AnalyticsResult {
  if (trades.length === 0) {
    return {
      gladiatorId, gladiatorName, period,
      trades: 0, winRate: 0, profitFactor: 0, expectancy: 0,
      sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, currentDrawdown: 0,
      equityCurve: [], drawdownCurve: [],
      winStreak: 0, lossStreak: 0, bestTrade: 0, worstTrade: 0,
      avgWin: 0, avgLoss: 0, tradesBySymbol: {}, tradesByDirection: {},
    };
  }

  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');
  const returns = trades.map(t => t.pnlPercent);

  // Basic stats
  const winRate = (wins.length / trades.length) * 100;
  const grossProfit = wins.reduce((s, t) => s + t.pnlPercent, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPercent, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const expectancy = returns.reduce((s, r) => s + r, 0) / returns.length;

  // Sharpe Ratio (annualized, assuming daily trades)
  const mean = expectancy;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  // Sortino Ratio (only downside deviation)
  const downsideReturns = returns.filter(r => r < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / downsideReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVariance);
  const sortinoRatio = downsideDev > 0 ? (mean / downsideDev) * Math.sqrt(252) : 0;

  // Equity curve + drawdown
  let equity = 100;
  let peak = 100;
  let maxDD = 0;
  const equityCurve: { timestamp: number; equity: number }[] = [];
  const drawdownCurve: { timestamp: number; drawdown: number }[] = [];

  for (const trade of trades) {
    equity *= (1 + trade.pnlPercent / 100);
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push({ timestamp: trade.timestamp, equity: Math.round(equity * 100) / 100 });
    drawdownCurve.push({ timestamp: trade.timestamp, drawdown: Math.round(dd * 100) / 100 });
  }
  const currentDrawdown = ((peak - equity) / peak) * 100;

  // Streaks
  let winStreak = 0, lossStreak = 0, curWin = 0, curLoss = 0;
  for (const t of trades) {
    if (t.result === 'WIN') { curWin++; curLoss = 0; winStreak = Math.max(winStreak, curWin); }
    else { curLoss++; curWin = 0; lossStreak = Math.max(lossStreak, curLoss); }
  }

  // Best/worst
  const bestTrade = Math.max(...returns);
  const worstTrade = Math.min(...returns);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPercent, 0) / losses.length : 0;

  // By symbol
  const tradesBySymbol: Record<string, { count: number; winRate: number; pnl: number }> = {};
  for (const t of trades) {
    if (!tradesBySymbol[t.symbol]) tradesBySymbol[t.symbol] = { count: 0, winRate: 0, pnl: 0 };
    tradesBySymbol[t.symbol].count++;
    tradesBySymbol[t.symbol].pnl += t.pnlPercent;
  }
  for (const sym of Object.keys(tradesBySymbol)) {
    const symTrades = trades.filter(t => t.symbol === sym);
    tradesBySymbol[sym].winRate = (symTrades.filter(t => t.result === 'WIN').length / symTrades.length) * 100;
  }

  // By direction
  const tradesByDirection: Record<string, { count: number; winRate: number }> = {};
  for (const t of trades) {
    if (!tradesByDirection[t.direction]) tradesByDirection[t.direction] = { count: 0, winRate: 0 };
    tradesByDirection[t.direction].count++;
  }
  for (const dir of Object.keys(tradesByDirection)) {
    const dirTrades = trades.filter(t => t.direction === dir);
    tradesByDirection[dir].winRate = (dirTrades.filter(t => t.result === 'WIN').length / dirTrades.length) * 100;
  }

  return {
    gladiatorId, gladiatorName, period,
    trades: trades.length,
    winRate: Math.round(winRate * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 1000) / 1000,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    sortinoRatio: Math.round(sortinoRatio * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    currentDrawdown: Math.round(currentDrawdown * 100) / 100,
    equityCurve,
    drawdownCurve,
    winStreak, lossStreak,
    bestTrade: Math.round(bestTrade * 1000) / 1000,
    worstTrade: Math.round(worstTrade * 1000) / 1000,
    avgWin: Math.round(avgWin * 1000) / 1000,
    avgLoss: Math.round(avgLoss * 1000) / 1000,
    tradesBySymbol,
    tradesByDirection,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gladiatorId = searchParams.get('gladiatorId');
  const period = searchParams.get('period') || '30d';

  // Period filter
  const periodDays = parseInt(period.replace('d', '')) || 30;
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;

  try {
    if (gladiatorId) {
      // Single gladiator analytics
      const gladiators = getGladiatorsFromDb();
      const gladiator = gladiators.find(g => g.id === gladiatorId);
      if (!gladiator) {
        return NextResponse.json({ error: 'Gladiator not found' }, { status: 404 });
      }

      const battles = await getGladiatorBattles(gladiatorId, 500);
      const trades = parseTrades(battles).filter(t => t.timestamp >= cutoff);
      const analytics = computeAnalytics(gladiatorId, gladiator.name, trades, period);

      return NextResponse.json(analytics);
    }

    // All gladiators summary
    const gladiators = getGladiatorsFromDb();
    const summaries = await Promise.all(
      gladiators.map(async (g) => {
        const battles = await getGladiatorBattles(g.id, 500);
        const trades = parseTrades(battles).filter(t => t.timestamp >= cutoff);
        const analytics = computeAnalytics(g.id, g.name, trades, period);
        // Return summary (no curves for bulk)
        const { equityCurve, drawdownCurve, ...summary } = analytics;
        return { ...summary, isLive: g.isLive, arena: g.arena };
      })
    );

    // Global aggregated stats
    const allTrades = summaries.reduce((s, g) => s + g.trades, 0);
    const avgWinRate = summaries.length > 0
      ? summaries.reduce((s, g) => s + g.winRate, 0) / summaries.length
      : 0;

    return NextResponse.json({
      period,
      globalStats: {
        totalGladiators: gladiators.length,
        liveGladiators: gladiators.filter(g => g.isLive).length,
        totalTrades: allTrades,
        avgWinRate: Math.round(avgWinRate * 100) / 100,
      },
      gladiators: summaries,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({
      error: (err as Error).message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
