// ============================================================
// Phase 5 — Daily snapshot helper.
// Captures wallet+gladiator+activity state every 24h.
// ============================================================

import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { getWallet, getGladiators } from '@/lib/polymarket/polyState';
import { calculateUnrealizedPnL } from '@/lib/polymarket/polyWallet';

const log = createLogger('PaperForwardSnapshot');

export interface SnapshotResult {
  snapshotAt: string;
  walletBalance: number;
  walletInvested: number;
  walletUnrealizedPnl: number;
  walletRealizedPnl: number;
  openPositions: number;
  acted24h: number;
  settled24h: number;
  wins24h: number;
  losses24h: number;
  winRate24h: number;
  maxDdPct: number;
  ddAlarm: boolean;
  settlementBacklog: number;
  inserted: boolean;
}

const DD_ALARM_THRESHOLD_PCT = Math.max(
  1,
  Number.parseInt(process.env.POLY_DD_ALARM_THRESHOLD_PCT ?? '30', 10) || 30,
);

export async function captureDailySnapshot(): Promise<SnapshotResult> {
  const FROZEN = process.env.POLY_PAPER_FORWARD_FROZEN === '1';

  const wallet = getWallet();
  const gladiators = getGladiators();

  const openPositions = wallet.allPositions?.length ?? 0;
  const walletBalance = wallet.totalBalance ?? 0;
  const walletInvested = wallet.totalInvested ?? 0;
  const walletUnrealizedPnl = calculateUnrealizedPnL(wallet);
  const walletRealizedPnl = wallet.totalRealizedPnL ?? 0;

  // Last 24h activity from polymarket_decisions
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: actedRows } = await supabase
    .from('polymarket_decisions')
    .select('decision_id, acted, settled_at, settled_outcome, direction')
    .gte('decided_at', since);

  const acted24 = (actedRows ?? []).filter((r) => r.acted).length;
  const settled24 = (actedRows ?? []).filter((r) => r.settled_at != null).length;
  let wins24 = 0;
  let losses24 = 0;
  for (const r of actedRows ?? []) {
    if (r.settled_outcome === 'YES' && r.direction === 'BUY_YES') wins24++;
    else if (r.settled_outcome === 'NO' && r.direction === 'BUY_NO') wins24++;
    else if (r.settled_outcome != null && r.settled_outcome !== 'CANCEL') losses24++;
  }
  const wr24 = wins24 + losses24 > 0 ? wins24 / (wins24 + losses24) : 0;

  // Settlement backlog
  const { count: backlogCount } = await supabase
    .from('polymarket_decisions')
    .select('decision_id', { count: 'exact', head: true })
    .eq('acted', true)
    .is('settled_at', null);

  // Drawdown rolling 7d (simple peak-to-trough on realized pnl history from snapshots)
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: histRows } = await supabase
    .from('poly_paper_forward_snapshots')
    .select('wallet_realized_pnl_usdc, snapshot_at')
    .gte('snapshot_at', since7d)
    .order('snapshot_at', { ascending: true });

  const equityCurve = (histRows ?? []).map((r) => Number(r.wallet_realized_pnl_usdc ?? 0));
  equityCurve.push(walletRealizedPnl);
  let peak = -Infinity;
  let maxDdAbs = 0;
  for (const e of equityCurve) {
    if (e > peak) peak = e;
    const dd = peak - e;
    if (dd > maxDdAbs) maxDdAbs = dd;
  }
  const startEquity = equityCurve[0] ?? 0;
  const baseEquity = Math.abs(startEquity) > 1 ? Math.abs(startEquity) : 100;
  const maxDdPct = (maxDdAbs / baseEquity) * 100;
  const ddAlarm = maxDdPct > DD_ALARM_THRESHOLD_PCT;

  const envSnapshot = {
    POLY_STRATEGY_MODE: process.env.POLY_STRATEGY_MODE ?? 'momentum',
    POLY_AUTO_TRADE_TOP_N: process.env.POLY_AUTO_TRADE_TOP_N ?? '0',
    POLY_FLAT_BET_USD: process.env.POLY_FLAT_BET_USD ?? '0',
    POLY_RISK_GATE_ENABLED: process.env.POLY_RISK_GATE_ENABLED ?? '1',
    POLY_SHADOW_SYNDICATE_ENABLED: process.env.POLY_SHADOW_SYNDICATE_ENABLED ?? '0',
    gladiatorsActive: gladiators.filter((g) => g.isLive).length,
    gladiatorsTotal: gladiators.length,
  };

  let inserted = false;
  if (!FROZEN) {
    const { error: insertErr } = await supabase
      .from('poly_paper_forward_snapshots')
      .insert({
        config_label: 'paper_forward_v1',
        wallet_balance_usdc: walletBalance,
        wallet_invested_usdc: walletInvested,
        wallet_unrealized_pnl_usdc: walletUnrealizedPnl,
        wallet_realized_pnl_usdc: walletRealizedPnl,
        open_positions_count: openPositions,
        decisions_acted_24h: acted24,
        decisions_settled_24h: settled24,
        wins_24h: wins24,
        losses_24h: losses24,
        win_rate_24h: wr24,
        max_dd_pct: maxDdPct,
        dd_alarm_triggered: ddAlarm,
        settlement_backlog_count: backlogCount ?? 0,
        env_snapshot: envSnapshot,
      });
    if (insertErr) {
      log.warn('Snapshot insert failed (non-blocking)', { error: String(insertErr) });
    } else {
      inserted = true;
    }
  }

  if (ddAlarm) {
    log.warn('[DD ALARM] Drawdown threshold breached', {
      maxDdPct: maxDdPct.toFixed(2),
      threshold: DD_ALARM_THRESHOLD_PCT,
      walletRealizedPnl,
    });
  }

  return {
    snapshotAt: new Date().toISOString(),
    walletBalance,
    walletInvested,
    walletUnrealizedPnl,
    walletRealizedPnl,
    openPositions,
    acted24h: acted24,
    settled24h: settled24,
    wins24h: wins24,
    losses24h: losses24,
    winRate24h: wr24,
    maxDdPct,
    ddAlarm,
    settlementBacklog: backlogCount ?? 0,
    inserted,
  };
}
