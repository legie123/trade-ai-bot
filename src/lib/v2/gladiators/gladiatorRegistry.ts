import { Gladiator, ArenaType } from '../../types/gladiator';

/**
 * In-Memory Database for Gladiator Rankings.
 * Replace with Redis in a multi-instance production environment.
 */
export class GladiatorRegistry {
  private gladiators: Map<string, Gladiator> = new Map();

  public registerGladiator(gladiator: Gladiator): void {
    this.gladiators.set(gladiator.id, gladiator);
    this.recalculateArena(gladiator.arena);
  }

  public updateStats(id: string, winRate: number, profitFactor: number, maxDrawdown: number, sharpeRatio: number): void {
    const gladiator = this.gladiators.get(id);
    if (!gladiator) return;
    
    gladiator.stats = { ...gladiator.stats, winRate, profitFactor, maxDrawdown, sharpeRatio };
    this.gladiators.set(id, gladiator);
    this.recalculateArena(gladiator.arena);
  }

  private recalculateArena(arena: ArenaType): void {
    const combatants = Array.from(this.gladiators.values()).filter(g => g.arena === arena);
    // Sort by profit factor for now, or composite score
    combatants.sort((a, b) => b.stats.profitFactor - a.stats.profitFactor);
    
    combatants.forEach((g, index) => {
      g.rank = index + 1;
      // Top 3 get live capital, the rest are paper trading
      g.isLive = g.rank <= 3;
      this.gladiators.set(g.id, g);
    });
  }

  public getArenaTop(arena: ArenaType): Gladiator[] {
    return Array.from(this.gladiators.values())
      .filter(g => g.arena === arena)
      .sort((a, b) => a.rank - b.rank);
  }
}
