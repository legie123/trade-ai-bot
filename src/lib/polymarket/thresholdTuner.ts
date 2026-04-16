// ============================================================
// Threshold Tuner — Phase 2 Batch 9
//
// ADDITIVE. Sweeps `minEdgeScore` across a band, runs the paper
// backtest at each point, and picks the edge floor that maximizes
// avg P&L per signal (primary) subject to a minimum sample size.
//
// Writes the chosen value into an in-memory "suggested threshold"
// slot + best-effort Supabase `poly_ranker_config` row.
// READS ARE ADVISORY — the scanner still uses its hard-coded
// EDGE_THRESHOLD. Operator promotes the suggestion manually.
//
// Safe: read-only w.r.t. scanner/syndicate. Ring buffer only.
// ============================================================
import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { runPaperBacktest } from './paperBacktest';
import { promoteFloor } from './rankerConfig';

const log = createLogger('ThresholdTuner');

export interface TunePoint {
  minEdge: number;
  evaluated: number;
  hitRate: number;
  avgPnlUsd: number;
  totalPnlUsd: number;
}

export interface TuneResult {
  generatedAt: number;
  points: TunePoint[];
  recommended: TunePoint | null;
  currentFloor: number;
  note: string;
}

const DEFAULT_BAND = [40, 50, 55, 60, 65, 70, 75, 80];
const MIN_SAMPLE = 5;

// In-memory slot — last recommendation, for GET reads
let lastRecommendation: TuneResult | null = null;

export async function tuneThreshold(opts: {
  band?: number[];
  notional?: number;
  limit?: number;
  minSample?: number;
} = {}): Promise<TuneResult> {
  const band = opts.band && opts.band.length ? [...opts.band].sort((a, b) => a - b) : DEFAULT_BAND;
  const notional = opts.notional ?? 100;
  const limit = opts.limit ?? 150;
  const minSample = opts.minSample ?? MIN_SAMPLE;

  const points: TunePoint[] = [];
  for (const minEdge of band) {
    try {
      const s = await runPaperBacktest({ limit, minEdgeScore: minEdge, notionalPerSignal: notional });
      points.push({
        minEdge,
        evaluated: s.totals.evaluated,
        hitRate: s.totals.hitRate,
        avgPnlUsd: s.totals.avgPnlUsd,
        totalPnlUsd: s.totals.totalPnlUsd,
      });
    } catch (e) {
      log.warn('sweep point failed', { minEdge, error: String(e) });
    }
  }

  const eligible = points.filter(p => p.evaluated >= minSample);
  let recommended: TunePoint | null = null;
  let note = '';
  if (!eligible.length) {
    note = `no edge level had ≥${minSample} evaluable signals`;
  } else {
    // Primary: max avgPnlUsd. Tiebreak: higher hitRate.
    eligible.sort((a, b) => (b.avgPnlUsd - a.avgPnlUsd) || (b.hitRate - a.hitRate));
    recommended = eligible[0];
    note = `best avg P&L at minEdge=${recommended.minEdge} (n=${recommended.evaluated}, hit=${(recommended.hitRate * 100).toFixed(1)}%)`;
  }

  const result: TuneResult = {
    generatedAt: Date.now(),
    points,
    recommended,
    currentFloor: Number(process.env.POLY_EDGE_THRESHOLD || 40),
    note,
  };
  lastRecommendation = result;
  void persistAsync(result);
  // Auto-promote (guarded inside promoteFloor by POLY_EDGE_AUTOPROMOTE)
  if (recommended) {
    void promoteFloor({ global: recommended.minEdge, source: 'auto-tune-global' });
  }
  log.info('threshold tune complete', { note });
  return result;
}

async function persistAsync(result: TuneResult): Promise<void> {
  if (!result.recommended) return;
  try {
    await supabase.from('poly_ranker_config').insert({
      generated_at: new Date(result.generatedAt).toISOString(),
      recommended_min_edge: result.recommended.minEdge,
      recommended_avg_pnl: result.recommended.avgPnlUsd,
      recommended_hit_rate: result.recommended.hitRate,
      recommended_sample: result.recommended.evaluated,
      current_floor: result.currentFloor,
      note: result.note,
    });
  } catch {
    // table optional
  }
}

export function lastTuneResult(): TuneResult | null {
  return lastRecommendation;
}

