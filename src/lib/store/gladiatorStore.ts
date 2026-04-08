import { INITIAL_STRATEGIES } from './seedStrategies';
import { Gladiator, ArenaType } from '../types/gladiator';
import { getGladiatorsFromDb, saveGladiatorsToDb } from '@/lib/store/db';

/**
 * Singleton for managing the Gladiator Ranks and Arenas for Phoenix V2.
 */
class GladiatorStore {
  private static instance: GladiatorStore;
  private gladiators: Gladiator[] = [];

  private constructor() {}

  public static getInstance(): GladiatorStore {
    if (!GladiatorStore.instance) {
      GladiatorStore.instance = new GladiatorStore();
    }
    return GladiatorStore.instance;
  }

  private ensureLoaded() {
    if (this.gladiators.length > 0) return;
    const fromDb = getGladiatorsFromDb();
    if (fromDb && fromDb.length > 0) {
      this.gladiators = fromDb;
    } else {
      this.seedGladiators();
    }
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
    saveGladiatorsToDb(this.gladiators);
  }

  public getGladiators(): Gladiator[] {
    this.ensureLoaded();
    return this.gladiators;
  }

  public getLeaderboard(): Gladiator[] {
    this.ensureLoaded();
    return this.gladiators
      .filter(g => !g.isOmega)
      .sort((a, b) => b.stats.winRate - a.stats.winRate);
  }

  public updateGladiatorStats(id: string, tick: { pnlPercent: number, isWin: boolean }) {
    this.ensureLoaded();
    const gladiator = this.gladiators.find(g => g.id === id);
    if (!gladiator) return;
    
    gladiator.stats.totalTrades += 1;
    if (tick.isWin) {
      const total = gladiator.stats.totalTrades;
      const prevWins = (gladiator.stats.winRate / 100) * (total - 1);
      gladiator.stats.winRate = ((prevWins + 1) / total) * 100;
      gladiator.stats.profitFactor += 0.01;
    } else {
      const total = gladiator.stats.totalTrades;
      const prevWins = (gladiator.stats.winRate / 100) * (total - 1);
      gladiator.stats.winRate = (prevWins / total) * 100;
      gladiator.stats.maxDrawdown += Math.abs(tick.pnlPercent) * 0.1;
    }
    gladiator.lastUpdated = Date.now();
    
    // Trigger auto-promote/demote after every stats update
    this.recalibrateRanks();
    saveGladiatorsToDb(this.gladiators);
  }

  /**
   * AUTO-PROMOTE / DEMOTE ENGINE
   * Re-ranks gladiators per arena by performance score.
   * Only the Top 3 per arena get isLive = true (real capital access).
   * This creates Darwinian selection pressure.
   */
  public recalibrateRanks(): void {
    this.ensureLoaded();
    const nonOmega = this.gladiators.filter(g => !g.isOmega);
    
    // Group by arena
    const arenaGroups = new Map<ArenaType, Gladiator[]>();
    for (const g of nonOmega) {
      const group = arenaGroups.get(g.arena) || [];
      group.push(g);
      arenaGroups.set(g.arena, group);
    }

    for (const [, group] of arenaGroups) {
      // Performance score: weighted combination of winRate + profitFactor + recency
      const scored = group.map(g => {
        const recencyBonus = (Date.now() - g.lastUpdated) < 3600_000 ? 5 : 0; // Active in last hour
        const tradeBonus = Math.min(g.stats.totalTrades / 10, 10); // More experience = bonus (cap at 10)
        const ddPenalty = g.stats.maxDrawdown > 15 ? -10 : 0; // Heavy drawdown = penalize
        const score = g.stats.winRate + (g.stats.profitFactor * 5) + recencyBonus + tradeBonus + ddPenalty;
        return { gladiator: g, score };
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Assign ranks and live status
      scored.forEach((entry, index) => {
        entry.gladiator.rank = index + 1;
        entry.gladiator.isLive = index < 3; // Top 3 get real capital
      });
    }
  }

  /**
   * Finds the best candidate gladiator to handle an incoming signal.
   * Priority: Top Rank (isLive = true) for the given symbol's typical arena.
   * Prefers gladiators who were recently active and have higher win rates.
   */
  public findBestGladiator(symbol: string): Gladiator | undefined {
    this.ensureLoaded();
    const preferredArena: ArenaType = symbol.includes('SOL') || symbol.includes('WIF') ? 'DEEP_WEB' : 'DAY_TRADING';
    
    const candidates = this.gladiators
      .filter(g => g.arena === preferredArena && g.isLive && !g.isOmega);

    if (candidates.length === 0) {
      // Fallback: any live gladiator
      return this.gladiators
        .filter(g => g.isLive && !g.isOmega)
        .sort((a, b) => a.rank - b.rank)[0];
    }

    return candidates.sort((a, b) => a.rank - b.rank)[0];
  }

  public updateOmegaProgress(progress: number, stats?: Partial<Gladiator['stats']>): void {
    this.ensureLoaded();
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
      saveGladiatorsToDb(this.gladiators);
    }
  }
  public hydrate(gladiators: Gladiator[]): void {
    this.gladiators = gladiators;
  }

}

export const gladiatorStore = GladiatorStore.getInstance();
