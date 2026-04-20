/**
 * learningLoop.ts — Polymarket adaptation engine (FAZA 3.6 + 3.7).
 *
 * SCOPE:
 *   FAZA 3.6 layer (always-on, embargo-protected look-ahead safety):
 *     1. Per-division activity & selection lift
 *        - decisions logged, acted, acted_rate
 *        - avg edge_score acted vs skipped (selection lift = discrimination)
 *     2. Skip-reason histogram per division
 *     3. Factor drift week-over-week
 *        - distribution of edge / goldsky / karma / liquidity / final multipliers
 *     4. Gladiator dormancy
 *
 *   FAZA 3.7 layer (added 2026-04-20, gated by settlement column presence):
 *     5. Real WR / PF / avg pnl % per division using settled_* columns
 *        from polymarket_decisions (populated by settlementHook on close).
 *        - DOES count CANCEL outcomes separately (refund, not real W/L).
 *        - PF = sum(wins) / abs(sum(losses)). null when losses = 0.
 *        - WR = wins / (wins + losses) = wins / nDecisive (excludes cancel).
 *        - Sample-size gate: n_settled >= 10 before surfacing WR < 50%
 *          warnings. Below that, signals are noise.
 *
 * EMBARGO (FAZA 3.6 only): drops decisions from last EMBARGO_HOURS (default
 * 24h). Settlement stats DO NOT apply embargo because the outcome is already
 * known (settled_at not null means market closed, look-ahead cannot leak).
 *
 * KILL-SWITCHES
 *   POLY_LEARNING_ENABLED=0 → returns { enabled: false } (endpoint OK)
 *   (FAZA 3.7 settle-side kill-switch lives in settlementHook.ts)
 *
 * SAFETY: pure read-side. Never writes to polymarket_decisions, gladiators,
 * or wallet. Soft-fails to empty report on Supabase outage.
 *
 * ASUMPTII care invalideaza:
 * - settled_pnl_pct is authoritative for WR math — if settlementHook writes
 *   gross instead of net, WR stays valid but PF becomes optimistic.
 * - settled_outcome ∈ {YES, NO, CANCEL}. Other values are treated as
 *   CANCEL-equivalent (excluded from WR) to fail safe.
 * - enough settled rows (>= 10) exist before WR is a meaningful signal.
 *   Below that, we show n but suppress warnings.
 */
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyLearning');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supa = (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('placeholder'))
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

const EMBARGO_HOURS = Number.parseFloat(process.env.POLY_LEARNING_EMBARGO_HOURS ?? '24');
const WINDOW_DAYS = Number.parseFloat(process.env.POLY_LEARNING_WINDOW_DAYS ?? '7');
const DORMANT_DAYS = Number.parseFloat(process.env.POLY_LEARNING_DORMANT_DAYS ?? '7');

interface DecisionRow {
  decision_id: string;
  gladiator_id: string;
  division: string;
  direction: string;
  edge_score: number | null;
  goldsky_confirm: number | null;
  moltbook_karma: number | null;
  liquidity_sanity: number | null;
  final_score: number | null;
  acted: boolean;
  skip_reason: string | null;
  decided_at: string;
  // FAZA 3.7 — settlement columns (nullable until settlementHook writes)
  settled_at: string | null;
  settled_pnl_pct: number | null;   // realized PnL as % of capital, net of fees
  settled_pnl_usd: number | null;   // realized PnL in USD, net of fees
  settled_outcome: string | null;   // 'YES' | 'NO' | 'CANCEL'
  horizon_ms: number | null;        // enteredAt → settled_at, ms
}

export interface DivisionSummary {
  division: string;
  decisions: number;
  acted: number;
  actedRate: number;
  avgEdgeActed: number | null;
  avgEdgeSkipped: number | null;
  /** edge selection lift = acted_avg − skipped_avg. >0 means we act on
   *  higher-edge signals. Negative is a red flag (anti-selection). */
  edgeSelectionLift: number | null;
  topSkipReasons: Array<{ reason: string; count: number }>;
}

export interface FactorDistribution {
  factor: 'edge_score' | 'goldsky_confirm' | 'moltbook_karma' | 'liquidity_sanity' | 'final_score';
  n: number;
  mean: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
}

export interface FactorDrift {
  factor: FactorDistribution['factor'];
  current: { mean: number | null; n: number };
  prior: { mean: number | null; n: number };
  /** absolute mean delta (current − prior); null if either window empty */
  meanDelta: number | null;
  /** relative drift (delta / |prior_mean|); >0.20 worth flagging */
  meanRelDelta: number | null;
}

