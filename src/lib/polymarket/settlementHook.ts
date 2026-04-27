/**
 * settlementHook.ts — writes realized outcome of an ACTED decision
 * back onto its polymarket_decisions row so the learning loop can
 * compute REAL WR / PF / avg pnl (not just selection lift).
 *
 * FAZA 3.7 storage layer. Best-effort: a failed UPDATE never blocks
 * the resolve cron. Migration 20260420_polymarket_decision_settlement.sql
 * must be applied manually (Supabase SQL editor).
 *
 * Kill-switch: POLY_SETTLEMENT_HOOK_ENABLED=0 → settleDecision() no-ops
 * (returns { updated:false, reason:'killed' }) so resolve cron stays
 * healthy even if the writeback path is buggy.
 *
 * ASUMPTII:
 * - decisionId is the uuid generated in logDecision.uuid(), returned
 *   from logDecision() even if the INSERT failed. If settle finds no
 *   matching row, it logs a warn (count=0) but does not throw — this
 *   is expected when the scan write failed transiently but resolve
 *   succeeded hours/days later.
 * - pnlPercent is computed from (netPnL / capitalAllocated) × 100 at
 *   the call site, so callers own the slippage/fee model.
 * - horizonMs is wall-clock enteredAt → settledAt. CANCEL outcomes
 *   produce near-zero pnl (exit=entry) but are still written so the
 *   learning loop can count them separately.
 */
import { supabase as supa, SUPABASE_CONFIGURED } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolySettlementHook');

export type SettlementOutcome = 'YES' | 'NO' | 'CANCEL';

export interface SettleArgs {
  decisionId: string;
  pnlPercent: number;      // realized PnL as % of capital allocated, net of fees
  pnlUsd: number;          // realized PnL in USD, net of fees
  outcome: SettlementOutcome;
  horizonMs: number;       // enteredAt → settledAt, ms (wall clock)
}

export interface SettleResult {
  updated: boolean;
  reason?: string;
}

/**
 * Kill-switch: POLY_SETTLEMENT_HOOK_ENABLED=0 disables writeback.
 * Default is enabled (empty env = enabled). This is asymmetric with
 * other FAZA-3.x flags (which default to shadow) because settlement
 * has no shadow mode: it either runs or it doesn't.
 */
function isEnabled(): boolean {
  return process.env.POLY_SETTLEMENT_HOOK_ENABLED !== '0';
}

export async function settleDecision(args: SettleArgs): Promise<SettleResult> {
  if (!isEnabled()) return { updated: false, reason: 'killed' };
  if (!SUPABASE_CONFIGURED) return { updated: false, reason: 'supabase_unconfigured' };
  if (!args.decisionId) return { updated: false, reason: 'missing_decision_id' };

  // Guard against NaN/Infinity that would break numeric columns.
  const pnlPct = Number.isFinite(args.pnlPercent) ? args.pnlPercent : 0;
  const pnlUsd = Number.isFinite(args.pnlUsd) ? args.pnlUsd : 0;
  const horizonMs = Number.isFinite(args.horizonMs) && args.horizonMs >= 0 ? Math.floor(args.horizonMs) : 0;

  const patch = {
    settled_at: new Date().toISOString(),
    settled_pnl_pct: pnlPct,
    settled_pnl_usd: pnlUsd,
    settled_outcome: args.outcome,
    horizon_ms: horizonMs,
  };

  try {
    const { data, error } = await supa
      .from('polymarket_decisions')
      .update(patch)
      .eq('decision_id', args.decisionId)
      .select('decision_id');
    if (error) {
      log.warn('settleDecision failed', { decisionId: args.decisionId, error: error.message });
      return { updated: false, reason: error.message };
    }
    const count = Array.isArray(data) ? data.length : 0;
    if (count === 0) {
      // Not an error — decision row may have failed to persist at scan time.
      log.warn('settleDecision matched 0 rows', { decisionId: args.decisionId });
      return { updated: false, reason: 'no_matching_row' };
    }
    return { updated: true };
  } catch (err) {
    log.warn('settleDecision threw', { decisionId: args.decisionId, error: String(err) });
    return { updated: false, reason: String(err) };
  }
}