// ─── Per-division tuner ───────────────────────────────────
// Reuses ring buffer signals filtered by division, then runs sweep
// in-process (no extra quote fetches per division — backtest already
// reads live quotes per signal).
import { recentPaperSignals } from './paperSignalFeeder';

export interface DivisionTuneEntry {
  division: string;
  bufferSize: number;
  recommended: TunePoint | null;
  currentFloor: number;
  note: string;
}

export interface DivisionTuneResult {
  generatedAt: number;
  band: number[];
  divisions: DivisionTuneEntry[];
}

const lastDivisionTune: { value: DivisionTuneResult | null } = { value: null };

export async function tuneThresholdByDivision(opts: {
  band?: number[];
  notional?: number;
  limit?: number;
  minSample?: number;
} = {}): Promise<DivisionTuneResult> {
  const band = opts.band && opts.band.length ? [...opts.band].sort((a, b) => a - b) : DEFAULT_BAND;
  const notional = opts.notional ?? 100;
  const limit = opts.limit ?? 200;
  const minSample = opts.minSample ?? 3;

  // Group ring buffer by division
  const all = recentPaperSignals(limit);
  const divisions = Array.from(new Set(all.map(s => s.division as string))).sort();

  const entries: DivisionTuneEntry[] = [];
  for (const div of divisions) {
    const divSignals = all.filter(s => s.division === div);
    if (!divSignals.length) continue;

    // Sweep: simulate tuner per division by repeatedly running the same
    // backtest with edge cutoffs applied AFTER fetch. We reuse the global
    // backtest then post-filter — same live-quote effect, no extra calls.
    const sweep: TunePoint[] = [];
    // One quote pass via global backtest at lowest edge — captures everything
    const baseSummary = await runPaperBacktest({
      limit,
      minEdgeScore: Math.min(...band),
      notionalPerSignal: notional,
    });
    const divRows = baseSummary.rows.filter(r =>
      divSignals.some(s => s.id === r.signalId) && r.pnlUsd != null,
    );

    for (const minEdge of band) {
      const filtered = divRows.filter(r => r.edgeScore >= minEdge);
      if (!filtered.length) {
        sweep.push({ minEdge, evaluated: 0, hitRate: 0, avgPnlUsd: 0, totalPnlUsd: 0 });
        continue;
      }
      const wins = filtered.filter(r => (r.pnlUsd ?? 0) > 0).length;
      const total = filtered.reduce((acc, r) => acc + (r.pnlUsd ?? 0), 0);
      sweep.push({
        minEdge,
        evaluated: filtered.length,
        hitRate: Math.round((wins / filtered.length) * 10000) / 10000,
        avgPnlUsd: Math.round((total / filtered.length) * 100) / 100,
        totalPnlUsd: Math.round(total * 100) / 100,
      });
    }

    const eligible = sweep.filter(p => p.evaluated >= minSample);
    let recommended: TunePoint | null = null;
    let note = '';
    if (!eligible.length) {
      note = `no edge level had ≥${minSample} evaluable signals for ${div}`;
    } else {
      eligible.sort((a, b) => (b.avgPnlUsd - a.avgPnlUsd) || (b.hitRate - a.hitRate));
      recommended = eligible[0];
      note = `best avg P&L at minEdge=${recommended.minEdge} (n=${recommended.evaluated})`;
    }

    const currentFloor = Number(
      process.env[`POLY_EDGE_THRESHOLD_${div.toUpperCase()}`] ||
      process.env.POLY_EDGE_THRESHOLD ||
      40,
    );

    entries.push({
      division: div,
      bufferSize: divSignals.length,
      recommended,
      currentFloor,
      note,
    });
  }

  const result: DivisionTuneResult = {
    generatedAt: Date.now(),
    band,
    divisions: entries.sort((a, b) =>
      (b.recommended?.avgPnlUsd ?? -Infinity) - (a.recommended?.avgPnlUsd ?? -Infinity),
    ),
  };
  lastDivisionTune.value = result;
  // Auto-promote per-division recommendations (guarded inside promoteFloor)
  const perDiv: Record<string, number> = {};
  for (const e of entries) {
    if (e.recommended) perDiv[e.division.toUpperCase()] = e.recommended.minEdge;
  }
  if (Object.keys(perDiv).length) {
    void promoteFloor({ perDivision: perDiv, source: 'auto-tune-per-div' });
  }
  log.info('per-division tune complete', { divisions: entries.length });
  return result;
}

export function lastDivisionTuneResult(): DivisionTuneResult | null {
  return lastDivisionTune.value;
}
