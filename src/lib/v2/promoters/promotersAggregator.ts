import { PromoterData } from '../../types/gladiator';
import { AlphaScout } from '../intelligence/alphaScout';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { createLogger } from '@/lib/core/logger';
import { TheButcher } from '../gladiators/butcher';
import { TheForge } from './forge';

const log = createLogger('PromoterRecruiter');

export class PromotersAggregator {
  private static instance: PromotersAggregator;
  private alphaScout: AlphaScout;

  private constructor() {
    this.alphaScout = AlphaScout.getInstance();
  }

  public static getInstance(): PromotersAggregator {
    if (!PromotersAggregator.instance) {
      PromotersAggregator.instance = new PromotersAggregator();
    }
    return PromotersAggregator.instance;
  }

  /**
   * Fetches and aggregates signals from all promoter sources.
   */
  public async getActiveSignals(): Promise<PromoterData[]> {
    try {
      return await this.alphaScout.getMarketSignals();
    } catch (err) {
      log.error('[Promoters] Failed to aggregate signals:', { error: (err as Error).message });
      return [];
    }
  }

  /**
   * Evaluates the Arena. Weak gladiators are executed by The Butcher.
   * New mutations are spawned via The Forge.
   */
  public async evaluateAndRecruit() {
    // 1. Absolute Execution
    const executedIds = TheButcher.getInstance().executeWeaklings();
    
    if (executedIds.length > 0) {
      log.info(`[Promoters] The Butcher eliminated ${executedIds.length} strategies. Initiating new recruitment.`);
      
      // 2. Genuine Genetic Mutation
      await TheForge.getInstance().evaluateAndRecruit(executedIds);
    } else {
      log.info(`[Promoters] Arena crop is healthy. No new recruitment needed today.`);
    }
  }

  /**
   * Generates a broadcast message for Moltbook tracking the Top 3 Gladiators.
   */
  public async broadcastArenaStatus(): Promise<string> {
    const gladiators = gladiatorStore.getLeaderboard().slice(0, 3);
    
    let message = `🏆 [Trade AI Arena] Daily Broadcast 🏆\n\n`;
    message += `Top Gladiators performing right now:\n`;
    
    gladiators.forEach((g, idx) => {
      const mode = g.isLive ? '🔴 LIVE' : '👻 SHADOW';
      message += `${idx + 1}. ${g.name} (${mode})\n`;
      message += `   WR: ${g.stats.winRate.toFixed(1)}% | PF: ${g.stats.profitFactor.toFixed(2)}\n`;
      const rankReason = (g as unknown as Record<string, unknown>).rankReason;
      if (rankReason) message += `   💡 ${rankReason}\n\n`;
    });

    log.info(`[Promoters] Broadcasting to Moltbook:\n${message}`);
    // Future: Integrate molbook / openclaw API endpoint here
    return message;
  }
}
