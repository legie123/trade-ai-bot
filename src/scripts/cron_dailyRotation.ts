import { TheButcher } from '@/lib/v2/gladiators/butcher';
import { TheForge } from '@/lib/v2/promoters/forge';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { saveGladiatorsToDb } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { postActivity } from '@/lib/moltbook/moltbookClient';

const log = createLogger('DailyRotation');

/**
 * Executes the Darwinian cycle for the Gladiator Arena.
 * Recommended schedule: Nightly at 00:00 UTC
 */
export async function runDailyRotation() {
  log.info('🛡️ [Darwinian Cycle] Initiating Daily Arena Rotation...');

  try {
    // 1. Force evaluate any lingering Phantom Trades
    log.info('🛡️ [1/3] Evaluare Phantom Trades Curente...');
    await ArenaSimulator.getInstance().evaluatePhantomTrades();

    // 2. Absolute Execution of Weaklings (The Butcher)
    log.info('🛡️ [2/3] Executare Gladiatori Slabi (The Butcher)...');
    const executedIds = TheButcher.getInstance().executeWeaklings();

    if (executedIds.length > 0) {
      log.info(`🛡️ Butcher executed ${executedIds.length} strategies. Initiating Forge.`);
    } else {
      log.info(`🛡️ No executions today. All gladiators passed the survival threshold.`);
    }

    // 3. Genuine Genetic Mutation for executed spots (The Forge)
    log.info('🛡️ [3/3] Generare ADN Nou (The Forge)...');
    if (executedIds.length > 0) {
       await TheForge.getInstance().evaluateAndRecruit(executedIds);
    }

    // 4. Update the Leaderboard Live status
    // INSTITUTIONAL RULE: isLive requires 20+ trades, WR >= 45%, PF >= 1.1 (hardened thresholds)
    const gladiators = gladiatorStore.getLeaderboard();
    gladiators.forEach((g, idx) => {
      g.rank = idx + 1;
      const meetsThreshold = g.stats.totalTrades >= 20
        && g.stats.winRate >= 45
        && g.stats.profitFactor >= 1.1;
      g.isLive = g.rank <= 3 && meetsThreshold;
    });

    // CRITICAL FIX: Persist leaderboard changes to Supabase
    // Without this, rank/isLive changes are lost on cold start.
    saveGladiatorsToDb(gladiatorStore.getGladiators());
    log.info('🛡️ [Darwinian Cycle] Rotation Complete. Leaderboard persisted to DB.');

    // 5. Broadcast to Moltbook
    const message = `🏛️ [TRADE AI ARENA] Rulaj Zilnic Efectuat 🏛️\n\n` + 
                    `S-au eliberat ${executedIds.length} slot-uri din arena (Performanță slabă).\n` +
                    `Forja AI a regenerat parametri noi de strategie.\n` +
                    `Gladiatorii de top continuă pe bani reali.\n\n` + 
                    `Evoluția nu iartă pe nimeni. #AlgorithmicTrading #AI`;
    
    await postActivity(message, undefined, 'crypto').catch(() => {});

  } catch (error) {
    log.error('🚨 [Daily Rotation] Failed to execute cycle', { error: (error as Error).message });
  }
}

// Allow execution via basic node script structure if ran directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyRotation().then(() => process.exit(0));
}
