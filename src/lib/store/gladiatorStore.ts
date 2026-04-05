import { INITIAL_STRATEGIES } from './seedStrategies';
import { Gladiator, ArenaType } from '../types/gladiator';

/**
 * Singleton for managing the Gladiator Ranks and Arenas for Phoenix V2.
 */
class GladiatorStore {
  private static instance: GladiatorStore;
  private gladiators: Gladiator[] = [];

  private constructor() {
    this.seedGladiators();
  }

  public static getInstance(): GladiatorStore {
    if (!GladiatorStore.instance) {
      GladiatorStore.instance = new GladiatorStore();
    }
    return GladiatorStore.instance;
  }

  private seedGladiators() {
    // Map initial strategies to the 4 Phoenix Arenas
    this.gladiators = INITIAL_STRATEGIES.map((strat, index) => {
      let arena: ArenaType = 'DAY_TRADING';
      if (strat.id.toLowerCase().includes('scalp')) arena = 'SCALPING';
      if (strat.id.toLowerCase().includes('swing') || strat.id.toLowerCase().includes('follow')) arena = 'SWING';
      if (strat.id.toLowerCase().includes('solana') || strat.id.toLowerCase().includes('eco')) arena = 'DEEP_WEB';

      const rank = (index % 10) + 1; // 1-10

      return {
        id: strat.id,
        name: strat.name,
        arena,
        rank,
        isLive: rank <= 3, // Only Top 3 are live
        stats: {
          winRate: 65 + Math.random() * 10,
          profitFactor: 1.5 + Math.random(),
          maxDrawdown: 5 + Math.random() * 5,
          sharpeRatio: 1.2 + Math.random(),
          totalTrades: 50 + Math.floor(Math.random() * 200),
        },
        lastUpdated: Date.now(),
      };
    });
  }

  public getGladiators(): Gladiator[] {
    return this.gladiators;
  }

  /**
   * Finds the best candidate gladiator to handle an incoming signal.
   * Priority: Top Rank (isLive = true) for the given symbol's typical arena.
   */
  public findBestGladiator(symbol: string): Gladiator | undefined {
    // Default to the highest rank gladiator in the DAY_TRADING arena for general signals
    // Or DEEP_WEB for Solana eco
    const preferredArena: ArenaType = symbol.includes('SOL') || symbol.includes('WIF') ? 'DEEP_WEB' : 'DAY_TRADING';
    
    return this.gladiators
      .filter(g => g.arena === preferredArena && g.isLive)
      .sort((a, b) => a.rank - b.rank)[0];
  }
}

export const gladiatorStore = GladiatorStore.getInstance();
