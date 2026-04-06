export type ArenaType = 'SCALPING' | 'DAY_TRADING' | 'SWING' | 'DEEP_WEB';
export type SentinelStatus = 'SAFE' | 'WARNING' | 'CRITICAL' | 'HALTED';

export interface MasterConsensus {
  agreedDirection: 'LONG' | 'SHORT' | 'FLAT';
  macroConfidence: number;
  allowedArenas: ArenaType[];
}


/**
 * Gladiator represents a specific trading strategy competing in an arena.
 */
export interface Gladiator {
  id: string;
  name: string;
  arena: ArenaType;
  rank: number; // 1 to 10
  isLive: boolean; // Only top 3 are true
  stats: {
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    sharpeRatio: number;
    totalTrades: number;
  };
  status?: 'ACTIVE' | 'IN_TRAINING' | 'RETIRED';
  trainingProgress?: number; // 0 to 100
  isOmega?: boolean; // True for the Super-AI Gladiator
  lastUpdated: number;
}

/**
 * Promoter data represents signals fetched from social, on-chain or institutions.
 */
export interface PromoterData {
  source: string;
  symbol: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidenceRate: number;
  rawPayload: Record<string, unknown>;
  timestamp: number;
}

export type MasterSeat = 'GEMINI_CLAUDE' | 'DEEPSEEK_R1' | 'LLAMA_4' | 'SONAR' | 'QWEN_3';

export interface SyndicateOpinion {
  seat: MasterSeat;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number; // 0 to 1
  reasoning: string;
}

export interface SyndicateConsensus {
  finalDirection: 'LONG' | 'SHORT' | 'FLAT';
  weightedConfidence: number;
  opinions: SyndicateOpinion[];
  timestamp: number;
}
