// ============================================================
// Strategy Plugin Interface — Phase 2
//
// Replaces 16-gladiators-per-division anti-pattern with N-strategies-
// per-pool plugin model. Each strategy is a testable hypothesis with
// independent performance gates and capital allocation.
//
// Design principles:
//   - One strategy = one hypothesis (e.g. "news latency arb", "whale follow")
//   - Strategies operate cross-division (no per-category specialization)
//   - Each strategy has its own gate criteria (sample, WR, PF, DD)
//   - Promotion lifecycle: shadow → paper → live_small → live_full
//   - Capital allocation per strategy via bankroll_share_pct
//   - Status state machine in poly_strategies Supabase table
// ============================================================

import { PolyMarket, PolyDivision, PolyOpportunity } from '../polyTypes';

/**
 * Input context passed to strategy.evaluate().
 * Contains the market under analysis + ranker scoring + optional features
 * (Phase 4 will populate features from poly_feature_store timeseries).
 */
export interface StrategyContext {
  market: PolyMarket;
  opportunity: PolyOpportunity;
  division: PolyDivision;
  features?: Record<string, unknown>;
  /** Wall-clock at evaluation start — used for latency-sensitive strategies. */
  evaluatedAt: number;
}

/** Strategy output — a single proposal per market evaluation. */
export interface StrategyProposal {
  /** Trade direction. SKIP if strategy abstains. */
  direction: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  /**
   * Conviction (0-100): strategy's confidence that this trade has positive
   * EV if executed at current price. Used for top-N ranking across strategies.
   */
  conviction: number;
  /**
   * Confidence (0-100): strategy's certainty in the direction signal itself.
   * Different from conviction — e.g. high confidence in direction but low
   * conviction due to thin edge.
   */
  confidence: number;
  /** Human-readable reasoning. Logged for audit. */
  reasoning: string;
  /** Strategy-specific debug payload. NOT persisted to canonical decision row. */
  metadata?: Record<string, unknown>;
}

/**
 * Status state machine.
 *   shadow      — evaluations logged, NO paper positions opened
 *   paper       — paper positions opened, NO real money
 *   live_small  — real money with capped position size (audit-grade)
 *   live_full   — real money with full bankroll_share_pct allocation
 *   paused      — manual halt (e.g. while debugging)
 *   retired     — failed gates permanently; archived
 */
export type StrategyStatus =
  | 'shadow'
  | 'paper'
  | 'live_small'
  | 'live_full'
  | 'paused'
  | 'retired';

/** Promotion / risk gate criteria. Stored in poly_strategies Supabase row. */
export interface StrategyGates {
  minSample: number;             // min trades before promotion eligible
  minWrWilsonLower: number;      // Wilson 95% CI lower bound (0-1)
  minPf: number;                 // profit factor floor
  maxDdPct: number;              // drawdown ceiling (0-100)
}

/** Static metadata + state. Hydrated from poly_strategies table. */
export interface StrategyMetadata {
  strategyId: string;
  displayName: string;
  hypothesis: string;
  status: StrategyStatus;
  bankrollSharePct: number;      // 0-1.0 fraction of total bankroll
  kellyFraction: number;
  minEdgeBps: number;            // min edge in bps before bet
  maxPositionUsdc: number;
  gates: StrategyGates;
  configJson: Record<string, unknown>;
}

/**
 * Strategy plugin contract. Implementors register via strategyRegistry.register().
 * evaluate() must be pure (no global state mutation) and bounded (timeout-safe).
 */
export interface StrategyPlugin {
  metadata: StrategyMetadata;
  evaluate: (ctx: StrategyContext) => Promise<StrategyProposal>;
}
