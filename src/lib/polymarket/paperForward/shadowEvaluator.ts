// ============================================================
// Phase 5 — Shadow Evaluator.
// Gated by POLY_SHADOW_SYNDICATE_ENABLED env (default OFF).
// Fire-and-forget — never blocks live trading.
// ============================================================

import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import type { PolyOpportunity, PolyDivision, PolyMarket } from '@/lib/polymarket/polyTypes';

const log = createLogger('ShadowEvaluator');

let dailyCallCount = 0;
let dailyCallDay = new Date().toISOString().slice(0, 10);

function resetDailyCounter(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyCallDay) {
    dailyCallCount = 0;
    dailyCallDay = today;
  }
}

export interface ShadowEvalContext {
  opportunity: PolyOpportunity;
  division: PolyDivision;
  liveDecisionId?: string;
  liveDirection: string;
  liveActed: boolean;
  liveConviction: number;
}

interface AnalyzeMarketShape {
  direction?: string;
  confidence?: number;
  consensusScore?: number;
  reasoning?: string;
  architectView?: string;
  oracleView?: string;
}

/**
 * Evaluates shadow proposals (null_baseline + syndicate_llm) for the given opportunity.
 * Persists each proposal to poly_shadow_proposals.
 * NEVER throws — failures logged, returned as inserted=false.
 */
export async function evaluateShadowProposals(ctx: ShadowEvalContext): Promise<void> {
  const ENABLED = process.env.POLY_SHADOW_SYNDICATE_ENABLED === '1';
  if (!ENABLED) return;

  resetDailyCounter();
  const DAILY_LIMIT = Math.max(
    0,
    Number.parseInt(process.env.POLY_SHADOW_DAILY_CALL_LIMIT ?? '200', 10) || 200,
  );
  if (dailyCallCount >= DAILY_LIMIT) {
    return; // Cost cap reached
  }

  // null_baseline: random direction, conviction 50, confidence 50
  // Always cheap (no API call) — log unconditionally
  try {
    const randDir = Math.random() < 0.5 ? 'BUY_YES' : 'BUY_NO';
    await supabase.from('poly_shadow_proposals').insert({
      strategy_id: 'null_baseline',
      market_id: ctx.opportunity.marketId,
      division: ctx.division,
      live_decision_id: ctx.liveDecisionId,
      live_direction: ctx.liveDirection,
      live_acted: ctx.liveActed,
      live_conviction: ctx.liveConviction,
      shadow_direction: randDir,
      shadow_confidence: 0.5,
      shadow_conviction: 50,
      shadow_reasoning: 'null_baseline: random control',
      shadow_metadata: { source: 'random_50_50' },
    });
  } catch (e) {
    log.warn('null_baseline shadow insert failed', { error: String(e) });
  }

  // syndicate_llm: only if budget allows + module loadable
  try {
    dailyCallCount++;
    const mod = await import('@/lib/polymarket/polySyndicate');
    const analyzeMarket = (
      mod as {
        analyzeMarket?: (
          market: PolyMarket,
          division: PolyDivision,
        ) => Promise<AnalyzeMarketShape>;
      }
    ).analyzeMarket;
    if (typeof analyzeMarket !== 'function') {
      log.warn('analyzeMarket not exported from polySyndicate');
      return;
    }
    const analysis = await analyzeMarket(ctx.opportunity.market, ctx.division);
    const dirRaw = (analysis?.direction ?? 'SKIP').toUpperCase();
    const dir =
      dirRaw === 'YES' ? 'BUY_YES' : dirRaw === 'NO' ? 'BUY_NO' : 'SKIP';
    await supabase.from('poly_shadow_proposals').insert({
      strategy_id: 'syndicate_llm',
      market_id: ctx.opportunity.marketId,
      division: ctx.division,
      live_decision_id: ctx.liveDecisionId,
      live_direction: ctx.liveDirection,
      live_acted: ctx.liveActed,
      live_conviction: ctx.liveConviction,
      shadow_direction: dir,
      shadow_confidence: analysis?.confidence != null ? analysis.confidence / 100 : null,
      shadow_conviction: analysis?.consensusScore ?? null,
      shadow_reasoning: analysis?.reasoning ?? null,
      shadow_metadata: { dailyCallCount, dailyCallDay },
    });
  } catch (e) {
    log.warn('syndicate_llm shadow eval failed', { error: String(e) });
  }
}
