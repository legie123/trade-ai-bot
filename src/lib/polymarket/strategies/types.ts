// ============================================================
// Strategy Plugin Interface — Phase 2
// ============================================================

import type { PolyMarket, PolyDivision, PolyOpportunity } from '../polyTypes';

export interface StrategyContext {
  market: PolyMarket;
  opportunity: PolyOpportunity;
  division: PolyDivision;
  features?: Record<string, unknown>;
  evaluatedAt: number;
}

export interface StrategyProposal {
  direction: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  conviction: number;
  confidence: number;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

export type StrategyStatus =
  | 'shadow'
  | 'paper'
  | 'live_small'
  | 'live_full'
  | 'paused'
  | 'retired';

export interface StrategyGates {
  minSample: number;
  minWrWilsonLower: number;
  minPf: number;
  maxDdPct: number;
}

export interface StrategyMetadata {
  strategyId: string;
  displayName: string;
  hypothesis: string;
  status: StrategyStatus;
  bankrollSharePct: number;
  kellyFraction: number;
  minEdgeBps: number;
  maxPositionUsdc: number;
  gates: StrategyGates;
  configJson: Record<string, unknown>;
}

export interface StrategyPlugin {
  metadata: StrategyMetadata;
  evaluate: (ctx: StrategyContext) => Promise<StrategyProposal>;
}
