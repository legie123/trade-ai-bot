import { createLogger } from '@/lib/core/logger';
import { addGladiatorDna, getGladiatorDna } from '@/lib/store/db';

const log = createLogger('DNAExtractor');

export interface BattleRecord {
  id: string;
  gladiatorId: string;
  symbol: string;
  decision: 'LONG' | 'SHORT' | 'FLAT';
  outcomePrice: number;
  entryPrice: number;
  pnlPercent: number;
  timestamp: number;
  isWin: boolean;
  marketContext: Record<string, unknown>;
}

export class DNAExtractor {
  private static instance: DNAExtractor;

  private constructor() {
    // Initialization handled by Supabase sync now
  }

  public static getInstance(): DNAExtractor {
    if (!DNAExtractor.instance) {
      DNAExtractor.instance = new DNAExtractor();
    }
    return DNAExtractor.instance;
  }

  public async logBattle(record: BattleRecord): Promise<void> {
    try {
      addGladiatorDna(record as unknown as Record<string, unknown>);
      log.info(`[DNA Bank] Logged battle for ${record.gladiatorId} on ${record.symbol} (Win: ${record.isWin}) -> Syncing to Supabase...`);
    } catch (err) {
      log.error('Failed to log battle DNA', { error: (err as Error).message });
    }
  }

  public async getGladiatorAggregatedDna(gladiatorId: string): Promise<Record<string, unknown>> {
    try {
      const battles = getGladiatorDna() as unknown as BattleRecord[];
      const specificBattles = battles.filter(b => b.gladiatorId === gladiatorId);
      
      const wins = specificBattles.filter(b => b.isWin).length;
      const total = specificBattles.length;
      const winRate = total > 0 ? wins / total : 0;
      
      return {
        totalBattles: total,
        winRate,
        recentPnL: specificBattles.slice(-10).reduce((acc, curr) => acc + curr.pnlPercent, 0)
      };
    } catch (err) {
      return { msg: 'No DNA available', error: (err as Error).message };
    }
  }
}
