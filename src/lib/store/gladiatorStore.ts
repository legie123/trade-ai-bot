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

    // Seed the ultimate Omega Gladiator
    this.gladiators.push({
      id: 'OMEGA-GLADIATOR',
      name: 'Super-AI (Omega)',
      arena: 'DAY_TRADING', // Can be any arena
      rank: 0, // God rank
      isLive: false,
      isOmega: true,
      status: 'IN_TRAINING',
      trainingProgress: 0,
      stats: {
        winRate: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        totalTrades: 0,
      },
      lastUpdated: Date.now(),
    });
  }

  public getGladiators(): Gladiator[] {
    return this.gladiators;
  }

  public getLeaderboard(): Gladiator[] {
    return this.gladiators
      .filter(g => !g.isOmega)
      .sort((a, b) => b.stats.winRate - a.stats.winRate);
  }

  public updateGladiatorStats(id: string, tick: { pnlPercent: number, isWin: boolean }) {
    const gladiator = this.gladiators.find(g => g.id === id);
    if (!gladiator) return;
    
    gladiator.stats.totalTrades += 1;
    if (tick.isWin) {
      // rough approx for winrate update
      const total = gladiator.stats.totalTrades;
      const prevWins = (gladiator.stats.winRate / 100) * (total - 1);
      gladiator.stats.winRate = ((prevWins + 1) / total) * 100;
      gladiator.stats.profitFactor += 0.01; // tiny bump
    } else {
      const total = gladiator.stats.totalTrades;
      const prevWins = (gladiator.stats.winRate / 100) * (total - 1);
      gladiator.stats.winRate = (prevWins / total) * 100;
      gladiator.stats.maxDrawdown += Math.abs(tick.pnlPercent) * 0.1;
    }
    gladiator.lastUpdated = Date.now();
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
  public updateOmegaProgress(progress: number, stats?: Partial<Gladiator['stats']>): void {
    const omega = this.gladiators.find(g => g.isOmega);
    if (omega) {
      omega.trainingProgress = Math.min(100, Math.max(0, progress));
      if (stats) {
        omega.stats = { ...omega.stats, ...stats };
      }
      if (omega.trainingProgress >= 100 && omega.status === 'IN_TRAINING') {
        omega.status = 'ACTIVE';
        omega.isLive = true;
      }
      omega.lastUpdated = Date.now();
    }
  }
}

export const gladiatorStore = GladiatorStore.getInstance();
