import { saveGladiatorsToDb, getGladiatorBattles } from '@/lib/store/db';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { createLogger } from '@/lib/core/logger';
import { Gladiator } from '../../types/gladiator';
// FAZA A BATCH 1: domain metrics hook
import { metrics, safeInc } from '@/lib/observability/metrics';
// RUFLO FAZA 3 Batch 5/9 (2026-04-19): Survivorship fix.
// recordInGraveyard is feature-flagged (BUTCHER_GRAVEYARD_ENABLED) and
// fail-soft — if the migration hasn't been applied or Supabase is
// unreachable, it returns false and the existing kill path continues
// unchanged. See graveyard.ts for the full rationale.
import { recordInGraveyard, getGraveyardMode } from './graveyard';

const log = createLogger('TheButcher');

// RUFLO FAZA 3 Batch 4 (C8) 2026-04-19: Wilson score interval lower bound.
// Previous Butcher used raw WR<40 at n>=20 — at n=20 this has 95% CI that
// easily spans from 20% to 60%, so killing at raw 40 is statistically
// indefensible (false positives: kill legit gladiators on unlucky streak).
//
// wilsonLower = (p + z²/2n - z*sqrt((p(1-p)+z²/4n)/n)) / (1 + z²/n)
// z = 1.96 → 95% confidence.
// Example: 8 wins / 20 trades = 40% raw WR
//   wilsonLower ≈ 0.217 → killer would NOT fire (need more trades)
// Example: 15 wins / 50 trades = 30% raw WR
//   wilsonLower ≈ 0.185 → kill (sustained underperformance)
function wilsonLower(successes: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (center - margin) / denom;
}

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
    // RUFLO FAZA 3 Batch 5/9: capture (gladiator, reason) for graveyard.
    // Parallel array — does not change existing executions:string[] return.
    const killedDetails: { g: Gladiator; reason: string }[] = [];

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

      // RUFLO FAZA 3 Batch 4 (C8) 2026-04-19: Wilson CI lower bound.
      // Old raw thresholds at n=20 have 95% CI ~ ±20pp — statistically
      // unsafe for kill decisions. New: require n>=30 for kill and use
      // Wilson lower bound for WR (even pessimistic estimate must fail).
      // PF threshold kept at 1.0 but n-gated to avoid small-sample PF noise.
      // Kill-switch: env BUTCHER_USE_WILSON=0 reverts to raw formula.
      const useWilson = process.env.BUTCHER_USE_WILSON !== '0';
      const MIN_N_FOR_KILL = 30;

      // Judgment Criteria (OR logic — fail ANY condition = elimination)
      let failsWinRate: boolean;
      let failsProfitFactor: boolean;
      if (useWilson) {
        // Require larger sample + Wilson lower bound < 0.35 (= 35%)
        // i.e. even 95% pessimistic WR estimate is below 35
        const wins = Math.round((g.stats.winRate / 100) * g.stats.totalTrades);
        const wrLower = wilsonLower(wins, g.stats.totalTrades);
        failsWinRate = g.stats.totalTrades >= MIN_N_FOR_KILL && wrLower < 0.35;
        // PF: require same min n to avoid single-loss-ratio skew
        failsProfitFactor = g.stats.totalTrades >= MIN_N_FOR_KILL && g.stats.profitFactor < 1.0;
      } else {
        failsWinRate = g.stats.winRate < 40;
        failsProfitFactor = g.stats.profitFactor < 1.0;
      }
      const failsPnL = (g.stats as Record<string, unknown>).totalPnlPercent !== undefined && ((g.stats as Record<string, unknown>).totalPnlPercent as number) < -5;

      // R4b: anti-memorization
      const memo = await this.isMemorized(g.id);

      // Eliminate if FAILS win rate OR profit factor OR memorized
      const isWeak = failsWinRate || failsProfitFactor || failsPnL || memo.memorized;

      if (isWeak) {
        const memoTag = memo.memorized ? ` | MEMORIZED: ${memo.reason}` : '';
        log.warn(`[The Butcher] Executing Gladiator: ${g.name} (ID: ${g.id}) | Trades: ${g.stats.totalTrades} | WR: ${g.stats.winRate}% | PF: ${g.stats.profitFactor}${memoTag}`);
        executions.push(g.id);
        // RUFLO FAZA 3 Batch 5/9: build a structured kill reason for graveyard.
        // Composition lets downstream forensics aggregate by kill_reason
        // prefix without parsing free text.
        const reasonParts: string[] = [];
        if (failsWinRate) reasonParts.push('WR_FAIL');
        if (failsProfitFactor) reasonParts.push('PF_FAIL');
        if (failsPnL) reasonParts.push('PNL_FAIL');
        if (memo.memorized) reasonParts.push('MEMORIZED');
        const reason = `${reasonParts.join('+')} | n=${g.stats.totalTrades} WR=${g.stats.winRate} PF=${g.stats.profitFactor}${memoTag}`;
        killedDetails.push({ g, reason });
        // FAZA A BATCH 1: emit metric per kill (reason=dominant failure; mode=shadow|live via env)
        const dominantReason = reasonParts[0] || 'UNKNOWN';
        const butcherMode = process.env.BUTCHER_GRAVEYARD_ENABLED === 'on' ? 'live' : 'shadow';
        safeInc(metrics.gladiatorKills, { reason: dominantReason, mode: butcherMode });
      } else {
        survivors.push(g);
      }
    }

    if (executions.length > 0) {
      // RUFLO FAZA 3 Batch 5/9: graveyard write BEFORE purge.
      // Sequenced before saveGladiatorsToDb so a graveyard write failure
      // does NOT block the kill flow (recordInGraveyard is fail-soft and
      // returns false rather than throwing). If mode='off' the loop is
      // a no-op (cheap early-return inside recordInGraveyard).
      const gMode = getGraveyardMode();
      if (gMode !== 'off' && killedDetails.length > 0) {
        let recorded = 0;
        for (const { g, reason } of killedDetails) {
          try {
            const ok = await recordInGraveyard(g, reason);
            if (ok) recorded += 1;
          } catch (err) {
            log.warn(`[Butcher] graveyard record threw for ${g.id} — ignored`, { err: String(err) });
          }
        }
        log.info(`[The Butcher] Graveyard recorded ${recorded}/${killedDetails.length} (mode=${gMode}).`);
      }

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
