import { saveGladiatorsToDb } from '@/lib/store/db';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { createLogger } from '@/lib/core/logger';
import { Gladiator } from '../../types/gladiator';

const log = createLogger('TheButcher');

export class TheButcher {
  private static instance: TheButcher;

  private constructor() {}

  public static getInstance(): TheButcher {
    if (!TheButcher.instance) {
      TheButcher.instance = new TheButcher();
    }
    return TheButcher.instance;
  }

  /**
   * Evaluates all Gladiators and absolutely executes (deletes) any that
   * fail to meet the hard survival criteria.
   * Hard Survival Criteria:
   * - Must have > 20 trades.
   * - WinRate must be >= 40% (or Expectancy must be > 0).
   * 
   * Returns an array of IDs that were executed, so The Forge can replace them.
   */
  public executeWeaklings(): string[] {
    const gladiators = gladiatorStore.getGladiators();
    const survivors: Gladiator[] = [];
    const executions: string[] = [];

    for (const g of gladiators) {
      // Omega Gladiator is immune to The Butcher
      if (g.isOmega) {
        survivors.push(g);
        continue;
      }

      // If they haven't fought enough, they are still in probation
      if (g.stats.totalTrades < 20) {
        survivors.push(g);
        continue;
      }

      // Judgment Criteria (OR logic — fail ANY condition = elimination)
      const failsWinRate = g.stats.winRate < 40;
      const failsProfitFactor = g.stats.profitFactor < 1.0;
      const failsPnL = (g.stats as Record<string, unknown>).totalPnlPercent !== undefined && ((g.stats as Record<string, unknown>).totalPnlPercent as number) < -5;

      // Eliminate if FAILS win rate OR profit factor (Darwinian selection)
      const isWeak = failsWinRate || failsProfitFactor || failsPnL;

      if (isWeak) {
        log.warn(`[The Butcher] Executing Gladiator: ${g.name} (ID: ${g.id}) | Trades: ${g.stats.totalTrades} | WR: ${g.stats.winRate}% | PF: ${g.stats.profitFactor}`);
        executions.push(g.id);
      } else {
        survivors.push(g);
      }
    }

    if (executions.length > 0) {
      // Clean DB completely
      saveGladiatorsToDb(survivors);
      // Re-hydrate the store
      gladiatorStore.hydrate(survivors);
      log.info(`[The Butcher] Arena cleansed. ${executions.length} weak strategies were permanently deleted.`);
    } else {
      log.info(`[The Butcher] Execution complete. No weaklings found in the Arena today.`);
    }

    return executions;
  }
}
