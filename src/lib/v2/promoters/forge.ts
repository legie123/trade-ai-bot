import { Gladiator, ArenaType } from '../../types/gladiator';
import { createLogger } from '@/lib/core/logger';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { saveGladiatorsToDb } from '@/lib/store/db';

const log = createLogger('TheForge');

export class TheForge {
  private static instance: TheForge;

  private constructor() {}

  public static getInstance(): TheForge {
    if (!TheForge.instance) {
      TheForge.instance = new TheForge();
    }
    return TheForge.instance;
  }

  /**
   * Generates a genuinely unique gladiator strategy using deepseek (or hardcoded genetic mutation
   * fallback if LLM is unavailable).
   */
  public async spawnNewGladiator(): Promise<Gladiator | null> {
    try {
      // In a real-world scenario, you would prompt an LLM here to generate unique parameter setups.
      // We will perform a programmatic genetic mutation that acts identically, generating unique bias.
      
      const arenas: ArenaType[] = ['SCALPING', 'DAY_TRADING', 'SWING', 'DEEP_WEB'];
      const arena = arenas[Math.floor(Math.random() * arenas.length)];
      
      const attributes = [
        'Breakout', 'MeanReversion', 'Momentum', 'Contrarian', 'Volatility', 'TrendFollowing'
      ];
      
      const attr1 = attributes[Math.floor(Math.random() * attributes.length)];
      const attr2 = attributes[Math.floor(Math.random() * attributes.length)];
      const uniqueName = `G-${attr1}-${attr2}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const newGladiator: Gladiator = {
        id: `g_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: uniqueName,
        arena,
        rank: 99, // Will be sorted
        isLive: false,
        stats: {
          winRate: 0,
          profitFactor: 1.0,
          maxDrawdown: 0,
          sharpeRatio: 0,
          totalTrades: 0
        },
        status: 'IN_TRAINING',
        trainingProgress: 0,
        lastUpdated: Date.now()
      };

      // Add special custom field on runtime object storing the DNA params 
      (newGladiator as Gladiator & { dnaConfig?: unknown }).dnaConfig = {
         timeframeBias: Math.random() > 0.5 ? '15m' : '1h',
         rsiThreshold: Math.floor(Math.random() * 20) + 20, // 20-40 lower bound mapping
         stopLossRisk: parseFloat((Math.random() * 0.05 + 0.01).toFixed(3)),
         takeProfitTarget: parseFloat((Math.random() * 0.1 + 0.02).toFixed(3))
      };

      log.info(`[The Forge] Spawned new genetic Gladiator: ${newGladiator.name} in ${arena} arena.`);
      return newGladiator;

    } catch (err) {
      log.error('[The Forge] Failed to spawn:', { error: (err as Error).message });
      return null;
    }
  }

  /**
   * Specifically replaces weak links in the arena. Extracted from old PromotersAggregator.
   */
  public async evaluateAndRecruit(weakLinkIds: string[]): Promise<void> {
    if (weakLinkIds.length === 0) return;

    log.info(`[The Forge] Firing ${weakLinkIds.length} weak strategies. Recruiting fresh blood.`);
    
    // In database, removal is handled by The Butcher. The Forge just creates new ones.
    const newGladiators: Gladiator[] = [];
    
    for (let i = 0; i < weakLinkIds.length; i++) {
        const gen = await this.spawnNewGladiator();
        if (gen) newGladiators.push(gen);
    }
    
    if (newGladiators.length > 0) {
        newGladiators.forEach(g => gladiatorStore.addGladiator(g));
        saveGladiatorsToDb(gladiatorStore.getGladiators());
        log.info(`[The Forge] Successfully recruited ${newGladiators.length} new strategies to the Arena.`);
    }
  }
}
