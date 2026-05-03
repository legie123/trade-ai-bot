// ============================================================
// Backtest Runner — Phase 4
// Replays settled polymarket_decisions to compute strategy stats.
// ============================================================

import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import {
  computeWilsonCI,
  computeSharpe,
  computeProfitFactor,
  computeMaxDrawdown,
} from './analytics';

const log = createLogger('BacktestRunner');

export interface BacktestResult {
  runId: string;
  strategyId: string;
  sampleStart: string;
  sampleEnd: string;
  totalDecisions: number;
  settledCount: number;
  actedCount: number;
  wins: number;
  losses: number;
  cancels: number;
  winRate: number;
  wilsonLower95: number;
  wilsonUpper95: number;
  profitFactor: number;
  sharpeLike: number;
  avgPnlPct: number;
  maxDrawdownPct: number;
  perDivisionStats: Record<string, { n: number; wr: number; avgPnlPct: number }>;
}

/**
 * Replay all settled decisions in window. Strategy filter is optional:
 * if null, computes baseline stats over ALL decisions (cohort summary).
 */
export async function replayDecisionsForBaseline(
  strategyId: string | null,
  sampleStartIso: string,
  sampleEndIso: string,
  notes = '',
): Promise<BacktestResult> {
  const query = supabase
    .from('polymarket_decisions')
    .select('decision_id, division, direction, settled_outcome, settled_pnl_pct, acted, settled_at, decided_at, strategy_id')
    .gte('decided_at', sampleStartIso)
    .lte('decided_at', sampleEndIso)
    .not('settled_at', 'is', null);

  const { data: rows, error } = strategyId
    ? await query.eq('strategy_id', strategyId)
    : await query;

  if (error) {
    log.warn('Backtest query failed', { error: String(error) });
    throw new Error(`Backtest query failed: ${String(error)}`);
  }
  const settled = rows ?? [];

  let wins = 0;
  let losses = 0;
  let cancels = 0;
  const pnls: number[] = [];
  const perDivisionAcc: Record<string, { n: number; w: number; pnlSum: number }> = {};

  for (const r of settled) {
    const direction = r.direction as string | null;
    const outcome = r.settled_outcome as string | null;
    const pnlPct = r.settled_pnl_pct == null ? 0 : Number(r.settled_pnl_pct);
    const div = (r.division as string) ?? 'UNKNOWN';

    if (outcome === 'CANCEL') {
      cancels++;
      continue;
    }

    const isWin =
      (outcome === 'YES' && direction === 'BUY_YES') ||
      (outcome === 'NO' && direction === 'BUY_NO');

    if (isWin) wins++;
    else losses++;

    pnls.push(pnlPct);

    if (!perDivisionAcc[div]) perDivisionAcc[div] = { n: 0, w: 0, pnlSum: 0 };
    perDivisionAcc[div].n++;
    if (isWin) perDivisionAcc[div].w++;
    perDivisionAcc[div].pnlSum += pnlPct;
  }

  const totalResolved = wins + losses;
  const winRate = totalResolved > 0 ? wins / totalResolved : 0;
  const wilson = computeWilsonCI(wins, totalResolved);
  const profitFactor = computeProfitFactor(pnls);
  const sharpeLike = computeSharpe(pnls);
  const avgPnlPct = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const maxDrawdownPct = computeMaxDrawdown(pnls);

  const perDivisionStats: Record<string, { n: number; wr: number; avgPnlPct: number }> = {};
  for (const [div, agg] of Object.entries(perDivisionAcc)) {
    perDivisionStats[div] = {
      n: agg.n,
      wr: agg.n > 0 ? agg.w / agg.n : 0,
      avgPnlPct: agg.n > 0 ? agg.pnlSum / agg.n : 0,
    };
  }

  // Persist run
  const { data: insertedRow, error: insertError } = await supabase
    .from('poly_backtest_runs')
    .insert({
      strategy_id: strategyId ?? 'baseline_all',
      sample_start: sampleStartIso,
      sample_end: sampleEndIso,
      total_decisions: settled.length,
      settled_count: settled.length,
      acted_count: settled.filter((r) => (r as { acted?: boolean }).acted).length,
      wins,
      losses,
      cancels,
      win_rate: winRate,
      wilson_lower_95: wilson.lower,
      wilson_upper_95: wilson.upper,
      profit_factor: Number.isFinite(profitFactor) ? profitFactor : 999,
      sharpe_like: sharpeLike,
      avg_pnl_pct: avgPnlPct,
      max_drawdown_pct: maxDrawdownPct,
      per_division_stats: perDivisionStats,
      config_json: { strategyFilter: strategyId },
      notes,
    })
    .select('run_id')
    .single();

  if (insertError) {
    log.warn('Backtest run insert failed (non-blocking)', { error: String(insertError) });
  }

  const runId = (insertedRow?.run_id as string) ?? 'unsaved';

  log.info('Backtest run complete', {
    runId, strategyId, n: settled.length,
    wins, losses, cancels, winRate: winRate.toFixed(4),
  });

  return {
    runId,
    strategyId: strategyId ?? 'baseline_all',
    sampleStart: sampleStartIso,
    sampleEnd: sampleEndIso,
    totalDecisions: settled.length,
    settledCount: settled.length,
    actedCount: settled.filter((r) => (r as { acted?: boolean }).acted).length,
    wins,
    losses,
    cancels,
    winRate,
    wilsonLower95: wilson.lower,
    wilsonUpper95: wilson.upper,
    profitFactor,
    sharpeLike,
    avgPnlPct,
    maxDrawdownPct,
    perDivisionStats,
  };
}
