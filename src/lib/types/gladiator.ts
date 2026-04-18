export type ArenaType = 'SCALPING' | 'DAY_TRADING' | 'SWING' | 'DEEP_WEB';
export type SentinelStatus = 'SAFE' | 'WARNING' | 'CRITICAL' | 'HALTED';

export interface MasterConsensus {
  agreedDirection: 'LONG' | 'SHORT' | 'FLAT';
  macroConfidence: number;
  allowedArenas: ArenaType[];
}


/**
 * DNA = the gladiator's signal acceptance criteria.
 * Creates real strategy differentiation — gladiators that specialize
 * in different symbols/timeframes/directions produce uncorrelated PnL
 * streams → Darwinian selection becomes meaningful.
 *
 * Without DNA: all gladiators take identical trades → WR spread is pure noise.
 */
export interface GladiatorDNA {
  /** Symbol prefixes to accept. ['BTC'] matches BTCUSDT. ['*'] = accept all. */
  symbolFilter: string[];
  /** Minimum signal confidence (0-95) to accept. Higher = fewer but cleaner trades. */
  minConfidence: number;
  /** Direction bias. LONG_ONLY for trend-followers, SHORT_ONLY for contrarians. */
  directionBias: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH';
  /** Preferred timeframes. Empty = accept all. */
  timeframes?: string[];
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
  dna?: GladiatorDNA; // Signal acceptance criteria — absent = accept all (backward compat)
  stats: {
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    sharpeRatio: number;
    totalTrades: number;
    grossWins?: number;
    grossLosses?: number;
  };
  skills?: string[]; // Array of unique execution capabilities, e.g. MEME_SNIPER
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

export type DualMasterIdentity = 'ARCHITECT' | 'ORACLE';

export interface MasterOpinion {
  identity: DualMasterIdentity;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number; // 0 to 1
  reasoning: string;
}

export interface DualConsensus {
  finalDirection: 'LONG' | 'SHORT' | 'FLAT';
  weightedConfidence: number;
  opinions: MasterOpinion[];
  timestamp: number;
}
