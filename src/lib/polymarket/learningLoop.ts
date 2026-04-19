/**
 * learningLoop.ts — Polymarket adaptation engine (FAZA 3.6).
 *
 * SCOPE (honest, narrow): we have decisions logged but NOT yet outcomes per
 * decision (would require settlement-time hook on position close — FAZA 3.7).
 * So this module does NOT compute WR per decision. It computes what IS
 * defensible from the data we actually have:
 *
 *   1. Per-division activity & selection lift
 *      - decisions logged, acted, acted_rate
 *      - avg edge_score acted vs skipped (selection lift = how aggressive is
 *        the act-vs-skip discrimination on edge alone)
 *   2. Skip-reason histogram per division
 *      - top reasons we abstain → tells operator which gate is binding
 *   3. Factor drift week-over-week
 *      - distribution of edge / goldsky / karma / liquidity multipliers,
 *        compared against the prior 7d window
 *   4. Gladiator dormancy
 *      - last_decision_at, decisions_7d, acted_7d per gladiator
 *      - operator can decide kill criteria; module does NOT auto-kill
 *
 * EMBARGO: drops decisions from last EMBARGO_HOURS (default 24h) so any
 * downstream settlement layer can catch up. Pure look-ahead protection.
 *
 * KILL-SWITCHES
 *   POLY_LEARNING_ENABLED=0 → returns { enabled: false } (endpoint OK)
 *
 * SAFETY: pure read-side. Never writes to polymarket_decisions, gladiators,
 * or wallet. Soft-fails to empty report on Supabase outage.
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
      const { data, error } = await supa
        .from('polymarket_decisions')
        .select('decision_id, gladiator_id, division, direction, edge_score, goldsky_confirm, moltbook_karma, liquidity_sanity, final_score, acted, skip_reason, decided_at')
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
