// ============================================================
// Polymarket Type Definitions — All 16 divisions + data models
// ============================================================

export enum PolyDivision {
  TRENDING = 'TRENDING',
  BREAKING = 'BREAKING',
  NEW = 'NEW',
  POLITICS = 'POLITICS',
  SPORTS = 'SPORTS',
  CRYPTO = 'CRYPTO',
  ESPORTS = 'ESPORTS',
  IRAN = 'IRAN',
  FINANCE = 'FINANCE',
  GEOPOLITICS = 'GEOPOLITICS',
  TECH = 'TECH',
  CULTURE = 'CULTURE',
  ECONOMY = 'ECONOMY',
  WEATHER = 'WEATHER',
  MENTIONS = 'MENTIONS',
  ELECTIONS = 'ELECTIONS',
}

export interface PolyOutcome {
  id: string;
  name: string;
  price: number; // 0-1 probability
}

export interface PolyMarket {
  id: string;
  conditionId: string;
  title: string;
  description?: string;
  category?: string;
  outcomes: PolyOutcome[];
  active: boolean;
  closed: boolean;
  endDate: string;
  volume24h?: number;
  liquidityUSD?: number;
  createdAt?: string;
}

export interface PolyOrder {
  id: string;
  marketId: string;
  outcomeId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
}

export interface PolyTrade {
  id: string;
  marketId: string;
  outcomeId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  executedAt: string;
}

export interface PolyPosition {
  marketId: string;
  outcomeId: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
}

export interface PolyOpportunity {
  marketId: string;
  market: PolyMarket;
  division: PolyDivision;
  edgeScore: number;       // 0-100 composite
  mispricingScore: number; // 0-100
  volumeAnomalyScore: number;
  momentumScore: number;
  liquidityScore: number;
  timeDecayScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  recommendation: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  reasoning: string;
}

export interface PolyScanResult {
  division: PolyDivision;
  scannedAt: string;
  totalMarkets: number;
  opportunities: PolyOpportunity[];
  topPick: PolyOpportunity | null;
}

// Division → Gamma API category slug mapping
export const DIVISION_SLUGS: Record<PolyDivision, string> = {
  [PolyDivision.TRENDING]: 'trending',
  [PolyDivision.BREAKING]: 'breaking',
  [PolyDivision.NEW]: 'new',
  [PolyDivision.POLITICS]: 'politics',
  [PolyDivision.SPORTS]: 'sports',
  [PolyDivision.CRYPTO]: 'crypto',
  [PolyDivision.ESPORTS]: 'esports',
  [PolyDivision.IRAN]: 'iran',
  [PolyDivision.FINANCE]: 'finance',
  [PolyDivision.GEOPOLITICS]: 'geopolitics',
  [PolyDivision.TECH]: 'tech',
  [PolyDivision.CULTURE]: 'culture',
  [PolyDivision.ECONOMY]: 'economy',
  [PolyDivision.WEATHER]: 'weather',
  [PolyDivision.MENTIONS]: 'mentions',
  [PolyDivision.ELECTIONS]: 'elections',
};
