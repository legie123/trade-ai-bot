// GET /api/v2/polymarket/phase5/dashboard — Read-only Phase 5 monitoring aggregator
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Phase5Dashboard');

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export interface Phase5DashboardResponse {
  status: 'ok' | 'error';
  phaseStart: string;
  phaseEnd: string;
  daysElapsed: number;
  daysRemaining: number;
  latestSnapshot: Record<string, unknown> | null;
  recentSnapshots: Array<{
    snapshot_at: string;
    wallet_realized_pnl_usdc: number | null;
    wallet_unrealized_pnl_usdc: number | null;
    wallet_balance_usdc: number | null;
    open_positions_count: number | null;
    win_rate_24h: number | null;
    max_dd_pct: number | null;
    dd_alarm_triggered: boolean | null;
    settlement_backlog_count: number | null;
  }>;
  latestWeeklyReport: Record<string, unknown> | null;
  shadowStats: Record<string, { proposed: number; settled: number; wins: number }>;
  liveActivityLast7d: {
    decisions: number;
    acted: number;
    settled: number;
    wins: number;
    losses: number;
    winRate: number;
  };
  errors?: string[];
}

const PHASE5_START_ISO = '2026-05-03T00:00:00Z';
const PHASE5_END_ISO = '2026-06-02T00:00:00Z';

export async function GET() {
  const errors: string[] = [];
  try {
    const phaseStartMs = new Date(PHASE5_START_ISO).getTime();
    const phaseEndMs = new Date(PHASE5_END_ISO).getTime();
    const nowMs = Date.now();
    const daysElapsed = Math.max(0, Math.floor((nowMs - phaseStartMs) / 86_400_000));
    const daysRemaining = Math.max(0, Math.ceil((phaseEndMs - nowMs) / 86_400_000));

    // Latest snapshot
    const { data: latestSnapshot, error: errLatest } = await supabase
      .from('poly_paper_forward_snapshots')
      .select('*')
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (errLatest) errors.push(`latestSnapshot: ${errLatest.message}`);

    // Last 30 snapshots
    const { data: recentRows, error: errRecent } = await supabase
      .from('poly_paper_forward_snapshots')
      .select(
        'snapshot_at, wallet_realized_pnl_usdc, wallet_unrealized_pnl_usdc, wallet_balance_usdc, open_positions_count, win_rate_24h, max_dd_pct, dd_alarm_triggered, settlement_backlog_count',
      )
      .order('snapshot_at', { ascending: true })
      .limit(30);
    if (errRecent) errors.push(`recentSnapshots: ${errRecent.message}`);

    // Latest weekly report
    const { data: latestWeekly, error: errWeekly } = await supabase
      .from('poly_weekly_reports')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (errWeekly) errors.push(`weekly: ${errWeekly.message}`);

    // Shadow stats last 7d
    const since7d = new Date(nowMs - 7 * 86_400_000).toISOString();
    const { data: shadowRows } = await supabase
      .from('poly_shadow_proposals')
      .select('strategy_id, settled_at, shadow_won')
      .gte('proposed_at', since7d);

    const shadowStats: Record<string, { proposed: number; settled: number; wins: number }> = {};
    for (const r of shadowRows ?? []) {
      const sid = (r.strategy_id as string) ?? 'unknown';
      if (!shadowStats[sid]) shadowStats[sid] = { proposed: 0, settled: 0, wins: 0 };
      shadowStats[sid].proposed++;
      if (r.settled_at) shadowStats[sid].settled++;
      if (r.shadow_won) shadowStats[sid].wins++;
    }

    // Live activity last 7d
    const { data: liveRows } = await supabase
      .from('polymarket_decisions')
      .select('decision_id, acted, settled_at, settled_outcome, direction')
      .gte('decided_at', since7d);

    let acted = 0;
    let settled = 0;
    let wins = 0;
    let losses = 0;
    const decisions = (liveRows ?? []).length;
    for (const r of liveRows ?? []) {
      if (r.acted) acted++;
      if (r.settled_at) settled++;
      if (
        (r.settled_outcome === 'YES' && r.direction === 'BUY_YES') ||
        (r.settled_outcome === 'NO' && r.direction === 'BUY_NO')
      ) {
        wins++;
      } else if (r.settled_outcome != null && r.settled_outcome !== 'CANCEL') {
        losses++;
      }
    }
    const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;

    const body: Phase5DashboardResponse = {
      status: 'ok',
      phaseStart: PHASE5_START_ISO,
      phaseEnd: PHASE5_END_ISO,
      daysElapsed,
      daysRemaining,
      latestSnapshot: (latestSnapshot as Record<string, unknown>) ?? null,
      recentSnapshots: (recentRows ?? []) as Phase5DashboardResponse['recentSnapshots'],
      latestWeeklyReport: (latestWeekly as Record<string, unknown>) ?? null,
      shadowStats,
      liveActivityLast7d: { decisions, acted, settled, wins, losses, winRate },
      errors: errors.length > 0 ? errors : undefined,
    };

    return NextResponse.json(body);
  } catch (err) {
    log.error('phase5 dashboard error', { error: String(err) });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 },
    );
  }
}
