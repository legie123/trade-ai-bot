// ============================================================
// Phase 5 — Weekly review aggregator.
// Runs replayDecisionsForBaseline over last 7d, persists report.
// ============================================================

import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { replayDecisionsForBaseline } from '@/lib/polymarket/backtest/runner';

const log = createLogger('PaperForwardWeekly');

export interface WeeklyReviewResult {
  windowStart: string;
  windowEnd: string;
  liveBaseline: {
    settled: number;
    winRate: number;
    profitFactor: number;
    realizedPnlUsdc: number;
    maxDdPct: number;
  };
  shadowStrategies: Record<string, { settled: number; winRate: number; pnl: number }>;
  perDivision: Record<string, { n: number; wr: number; avgPnlPct: number }>;
  verdict: 'GREEN' | 'AMBER' | 'RED';
  inserted: boolean;
}

function classifyVerdict(wr: number, pf: number, ddPct: number): 'GREEN' | 'AMBER' | 'RED' {
  // Conservative thresholds for paper momentum strategy
  if (ddPct > 30) return 'RED';
  if (wr >= 0.55 && pf >= 1.2) return 'GREEN';
  if (wr >= 0.50 && pf >= 1.0) return 'AMBER';
  return 'RED';
}

export async function generateWeeklyReview(): Promise<WeeklyReviewResult> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Live baseline: all settled decisions in window
  const live = await replayDecisionsForBaseline(
    null,
    windowStart.toISOString(),
    windowEnd.toISOString(),
    'phase5_weekly_review',
  );

  // Shadow proposals aggregated per strategy_id
  const { data: shadowRows } = await supabase
    .from('poly_shadow_proposals')
    .select('strategy_id, shadow_won, shadow_simulated_pnl_usdc, settled_at')
    .gte('proposed_at', windowStart.toISOString())
    .lte('proposed_at', windowEnd.toISOString())
    .not('settled_at', 'is', null);

  const shadowAcc: Record<string, { n: number; w: number; pnl: number }> = {};
  for (const r of shadowRows ?? []) {
    const sid = (r.strategy_id as string) ?? 'unknown';
    if (!shadowAcc[sid]) shadowAcc[sid] = { n: 0, w: 0, pnl: 0 };
    shadowAcc[sid].n++;
    if (r.shadow_won) shadowAcc[sid].w++;
    shadowAcc[sid].pnl += Number(r.shadow_simulated_pnl_usdc ?? 0);
  }
  const shadowStrategies: Record<string, { settled: number; winRate: number; pnl: number }> = {};
  for (const [sid, acc] of Object.entries(shadowAcc)) {
    shadowStrategies[sid] = {
      settled: acc.n,
      winRate: acc.n > 0 ? acc.w / acc.n : 0,
      pnl: acc.pnl,
    };
  }

  // Realized PnL from snapshot delta over window
  const { data: snaps } = await supabase
    .from('poly_paper_forward_snapshots')
    .select('wallet_realized_pnl_usdc, snapshot_at')
    .gte('snapshot_at', windowStart.toISOString())
    .order('snapshot_at', { ascending: true });
  const startPnl = Number(snaps?.[0]?.wallet_realized_pnl_usdc ?? 0);
  const endPnl = Number(snaps?.[snaps.length - 1]?.wallet_realized_pnl_usdc ?? startPnl);
  const realizedPnl = endPnl - startPnl;

  const verdict = classifyVerdict(
    live.winRate,
    Number.isFinite(live.profitFactor) ? live.profitFactor : 999,
    Math.abs(live.maxDrawdownPct),
  );

  const { error: insertErr } = await supabase.from('poly_weekly_reports').insert({
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    config_label: 'paper_forward_v1',
    live_total_decisions: live.totalDecisions,
    live_acted: live.actedCount,
    live_settled: live.settledCount,
    live_wins: live.wins,
    live_losses: live.losses,
    live_win_rate: live.winRate,
    live_profit_factor: Number.isFinite(live.profitFactor) ? live.profitFactor : 999,
    live_realized_pnl_usdc: realizedPnl,
    live_max_dd_pct: Math.abs(live.maxDrawdownPct),
    shadow_strategies: shadowStrategies,
    per_division_breakdown: live.perDivisionStats,
    verdict,
    notes: `Auto-generated weekly review. Live: ${live.wins}W/${live.losses}L. Verdict: ${verdict}.`,
  });

  const inserted = !insertErr;
  if (insertErr) {
    log.warn('Weekly report insert failed', { error: String(insertErr) });
  }

  log.info('Weekly review generated', {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    liveSettled: live.settledCount,
    wr: live.winRate.toFixed(4),
    verdict,
  });

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    liveBaseline: {
      settled: live.settledCount,
      winRate: live.winRate,
      profitFactor: Number.isFinite(live.profitFactor) ? live.profitFactor : 999,
      realizedPnlUsdc: realizedPnl,
      maxDdPct: Math.abs(live.maxDrawdownPct),
    },
    shadowStrategies,
    perDivision: live.perDivisionStats,
    verdict,
    inserted,
  };
}
