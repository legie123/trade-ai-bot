import { TheButcher } from '@/lib/v2/gladiators/butcher';
import { TheForge } from '@/lib/v2/promoters/forge';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { saveGladiatorsToDb } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { postActivity } from '@/lib/moltbook/moltbookClient';
import { omegaExtractor } from '@/lib/v2/superai/omegaExtractor';
import { omegaEngine } from '@/lib/v2/superai/omegaEngine';

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
    // Refresh gladiators from Supabase (simulator no longer does its own refresh)
    const { refreshGladiatorsFromCloud } = await import('@/lib/store/db');
    await refreshGladiatorsFromCloud();
    gladiatorStore.reloadFromDb();
    await ArenaSimulator.getInstance().evaluatePhantomTrades();

    // 2. Absolute Execution of Weaklings (The Butcher)
    log.info('🛡️ [2/3] Executare Gladiatori Slabi (The Butcher)...');
    const executedIds = await TheButcher.getInstance().executeWeaklings();

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
    // INSTITUTIONAL RULE (QW-8 tightening, 2026-04-18):
    //   isLive cere tt>=50, WR>=40%, PF>=1.3 — sincronizat cu recalibrateRanks.
    // C14 (2026-04-20): WR 58→40 aligned with asymmetric TP=1.0%/SL=-0.5%.
    const gladiators = gladiatorStore.getLeaderboard();
    gladiators.forEach((g, idx) => {
      g.rank = idx + 1;
      const meetsThreshold = g.stats.totalTrades >= 50
        && g.stats.winRate >= 40
        && g.stats.profitFactor >= 1.3;
      g.isLive = g.rank <= 3 && meetsThreshold;
    });

    // CRITICAL FIX: Persist leaderboard changes to Supabase
    // Without this, rank/isLive changes are lost on cold start.
    saveGladiatorsToDb(gladiatorStore.getGladiators());
    log.info('🛡️ [Darwinian Cycle] Rotation Complete. Leaderboard persisted to DB.');

    // 5. Omega Meta-Learning Synthesis (FAZA 7)
    // Runs AFTER Forge so newly spawned gladiators are included in scoring
    log.info('⚡ [5/5] Omega Meta-Synthesis...');
    try {
      const omegaSynthesis = await omegaExtractor.synthesize();
      if (omegaSynthesis) {
        log.info(
          `⚡ [Omega] Synthesis OK: WR=${omegaSynthesis.aggregatedWR}% ` +
          `PF=${omegaSynthesis.aggregatedPF} modifier=${omegaSynthesis.globalModifier}x ` +
          `bias=${omegaSynthesis.directionBias} from ${omegaSynthesis.gladiatorsUsed} gladiators`
        );
      } else {
        log.info('⚡ [Omega] Insufficient data — Omega stays dormant, modifier=1.0x');
      }
    } catch (omegaErr) {
      // Non-blocking — Omega failure must never stop the daily rotation
      log.error('⚡ [Omega] Synthesis failed (non-critical)', { error: (omegaErr as Error).message });
    }

    // 6. OmegaEngine — Market Regime Detection (FAZA 7 extension)
    // Runs after synthesis so regime reflects fresh gladiator battle data
    try {
      const { regime, patterns, adaptiveThresholds } = await omegaEngine.analyze();
      log.info(
        `⚡ [OmegaEngine] Regime: ${regime.regime} (${(regime.confidence * 100).toFixed(0)}%) ` +
        `| Patterns: ${patterns.length} | PromoThreshold: ${adaptiveThresholds.promotionThreshold} ` +
        `| SignalMult: ${adaptiveThresholds.signalMultiplier}x`,
      );
    } catch (engineErr) {
      log.warn('⚡ [OmegaEngine] Regime analysis failed (non-critical)', { error: (engineErr as Error).message });
    }

    // 7. Broadcast to Moltbook
    const omegaSummary = omegaExtractor.getSummary();
    const message = `🏛️ [TRADE AI ARENA] Rulaj Zilnic Efectuat 🏛️\n\n` +
                    `S-au eliberat ${executedIds.length} slot-uri din arena (Performanță slabă).\n` +
                    `Forja AI a regenerat parametri noi de strategie.\n` +
                    `Gladiatorii de top continuă pe bani reali.\n` +
                    `⚡ ${omegaSummary}\n\n` +
                    `Evoluția nu iartă pe nimeni. #AlgorithmicTrading #AI`;

    await postActivity(message, undefined, 'crypto').catch((e) => log.warn('postActivity failed (daily rotation)', { error: String(e) }));

  } catch (error) {
    log.error('🚨 [Daily Rotation] Failed to execute cycle', { error: (error as Error).message });
  }
}

// Allow execution via basic node script structure if ran directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyRotation().then(() => process.exit(0));
}
