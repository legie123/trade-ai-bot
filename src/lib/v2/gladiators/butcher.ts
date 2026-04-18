import { saveGladiatorsToDb, getGladiatorBattles } from '@/lib/store/db';
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
   * R4b (2026-04-18) — Anti-memorization detector.
   *
   * Flags gladiators that concentrated >=60% of their recent trades on a
   * single (symbol, direction) bucket AND achieved WR>80% there. That shape
   * is regime-bet, not edge: when the regime flips, the gladiator detonates
   * because the entire PnL stream sits on one memorized combo.
   *
   * Why 60% + 80%: both thresholds tuned from C14 stratification — specialist
   * gladiators (by design diverse DNA) should show <50% concentration on any
   * single combo; >=60% is already overfit. WR>80% on a single-combo
   * concentration is statistically incompatible with a generalizing signal.
   *
   * Fail-closed on empty data: if getGladiatorBattles returns nothing, we
   * return false (not memorized) so bootstrap does not over-kill new gladiators.
   *
   * Kill-switch: env R4_ANTIMEMO_OFF=1 disables the check entirely.
   */
  private async isMemorized(gladiatorId: string): Promise<{ memorized: boolean; reason?: string }> {
    if (process.env.R4_ANTIMEMO_OFF === '1') return { memorized: false };
    try {
      const battles = await getGladiatorBattles(gladiatorId, 200);
      if (!battles || battles.length < 20) return { memorized: false };

      const buckets = new Map<string, { n: number; wins: number }>();
      for (const b of battles) {
        const sym = String((b as Record<string, unknown>).symbol || 'UNK');
        const dir = String((b as Record<string, unknown>).decision || 'UNK').toUpperCase();
        const key = `${sym}|${dir}`;
        const cur = buckets.get(key) || { n: 0, wins: 0 };
        cur.n += 1;
        if ((b as Record<string, unknown>).isWin === true) cur.wins += 1;
        buckets.set(key, cur);
      }

      const total = battles.length;
      for (const [key, agg] of buckets) {
        const concentration = agg.n / total;
        const wr = agg.n > 0 ? agg.wins / agg.n : 0;
        if (concentration >= 0.6 && wr > 0.8) {
          return { memorized: true, reason: `${key} conc=${(concentration*100).toFixed(0)}% WR=${(wr*100).toFixed(0)}% n=${agg.n}/${total}` };
        }
      }
      return { memorized: false };
    } catch (err) {
      log.warn(`[Butcher] anti-memo check failed for ${gladiatorId} — skipping (fail-closed)`, { error: String(err) });
      return { memorized: false };
    }
  }

  /**
   * Evaluates all Gladiators and absolutely executes (deletes) any that
   * fail to meet the hard survival criteria.
   * Hard Survival Criteria:
   * - Must have > 20 trades.
   * - WinRate must be >= 40% (or Expectancy must be > 0).
   * - R4b: NOT memorized (single combo conc>=60% + WR>80%).
   *
   * Returns an array of IDs that were executed, so The Forge can replace them.
   */
  public async executeWeaklings(): Promise<string[]> {
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

      // R4b: anti-memorization
      const memo = await this.isMemorized(g.id);

      // Eliminate if FAILS win rate OR profit factor OR memorized
      const isWeak = failsWinRate || failsProfitFactor || failsPnL || memo.memorized;

      if (isWeak) {
        const memoTag = memo.memorized ? ` | MEMORIZED: ${memo.reason}` : '';
        log.warn(`[The Butcher] Executing Gladiator: ${g.name} (ID: ${g.id}) | Trades: ${g.stats.totalTrades} | WR: ${g.stats.winRate}% | PF: ${g.stats.profitFactor}${memoTag}`);
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
