import { NextResponse } from 'next/server';
import { runBacktest } from '@/lib/engine/backtester';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbolFilter = url.searchParams.get('symbol'); // e.g. "BTC" or "SOL"
  
  // Grid Search Parameters
  const risks = [2, 3, 5]; // 2%, 3%, 5% risk per trade
  const takeProfits = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0];
  const stopLosses = [0.5, 1.0, 1.5, 2.0];
  const confidences = [70, 80, 85, 90, 95];
  
  const results = [];
  
  // Total iterations = 3 * 6 * 4 * 5 = 360 combinations
  for (const r of risks) {
    for (const tp of takeProfits) {
      for (const sl of stopLosses) {
        for (const c of confidences) {
          
          // No specific symbol filtering supported yet in the sweep loop
          if (symbolFilter) {
            // Placeholder for future DB hooks
          }

          const res = runBacktest({
            startBalance: 1000,
            riskPerTrade: r,
            takeProfitPercent: tp,
            stopLossPercent: sl,
            minConfidence: c
          });
          
          // Only consider setups that actually traded something
          if (res.stats.totalTrades > 5) {
            results.push({
               config: { risk: r, tp, sl, minConf: c },
               trades: res.stats.totalTrades,
               winRate: res.stats.winRate,
               profitFactor: res.stats.profitFactor,
               netProfit: res.stats.totalPnlPercent,
               maxDrawdown: res.stats.maxDrawdownPercent,
               sharpe: res.stats.sharpeApprox,
               score: (res.stats.winRate * res.stats.profitFactor) - res.stats.maxDrawdownPercent
            });
          }
        }
      }
    }
  }

  // Sort by mathematically stable scoring system (ProfitFactor + WinRate penalty for DD)
  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    totalCombinationsTested: risks.length * takeProfits.length * stopLosses.length * confidences.length,
    validStrategies: results.length,
    topStrategies: results.slice(0, 10)
  });
}
