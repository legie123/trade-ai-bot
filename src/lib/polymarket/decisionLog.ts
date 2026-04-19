/**
 * decisionLog.ts — persists every correlated decision into
 * polymarket_decisions (append-only).
 *
 * FAZA 3.3 storage layer. Best-effort: failure to write a decision NEVER
 * blocks the scanner. Migration 20260420_polymarket_decisions.sql must
 * be applied manually (Supabase SQL editor).
 */
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/core/logger';
import type { PolyGladiator } from './polyGladiators';
import type { PolyMarket, PolyOpportunity } from './polyTypes';
import type { CorrelatedDecision } from './correlationLayer';

const log = createLogger('PolyDecisionLog');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supa = (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('placeholder'))
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

function uuid(): string {
  // RFC 4122 v4; small inline to avoid pulling dep.
  const r = (n: number) => Math.floor(Math.random() * 16).toString(16).padStart(1, '0');
  let s = '';
  for (let i = 0; i < 32; i++) s += r(i);
  return `${s.slice(0,8)}-${s.slice(8,12)}-4${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20,32)}`;
}

export async function logDecision(args: {
  gladiator: PolyGladiator;
  market: PolyMarket;
  decision: CorrelatedDecision;
  opportunity?: PolyOpportunity;
  acted: boolean;
  runId?: string; // FAZA 3.4 — links decision to its scan run for drill-down
}): Promise<{ inserted: boolean; decisionId: string; reason?: string }> {
  const decisionId = uuid();
  if (!supa) return { inserted: false, decisionId, reason: 'supabase_unconfigured' };

  const row = {
    decision_id: decisionId,
    gladiator_id: args.gladiator.id,
    division: args.gladiator.division,
    market_id: args.market.id,
    condition_id: args.market.conditionId || null,
    direction: args.decision.direction,
    confidence: args.decision.confidence,
    edge_score: args.decision.edgeScore,
    goldsky_confirm: args.decision.goldskyConfirm,
    moltbook_karma: args.decision.moltbookKarma,
    liquidity_sanity: args.decision.liquiditySanity,
    final_score: args.decision.finalScore,
    acted: args.acted,
    skip_reason: args.decision.skipReason || null,
    rationale: args.decision.rationale,
    raw_opportunity: args.opportunity ?? null,
    run_id: args.runId ?? null,
  };

  try {
    const { error } = await supa.from('polymarket_decisions').insert(row);
    if (error) {
      log.warn('logDecision failed', { error: error.message });
      return { inserted: false, decisionId, reason: error.message };
    }
    return { inserted: true, decisionId };
  } catch (err) {
    log.warn('logDecision threw', { error: String(err) });
    return { inserted: false, decisionId, reason: String(err) };
  }
}
