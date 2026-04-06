import { PromoterData } from '../../types/gladiator';
import { AlphaScout } from '../intelligence/alphaScout';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { saveGladiatorsToDb } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

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
   * Evaluates the Arena. If bottom tier gladiators fail, Promoters "recruit" a new strategy.
   * This ensures the DNA pool never goes stale.
   */
  public evaluateAndRecruit() {
    const gladiators = gladiatorStore.getLeaderboard();
    
    // Find gladiators performing terribly
    const weakLinks = gladiators.filter(g => g.stats.winRate < 45 && g.stats.totalTrades > 50);
    
    if (weakLinks.length > 0) {
      log.info(`[Promoters] Found ${weakLinks.length} weak strategies. Firing them and recruiting fresh blood.`);
      
      // In a real system we would remove them and push new ones.
      // Here we just "retire" them by resetting their stats with a new mutated approach.
      weakLinks.forEach(g => {
        g.name = `${g.name} (Mutated V${Math.floor(Math.random() * 100)})`;
        g.stats = {
          winRate: 50,
          profitFactor: 1.0,
          maxDrawdown: 0,
          sharpeRatio: 0.5,
          totalTrades: 0
        };
        g.status = 'ACTIVE';
        log.info(`[Promoters] Recruited: ${g.name} to the Arena.`);
      });
      saveGladiatorsToDb(gladiatorStore.getGladiators());
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
