// ============================================================
// Phase 5 — Day 30 Validator.
// Runs full-window backtest 2026-05-03 → 2026-06-02 + verdict.
// ============================================================

import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { replayDecisionsForBaseline } from '@/lib/polymarket/backtest/runner';

const log = createLogger('PaperForwardDay30');

export interface Day30VerdictResult {
  windowStart: string;
  windowEnd: string;
  live: {
    settled: number;
    wins: number;
    losses: number;
    winRate: number;
    profitFactor: number;
    sharpe: number;
    maxDdPct: number;
  };
  shadow: Record<
    string,
    {
      settled: number;
      wins: number;
      winRate: number;
      pnlUsdc: number;
    }
  >;
  promotionCandidates: string[];
  finalVerdict: 'PROMOTE_TO_PILOT' | 'EXTEND_PAPER' | 'KILL_AND_RESEARCH';
  rationale: string;
}

const PHASE5_START = '2026-05-03T00:00:00Z';
const PHASE5_END = '2026-06-02T00:00:00Z';

export async function runDay30Validation(): Promise<Day30VerdictResult> {
  // Idempotency: token guard
  const TOKEN = process.env.POLY_DAY30_VALIDATOR_TOKEN;
  if (TOKEN) {
    const { data: storeRow } = await supabase
      .from('json_store')
      .select('value')
      .eq('key', 'poly_day30_validator_token')
      .single();
    if ((storeRow?.value as string) === TOKEN) {
      log.warn('Day-30 validator already ran for this token', { token: TOKEN });
    } else {
      await supabase
        .from('json_store')
        .upsert({ key: 'poly_day30_validator_token', value: TOKEN }, { onConflict: 'key' });
    }
  }

  // Live full-window
  const live = await replayDecisionsForBaseline(
    null,
    PHASE5_START,
    PHASE5_END,
    'phase5_day30_validator',
  );

  // Shadow strategies aggregated
  const { data: shadowRows } = await supabase
    .from('poly_shadow_proposals')
    .select('strategy_id, shadow_won, shadow_simulated_pnl_usdc, settled_at')
    .gte('proposed_at', PHASE5_START)
    .lte('proposed_at', PHASE5_END)
    .not('settled_at', 'is', null);

  const shadowAcc: Record<string, { n: number; w: number; pnl: number }> = {};
  for (const r of shadowRows ?? []) {
    const sid = (r.strategy_id as string) ?? 'unknown';
    if (!shadowAcc[sid]) shadowAcc[sid] = { n: 0, w: 0, pnl: 0 };
    shadowAcc[sid].n++;
    if (r.shadow_won) shadowAcc[sid].w++;
    shadowAcc[sid].pnl += Number(r.shadow_simulated_pnl_usdc ?? 0);
  }

  const shadow: Record<
    string,
    { settled: number; wins: number; winRate: number; pnlUsdc: number }
  > = {};
  const promotionCandidates: string[] = [];
  for (const [sid, acc] of Object.entries(shadowAcc)) {
    const wr = acc.n > 0 ? acc.w / acc.n : 0;
    shadow[sid] = { settled: acc.n, wins: acc.w, winRate: wr, pnlUsdc: acc.pnl };
    // Promotion gate: at least 50 settled, WR >= 58%, PnL > 0
    if (acc.n >= 50 && wr >= 0.58 && acc.pnl > 0) {
      promotionCandidates.push(sid);
    }
  }

  // Final verdict logic — calibrated to project rules (no theater)
  const livePf = Number.isFinite(live.profitFactor) ? live.profitFactor : 0;
  const liveDd = Math.abs(live.maxDrawdownPct);
  const liveSettled = live.settledCount;

  let finalVerdict: 'PROMOTE_TO_PILOT' | 'EXTEND_PAPER' | 'KILL_AND_RESEARCH';
  let rationale: string;

  if (liveSettled < 100) {
    finalVerdict = 'EXTEND_PAPER';
    rationale = `Sample insuficient (${liveSettled} settled < 100). Cere extensie 30 zile.`;
  } else if (liveDd > 30) {
    finalVerdict = 'KILL_AND_RESEARCH';
    rationale = `MaxDD ${liveDd.toFixed(1)}% > 30%. Live config nu trece risk gate. Întoarce-te la edge research.`;
  } else if (live.winRate >= 0.55 && livePf >= 1.2) {
    finalVerdict = 'PROMOTE_TO_PILOT';
    rationale = `Live config: WR=${(live.winRate * 100).toFixed(1)}% PF=${livePf.toFixed(2)} DD=${liveDd.toFixed(1)}%. Promotion candidates shadow: ${promotionCandidates.join(', ') || 'none'}.`;
  } else if (promotionCandidates.length > 0) {
    finalVerdict = 'PROMOTE_TO_PILOT';
    rationale = `Live config sub-prag (WR=${(live.winRate * 100).toFixed(1)}% PF=${livePf.toFixed(2)}). DAR shadow strategies promovabile: ${promotionCandidates.join(', ')}. Plan: pilot cu shadow champion.`;
  } else {
    finalVerdict = 'EXTEND_PAPER';
    rationale = `Live: WR=${(live.winRate * 100).toFixed(1)}% PF=${livePf.toFixed(2)} DD=${liveDd.toFixed(1)}%. Shadow: 0 promotion candidates. Extinde paper sau caută edge nou.`;
  }

  // Persist final report
  await supabase.from('poly_weekly_reports').insert({
    window_start: PHASE5_START,
    window_end: PHASE5_END,
    config_label: 'paper_forward_v1_day30_FINAL',
    live_total_decisions: live.totalDecisions,
    live_acted: live.actedCount,
    live_settled: live.settledCount,
    live_wins: live.wins,
    live_losses: live.losses,
    live_win_rate: live.winRate,
    live_profit_factor: livePf,
    live_max_dd_pct: liveDd,
    shadow_strategies: shadow,
    per_division_breakdown: live.perDivisionStats,
    verdict: finalVerdict === 'PROMOTE_TO_PILOT' ? 'GREEN' : finalVerdict === 'EXTEND_PAPER' ? 'AMBER' : 'RED',
    notes: `DAY-30 FINAL VERDICT: ${finalVerdict}. ${rationale}`,
  });

  log.warn('[DAY-30 VALIDATOR] Final verdict', { verdict: finalVerdict, rationale });

  return {
    windowStart: PHASE5_START,
    windowEnd: PHASE5_END,
    live: {
      settled: live.settledCount,
      wins: live.wins,
      losses: live.losses,
      winRate: live.winRate,
      profitFactor: livePf,
      sharpe: live.sharpeLike,
      maxDdPct: liveDd,
    },
    shadow,
    promotionCandidates,
    finalVerdict,
    rationale,
  };
}
