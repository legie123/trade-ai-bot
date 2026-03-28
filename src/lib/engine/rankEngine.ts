import { TradingStrategy } from '@/lib/types/strategy';
import { BacktestReport } from '@/lib/engine/cloudBacktester';
import { removeStrategy } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('RankEngine');

export interface RankedStrategy {
  strategy: TradingStrategy;
  report: BacktestReport;
  rankScore: number;
}

/**
 * Evaluates a list of backtest reports, ranks them, and culls the weak ones.
 * Keeps ONLY the TOP 5. Anything below 90% WR or with high drawdown is purged.
 */
export function executeGladiatorRanking(
  activeStrategies: TradingStrategy[],
  reports: BacktestReport[]
): { survivors: RankedStrategy[]; purgedIds: string[] } {
  
  const ranked: RankedStrategy[] = [];
  const purgedIds: string[] = [];

  for (const strategy of activeStrategies) {
    const report = reports.find(r => r.strategyId === strategy.id);
    if (!report) {
      log.warn(`RankEngine: Strategy ${strategy.name} has no report, purging.`);
      removeStrategy(strategy.id);
      purgedIds.push(strategy.id);
      continue;
    }

    // STRICT RULES
    let isPurged = false;
    let purgeReason = '';

    if (report.winRate < 90) {
      isPurged = true;
      purgeReason = `Sub-90% Win Rate (${report.winRate}%)`;
    } else if (report.maxDrawdown > 15) {
      isPurged = true;
      purgeReason = `Massive Drawdown (${report.maxDrawdown}%)`;
    } else if (report.profitFactor < 1.5) {
      isPurged = true;
      purgeReason = `Unstable Profit Factor (${report.profitFactor})`;
    } else if (report.totalTrades < 5) {
      isPurged = true;
      purgeReason = `Too few trades (${report.totalTrades}) in 8 months`;
    }

    if (isPurged) {
      log.warn(`RankEngine: Purging ${strategy.name} - ${purgeReason}`);
      removeStrategy(strategy.id);
      purgedIds.push(strategy.id);
    } else {
      // Calculate composite rank score
      // Weight: Win Rate (60%), Stability Score (20%), Profit Factor (20%)
      const rankScore = (report.winRate * 0.6) + (report.stabilityScore * 0.2) + (Math.min(report.profitFactor, 5) * 4);
      ranked.push({ strategy, report, rankScore });
    }
  }

  // Sort descending by rankScore
  ranked.sort((a, b) => b.rankScore - a.rankScore);

  // Preserve only Top 5
  if (ranked.length > 5) {
    const losers = ranked.splice(5);
    for (const loser of losers) {
      log.warn(`RankEngine: Purging ${loser.strategy.name} - Dropped out of TOP 5 (Rank Score: ${loser.rankScore.toFixed(2)})`);
      removeStrategy(loser.strategy.id);
      purgedIds.push(loser.strategy.id);
    }
  }

  log.info(`RankEngine: Survival of the fittest complete. ${ranked.length} survived, ${purgedIds.length} purged.`);
  return { survivors: ranked, purgedIds };
}
