import { NextResponse } from 'next/server';
import { getStrategies, initDB } from '@/lib/store/db';
import { generateAndDeployNewStrategy } from '@/lib/engine/discoveryLLM';
import { runCloudBacktest, BacktestReport } from '@/lib/engine/cloudBacktester';
import { executeGladiatorRanking } from '@/lib/engine/rankEngine';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Cron-NightlyPrune');
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max execution time for API route

export async function GET(req: Request) {
  // Validate CRON_SECRET to prevent unauthorized execution
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    log.error('Unauthorized cron access attempt');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    log.info('Starting nightly auto-prune and self-healing loop...');
    await initDB();
    
    const activeStrategies = getStrategies();
    const reports: BacktestReport[] = [];
    
    // 1. 8-Month Simulation Layer for all active strategies
    log.info(`Running 8-month Deep Backtest on ${activeStrategies.length} active strategies...`);
    for (const strategy of activeStrategies) {
      const asset1 = strategy.targetAssets.length > 0 && strategy.targetAssets[0] !== 'ALL' ? strategy.targetAssets[0] : 'BTC';
      const asset2 = asset1 === 'BTC' ? 'SOL' : 'BTC';
      try {
        const report1 = await runCloudBacktest(strategy, asset1, 240);
        const report2 = await runCloudBacktest(strategy, asset2, 240);
        
        const totalTrades = report1.totalTrades + report2.totalTrades;
        const totalWins = report1.wins + report2.wins;
        const compositeWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
        
        const mergedReport: BacktestReport = {
          strategyId: strategy.id,
          asset: `${asset1}+${asset2}`,
          daysTested: Math.max(report1.daysTested, report2.daysTested),
          totalTrades,
          wins: totalWins,
          losses: report1.losses + report2.losses,
          winRate: compositeWinRate,
          pnlPercent: report1.pnlPercent + report2.pnlPercent,
          netProfit: report1.netProfit + report2.netProfit,
          profitFactor: (report1.profitFactor + report2.profitFactor) / 2,
          maxDrawdown: Math.max(report1.maxDrawdown, report2.maxDrawdown),
          stabilityScore: (report1.stabilityScore + report2.stabilityScore) / 2
        };
        
        reports.push(mergedReport);
      } catch (err) {
        log.error(`Multi-asset backtest failed for ${strategy.name}`, { error: String(err) });
      }
    }

    // 2. Gladiator Ranking & Auto-Pruning
    log.info(`Executing Gladiator Ranking...`);
    const { survivors, purgedIds } = executeGladiatorRanking(activeStrategies, reports);
    const prunedCount = purgedIds.length;

    // 3. Self-Healing Phase (Target = TOP 5)
    const TARGET_STRATEGIES = 5;
    const currentActive = activeStrategies.length - prunedCount;
    const missingSlots = TARGET_STRATEGIES - currentActive;
    let generatedCount = 0;

    if (missingSlots > 0) {
      log.info(`Self-healing needed. Missing ${missingSlots} strategies to reach TOP 5 target.`);
      
      // We generate exactly ONE per cron cycle to respect API execution limits
      log.info(`Triggering Internet Strategy Extractor LLM to fill an empty slot...`);
      const res = await generateAndDeployNewStrategy();
      
      if (res.success) {
        generatedCount++;
        log.info('Internet Extraction successful', { newStrategy: res.strategy?.name });
      } else {
        log.error('Internet Extraction failed', { message: res.message });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      survivorsCount: survivors.length,
      prunedCount,
      generatedCount,
      message: `Gladiator run complete. ${survivors.length} survived. ${prunedCount} culled. ${generatedCount} extracted.`
    });

  } catch (err) {
    log.error('Nightly Prune failed', { error: String(err) });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