export interface GladiatorActivity {
  gladiatorId: string;
  division: string;
  decisions7d: number;
  acted7d: number;
  lastDecisionAt: string | null;
  daysSinceLastDecision: number | null;
  dormant: boolean;
}

/**
 * FAZA 3.7 — per-scope settlement stats (overall + per-division).
 * Populated from polymarket_decisions.settled_* columns. NO embargo applied:
 * the outcome is already known at settle time, look-ahead cannot leak.
 */
export interface SettlementStats {
  scope: string;               // 'OVERALL' | division name
  nSettled: number;            // rows with settled_at NOT NULL in window
  nDecisive: number;           // nSettled − cancelCount (used as WR denom)
  cancelCount: number;         // settled_outcome = 'CANCEL'
  cancelRate: number;          // cancelCount / nSettled (0 if nSettled=0)
  wins: number;                // settled_pnl_pct > 0
  losses: number;              // settled_pnl_pct < 0
  /** wins / nDecisive. null if nDecisive=0 (guards divide-by-zero). */
  winRate: number | null;
  /** sum(wins_pct) / abs(sum(losses_pct)). null if no losing rows. */
  profitFactor: number | null;
  avgPnlPct: number | null;    // mean of settled_pnl_pct (decisive rows only)
  medianPnlPct: number | null; // median of settled_pnl_pct (decisive rows)
  totalPnlUsd: number;         // sum of settled_pnl_usd (all decisive rows)
  medianHorizonHours: number | null; // median of horizon_ms / 3_600_000
}

export interface WeeklyLearningReport {
  enabled: boolean;
  generatedAt: string;
  windowDays: number;
  embargoHours: number;
  totalDecisions: number;
  totalActed: number;
  divisionSummaries: DivisionSummary[];
  factorDistributions: FactorDistribution[];
  factorDrift: FactorDrift[];
  gladiatorActivity: GladiatorActivity[];
  dormantGladiators: GladiatorActivity[];
  /** FAZA 3.7 — empty array if no settled rows exist in window */
  settlementStats: SettlementStats[];
  warnings: string[];
}

function isLearningEnabled(): boolean {
  return (process.env.POLY_LEARNING_ENABLED ?? '1') !== '0';
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function distributionFor(factor: FactorDistribution['factor'], rows: DecisionRow[]): FactorDistribution {
  const vals: number[] = [];
  for (const r of rows) {
    const v = r[factor];
    if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  if (!vals.length) return { factor, n: 0, mean: null, p25: null, p50: null, p75: null };
  const sum = vals.reduce((s, x) => s + x, 0);
  return {
    factor,
    n: vals.length,
    mean: sum / vals.length,
    p25: quantile(vals, 0.25),
    p50: quantile(vals, 0.5),
    p75: quantile(vals, 0.75),
  };
}

function topReasons(rows: DecisionRow[], k = 3): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.acted || !r.skip_reason) continue;
    counts.set(r.skip_reason, (counts.get(r.skip_reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([reason, count]) => ({ reason, count }));
}

function buildDivisionSummaries(rows: DecisionRow[]): DivisionSummary[] {
  const byDiv = new Map<string, DecisionRow[]>();
  for (const r of rows) {
    const k = r.division || 'UNKNOWN';
    if (!byDiv.has(k)) byDiv.set(k, []);
    byDiv.get(k)!.push(r);
  }
  const out: DivisionSummary[] = [];
  for (const [division, divRows] of byDiv.entries()) {
    const acted = divRows.filter(r => r.acted);
    const skipped = divRows.filter(r => !r.acted);
    const avgEdge = (xs: DecisionRow[]) => {
      const vals = xs.map(r => r.edge_score).filter((v): v is number => typeof v === 'number');
      if (!vals.length) return null;
      return vals.reduce((s, x) => s + x, 0) / vals.length;
    };
    const ea = avgEdge(acted);
    const es = avgEdge(skipped);
    out.push({
      division,
      decisions: divRows.length,
      acted: acted.length,
      actedRate: divRows.length > 0 ? acted.length / divRows.length : 0,
      avgEdgeActed: ea,
      avgEdgeSkipped: es,
      edgeSelectionLift: ea != null && es != null ? ea - es : null,
      topSkipReasons: topReasons(divRows),
    });
  }
  // Sort by activity desc
  out.sort((a, b) => b.decisions - a.decisions);
  return out;
}

function buildGladiatorActivity(rows: DecisionRow[]): GladiatorActivity[] {
  const byGlad = new Map<string, { division: string; decisions: DecisionRow[] }>();
  for (const r of rows) {
    if (!byGlad.has(r.gladiator_id)) byGlad.set(r.gladiator_id, { division: r.division, decisions: [] });
    byGlad.get(r.gladiator_id)!.decisions.push(r);
  }
  const now = Date.now();
  const dormantThreshMs = DORMANT_DAYS * 86_400_000;
  const out: GladiatorActivity[] = [];
  for (const [gid, { division, decisions }] of byGlad.entries()) {
    const lastTs = decisions
      .map(d => new Date(d.decided_at).getTime())
      .filter(t => Number.isFinite(t))
      .reduce((m, t) => Math.max(m, t), 0);
    const daysSince = lastTs > 0 ? (now - lastTs) / 86_400_000 : null;
    out.push({
      gladiatorId: gid,
      division,
      decisions7d: decisions.length,
      acted7d: decisions.filter(d => d.acted).length,
      lastDecisionAt: lastTs > 0 ? new Date(lastTs).toISOString() : null,
      daysSinceLastDecision: daysSince,
      dormant: lastTs > 0 ? (now - lastTs) > dormantThreshMs : true,
    });
  }
  out.sort((a, b) => b.decisions7d - a.decisions7d);
  return out;
}

/**
 * FAZA 3.7 — compute SettlementStats for a single scope (OVERALL or division).
 * Only consumes rows where settled_at IS NOT NULL.
 * CANCEL outcomes are reported separately and excluded from WR / PF math
 * (they are refunds, not real wins/losses).
 *
 * Invariants:
 * - If 0 settled rows → all aggregates null/0, winRate/profitFactor=null.
 * - If all decisive rows are wins → profitFactor=null (no loss denom).
 * - Otherwise numeric. `winRate` ∈ [0,1].
 */
function buildSettlementStats(rows: DecisionRow[], scope: string): SettlementStats {
  const settled = rows.filter(r => r.settled_at != null);
  const nSettled = settled.length;
  const cancelCount = settled.filter(r => (r.settled_outcome ?? '').toUpperCase() === 'CANCEL').length;
  const decisive = settled.filter(r => {
    const outcome = (r.settled_outcome ?? '').toUpperCase();
    return outcome === 'YES' || outcome === 'NO';
  });
  const nDecisive = decisive.length;

  // Extract pnl_pct from decisive rows only (valid finite numbers)
  const pnls: number[] = [];
  let sumPnlUsd = 0;
  for (const r of decisive) {
    const pct = r.settled_pnl_pct;
    if (typeof pct === 'number' && Number.isFinite(pct)) pnls.push(pct);
    const usd = r.settled_pnl_usd;
    if (typeof usd === 'number' && Number.isFinite(usd)) sumPnlUsd += usd;
  }

  const wins = pnls.filter(p => p > 0).length;
  const losses = pnls.filter(p => p < 0).length;
  // NOTE: pnl==0 counted as neither. Happens on exact-entry exits (rare) or
  // near-zero settlement. Bias-neutral.
  const sumWins = pnls.filter(p => p > 0).reduce((s, x) => s + x, 0);
  const sumLossesAbs = Math.abs(pnls.filter(p => p < 0).reduce((s, x) => s + x, 0));

  const winRate = nDecisive > 0 ? wins / nDecisive : null;
  const profitFactor = sumLossesAbs > 0 ? sumWins / sumLossesAbs : null;
  const avgPnlPct = pnls.length > 0 ? pnls.reduce((s, x) => s + x, 0) / pnls.length : null;
  const pnlsSorted = [...pnls].sort((a, b) => a - b);
  const medianPnlPct = quantile(pnlsSorted, 0.5);

  // Horizon stats (use all settled rows with valid horizon_ms, not just decisive)
  const horizons: number[] = [];
  for (const r of settled) {
    const h = r.horizon_ms;
    if (typeof h === 'number' && Number.isFinite(h) && h >= 0) horizons.push(h);
  }
  horizons.sort((a, b) => a - b);
  const medianHorizonMs = quantile(horizons, 0.5);
  const medianHorizonHours = medianHorizonMs != null ? medianHorizonMs / 3_600_000 : null;

  return {
    scope,
    nSettled,
    nDecisive,
    cancelCount,
    cancelRate: nSettled > 0 ? cancelCount / nSettled : 0,
    wins,
    losses,
    winRate,
    profitFactor,
    avgPnlPct,
    medianPnlPct,
    totalPnlUsd: sumPnlUsd,
    medianHorizonHours,
  };
}

function buildAllSettlementStats(rows: DecisionRow[]): SettlementStats[] {
  const out: SettlementStats[] = [];
  const overall = buildSettlementStats(rows, 'OVERALL');
  // Only emit OVERALL row if any settled rows exist, else empty report.
  if (overall.nSettled === 0) return out;
  out.push(overall);

  const byDiv = new Map<string, DecisionRow[]>();
  for (const r of rows) {
    if (r.settled_at == null) continue;
    const k = r.division || 'UNKNOWN';
    if (!byDiv.has(k)) byDiv.set(k, []);
    byDiv.get(k)!.push(r);
  }
  for (const [div, divRows] of byDiv.entries()) {
    out.push(buildSettlementStats(divRows, div));
  }
  // Sort non-overall by nSettled desc for operator priority
  const [ov, ...rest] = out;
  rest.sort((a, b) => b.nSettled - a.nSettled);
  return [ov, ...rest];
}

function buildFactorDrift(current: DecisionRow[], prior: DecisionRow[]): FactorDrift[] {
  const factors: FactorDistribution['factor'][] = [
    'edge_score',
    'goldsky_confirm',
    'moltbook_karma',
    'liquidity_sanity',
    'final_score',
  ];
  const out: FactorDrift[] = [];
  for (const f of factors) {
    const c = distributionFor(f, current);
    const p = distributionFor(f, prior);
    let delta: number | null = null;
    let rel: number | null = null;
    if (c.mean != null && p.mean != null) {
      delta = c.mean - p.mean;
      rel = Math.abs(p.mean) > 1e-6 ? delta / Math.abs(p.mean) : null;
    }
    out.push({
      factor: f,
      current: { mean: c.mean, n: c.n },
      prior: { mean: p.mean, n: p.n },
      meanDelta: delta,
      meanRelDelta: rel,
    });
  }
  return out;
}

export async function buildWeeklyReport(): Promise<WeeklyLearningReport> {
  const generatedAt = new Date().toISOString();
  const empty: WeeklyLearningReport = {
    enabled: false,
    generatedAt,
    windowDays: WINDOW_DAYS,
    embargoHours: EMBARGO_HOURS,
    totalDecisions: 0,
    totalActed: 0,
    divisionSummaries: [],
    factorDistributions: [],
    factorDrift: [],
    gladiatorActivity: [],
    dormantGladiators: [],
    settlementStats: [],
    warnings: [],
  };

  if (!isLearningEnabled()) {
    return { ...empty, warnings: ['POLY_LEARNING_ENABLED=0'] };
  }
  if (!supa) {
    return { ...empty, enabled: true, warnings: ['supabase_unconfigured'] };
  }

  // Window boundaries (UTC ms)
  const now = Date.now();
  const embargoMs = EMBARGO_HOURS * 3_600_000;
  const windowMs = WINDOW_DAYS * 86_400_000;
  const currentEnd = now - embargoMs;             // exclude last 24h
  const currentStart = currentEnd - windowMs;     // 7d window
  const priorEnd = currentStart;
  const priorStart = priorEnd - windowMs;         // prior 7d for drift

  try {
    // Fetch decisions for both windows in two queries (cleaner than
    // single fetch + client filter when row counts grow).
    const fetchWin = async (startMs: number, endMs: number): Promise<DecisionRow[]> => {
      // FAZA 3.7 — SELECT extended with settled_* columns; migration
      // 20260420_polymarket_decision_settlement.sql adds these as nullable so
      // existing rows without settlement just return null (handled downstream).
      // If migration not yet applied, Supabase returns error → soft-fail to [].
      const { data, error } = await supa
        .from('polymarket_decisions')
        .select('decision_id, gladiator_id, division, direction, edge_score, goldsky_confirm, moltbook_karma, liquidity_sanity, final_score, acted, skip_reason, decided_at, settled_at, settled_pnl_pct, settled_pnl_usd, settled_outcome, horizon_ms')
        .gte('decided_at', new Date(startMs).toISOString())
        .lt('decided_at', new Date(endMs).toISOString())
        .order('decided_at', { ascending: false })
        .limit(10_000);
      if (error) {
        log.warn('fetch window failed', { error: error.message, startMs, endMs });
        return [];
      }
      return (data || []) as DecisionRow[];
    };

    const [current, prior] = await Promise.all([
      fetchWin(currentStart, currentEnd),
      fetchWin(priorStart, priorEnd),
    ]);

    const totalActed = current.filter(d => d.acted).length;
    const divisionSummaries = buildDivisionSummaries(current);
    const factorDistributions = (['edge_score', 'goldsky_confirm', 'moltbook_karma', 'liquidity_sanity', 'final_score'] as const)
      .map(f => distributionFor(f, current));
    const factorDrift = buildFactorDrift(current, prior);
    const gladiatorActivity = buildGladiatorActivity(current);
    const dormant = gladiatorActivity.filter(g => g.dormant);

    // FAZA 3.7 — settlement stats use the FULL current-window rows (settled
    // ones only filtered inside buildSettlementStats). NO embargo strip:
    // settled_at NOT NULL means the market resolved, no look-ahead leak.
    const settlementStats = buildAllSettlementStats(current);

    const warnings: string[] = [];
    if (current.length === 0) warnings.push('no decisions in current window');
    if (prior.length === 0) warnings.push('no decisions in prior window — drift not computable');
    for (const div of divisionSummaries) {
      if (div.edgeSelectionLift != null && div.edgeSelectionLift < 0) {
        warnings.push(`anti-selection: ${div.division} acts on lower edge than it skips (lift=${div.edgeSelectionLift.toFixed(2)})`);
      }
    }
    for (const fd of factorDrift) {
      if (fd.meanRelDelta != null && Math.abs(fd.meanRelDelta) > 0.20) {
        warnings.push(`factor drift: ${fd.factor} ${(fd.meanRelDelta * 100).toFixed(1)}% (${fd.prior.mean?.toFixed(2)} → ${fd.current.mean?.toFixed(2)})`);
      }
    }
    if (dormant.length > 0) {
      warnings.push(`${dormant.length} gladiator(s) dormant >${DORMANT_DAYS}d`);
    }
    // FAZA 3.7 — settlement-side warnings.
    // Sample-size gate: WR<50% on n<10 is statistical noise, suppressed.
    // This protects against shutting down a strategy on 2-3 unlucky resolutions.
    const SETTLEMENT_MIN_SAMPLE = Number.parseInt(process.env.POLY_SETTLEMENT_MIN_SAMPLE ?? '10', 10);
    for (const ss of settlementStats) {
      if (ss.scope === 'OVERALL') continue; // overall-level losses already implied by per-div detail
      if (ss.nDecisive >= SETTLEMENT_MIN_SAMPLE && ss.winRate != null && ss.winRate < 0.50) {
        warnings.push(`underwater: ${ss.scope} WR=${(ss.winRate * 100).toFixed(1)}% n=${ss.nDecisive} (decisive)`);
      }
      if (ss.nDecisive >= SETTLEMENT_MIN_SAMPLE && ss.profitFactor != null && ss.profitFactor < 1.0) {
        warnings.push(`unprofitable: ${ss.scope} PF=${ss.profitFactor.toFixed(2)} n=${ss.nDecisive}`);
      }
      if (ss.nSettled >= SETTLEMENT_MIN_SAMPLE && ss.cancelRate > 0.30) {
        warnings.push(`high cancel rate: ${ss.scope} ${(ss.cancelRate * 100).toFixed(1)}% (n_settled=${ss.nSettled})`);
      }
    }

    return {
      enabled: true,
      generatedAt,
      windowDays: WINDOW_DAYS,
      embargoHours: EMBARGO_HOURS,
      totalDecisions: current.length,
      totalActed,
      divisionSummaries,
      factorDistributions,
      factorDrift,
      gladiatorActivity,
      dormantGladiators: dormant,
      settlementStats,
      warnings,
    };
  } catch (err) {
    log.warn('buildWeeklyReport threw', { error: String(err) });
    return { ...empty, enabled: true, warnings: [`exception: ${String(err)}`] };
  }
}

export function getLearningConfig() {
  return {
    enabled: isLearningEnabled(),
    windowDays: WINDOW_DAYS,
    embargoHours: EMBARGO_HOURS,
    dormantDays: DORMANT_DAYS,
  };
}
