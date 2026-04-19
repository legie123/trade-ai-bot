// ============================================================
// RUFLO FAZA 3 Batch 5/9 — Gladiators Graveyard
// ============================================================
// PROBLEM (survivorship bias):
//   TheButcher.executeWeaklings() calls saveGladiatorsToDb(survivors)
//   with zero audit trail. Killed gladiators are permanently lost.
//   Any aggregate stat computed afterwards over gladiatorStore is
//   biased UPWARDS: WR/PF come only from those that survived selection.
//   Kelly fractional sizing (Batch 4) derives multipliers from these
//   stats → systematically over-sizes positions.
//
// FIX (append-only, non-destructive):
//   Before the purge, append killed rows to a dedicated table.
//   Aggregate population stats can then be computed over
//   (gladiatorStore ∪ graveyard).
//
// SAFETY:
//   - Feature-flagged (BUTCHER_GRAVEYARD_ENABLED): default 'shadow'
//     means we record but do NOT affect kill flow. 'off' skips entirely.
//   - Fail-soft: if Supabase is not configured OR the table does not
//     exist (migration not yet applied), log a warn and return — the
//     Butcher's existing kill path continues unchanged.
//   - Append-only: no UPDATE/DELETE on graveyard. Forensic-grade.
//
// KILL-SWITCH:
//   BUTCHER_GRAVEYARD_ENABLED=off     → do nothing
//   BUTCHER_GRAVEYARD_ENABLED=shadow  → write to DB (default)
//   BUTCHER_GRAVEYARD_ENABLED=active  → same as shadow for now,
//     reserved for future: "require successful graveyard write before
//     purging live row". Not wired yet — too risky for a first pass.
//
// ASSUMPTIONS (if violated → memory stale, revisit):
//   - Table gladiators_graveyard exists per
//     supabase/migrations/20260419_gladiators_graveyard.sql
//   - SUPABASE_SERVICE_ROLE_KEY (or anon) is set in env — same path
//     as the rest of src/lib/store/db.ts
//   - Gladiator dna / stats shapes are stable (Gladiator interface).
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/core/logger';
import type { Gladiator } from '@/lib/types/gladiator';

const log = createLogger('Graveyard');

// ------------------------------------------------------------
// Config / mode
// ------------------------------------------------------------

export type GraveyardMode = 'off' | 'shadow' | 'active';

export function getGraveyardMode(): GraveyardMode {
  const raw = (process.env.BUTCHER_GRAVEYARD_ENABLED || 'shadow').toLowerCase();
  if (raw === 'off' || raw === 'active') return raw as GraveyardMode;
  return 'shadow';
}

// Reuse db.ts env convention. Intentionally NOT imported from db.ts
// to avoid circular deps (db.ts is large + has side-effect init).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const CONFIGURED = !!(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder'));

let _client: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!CONFIGURED) return null;
  if (!_client) _client = createClient(supabaseUrl, supabaseKey);
  return _client;
}

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface GraveyardEntry {
  id: number;
  gladiator_id: string;
  name: string;
  arena: string | null;
  rank: number | null;
  dna: unknown; // JSONB
  final_stats: Gladiator['stats'];
  kill_reason: string;
  killed_at: string; // ISO
}

export interface PopulationStats {
  alive: number;
  killed: number;
  total: number;
  // Trade-weighted WR/PF over ALIVE ∪ KILLED. Weighted by totalTrades to
  // reflect that a gladiator with 200 trades @ 55% WR carries more
  // statistical weight than one with 20 trades @ 70% WR.
  popWeightedWinRate: number; // 0..1
  popWeightedProfitFactor: number;
  // Raw (unweighted) to expose selection lift.
  aliveAvgWinRate: number; // 0..100 (matches Gladiator.stats units)
  killedAvgWinRate: number;
  selectionLiftPct: number; // aliveAvgWinRate - popWeighted*100
  sampleTrades: {
    alive: number;
    killed: number;
  };
}

// ------------------------------------------------------------
// Write path (called by TheButcher)
// ------------------------------------------------------------

/**
 * Record a killed gladiator. Fails soft — never throws, never blocks.
 * Returns true on write success, false on skip/failure (caller can log).
 */
export async function recordInGraveyard(
  g: Gladiator,
  killReason: string,
): Promise<boolean> {
  const mode = getGraveyardMode();
  if (mode === 'off') return false;

  const client = db();
  if (!client) {
    log.warn(`[Graveyard] supabase not configured — skipping record for ${g.id}`);
    return false;
  }

  try {
    const row = {
      gladiator_id: g.id,
      name: g.name,
      arena: g.arena ?? null,
      rank: typeof g.rank === 'number' ? g.rank : null,
      dna: g.dna ?? null,
      final_stats: g.stats,
      kill_reason: killReason.slice(0, 500), // sane cap
    };
    const { error } = await client.from('gladiators_graveyard').insert(row);
    if (error) {
      // Table missing → migration not applied yet. Log once, don't explode.
      log.warn(`[Graveyard] insert failed for ${g.id}: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    log.warn(`[Graveyard] unexpected exception for ${g.id}`, {
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ------------------------------------------------------------
// Read path (called by diag endpoint)
// ------------------------------------------------------------

export async function getGraveyardEntries(limit = 500): Promise<GraveyardEntry[]> {
  const client = db();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('gladiators_graveyard')
      .select('*')
      .order('killed_at', { ascending: false })
      .limit(limit);
    if (error) {
      log.warn(`[Graveyard] read failed: ${error.message}`);
      return [];
    }
    return (data || []) as GraveyardEntry[];
  } catch (err) {
    log.warn(`[Graveyard] read exception`, {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Merge alive (from store) + killed (from graveyard) into population stats.
 *
 * Weighted WR: Σ(winRate * totalTrades) / Σ(totalTrades). Percent → 0..1.
 * Weighted PF: Σ(PF * totalTrades) / Σ(totalTrades). Approximation — true
 *   PF over a merged population requires summing grossWins / grossLosses,
 *   which Gladiator.stats optionally provides. Use those when present.
 *
 * SELECTION LIFT (the bias we're exposing):
 *   lift = aliveAvgWR - popWeightedWR*100
 * If this is large (>10pp), Kelly derived from alive-only set is
 * DEMONSTRABLY over-sized. That's the kill-switch trigger for Batch 4
 * going active.
 */
export async function getPopulationStats(
  aliveGladiators: Gladiator[],
): Promise<PopulationStats> {
  const killed = await getGraveyardEntries(5000);

  const aliveNonOmega = aliveGladiators.filter((g) => !g.isOmega);

  const aliveTrades = aliveNonOmega.reduce((s, g) => s + (g.stats?.totalTrades ?? 0), 0);
  const killedTrades = killed.reduce(
    (s, k) => s + (k.final_stats?.totalTrades ?? 0),
    0,
  );
  const totalTrades = aliveTrades + killedTrades;

  let aliveWRSum = 0;
  let aliveWRCount = 0;
  let aliveWinsWeighted = 0;
  let aliveGW = 0;
  let aliveGL = 0;
  for (const g of aliveNonOmega) {
    const wr = g.stats?.winRate ?? 0; // 0..100
    const n = g.stats?.totalTrades ?? 0;
    aliveWRSum += wr;
    aliveWRCount += 1;
    aliveWinsWeighted += (wr / 100) * n;
    aliveGW += g.stats?.grossWins ?? 0;
    aliveGL += g.stats?.grossLosses ?? 0;
  }

  let killedWRSum = 0;
  let killedWRCount = 0;
  let killedWinsWeighted = 0;
  let killedGW = 0;
  let killedGL = 0;
  for (const k of killed) {
    const wr = k.final_stats?.winRate ?? 0;
    const n = k.final_stats?.totalTrades ?? 0;
    killedWRSum += wr;
    killedWRCount += 1;
    killedWinsWeighted += (wr / 100) * n;
    killedGW += k.final_stats?.grossWins ?? 0;
    killedGL += k.final_stats?.grossLosses ?? 0;
  }

  const popWeightedWinRate =
    totalTrades > 0 ? (aliveWinsWeighted + killedWinsWeighted) / totalTrades : 0;

  // Population PF: prefer true grossWins/grossLosses when available;
  // otherwise fall back to trade-weighted average of per-gladiator PF.
  let popWeightedProfitFactor = 0;
  const totalGW = aliveGW + killedGW;
  const totalGL = aliveGL + killedGL;
  if (totalGL > 0) {
    popWeightedProfitFactor = totalGW / totalGL;
  } else {
    // Fallback: weighted average of per-gladiator PF.
    let pfNum = 0;
    let pfDen = 0;
    for (const g of aliveNonOmega) {
      const pf = g.stats?.profitFactor ?? 0;
      const n = g.stats?.totalTrades ?? 0;
      pfNum += pf * n;
      pfDen += n;
    }
    for (const k of killed) {
      const pf = k.final_stats?.profitFactor ?? 0;
      const n = k.final_stats?.totalTrades ?? 0;
      pfNum += pf * n;
      pfDen += n;
    }
    popWeightedProfitFactor = pfDen > 0 ? pfNum / pfDen : 0;
  }

  const aliveAvgWinRate = aliveWRCount > 0 ? aliveWRSum / aliveWRCount : 0;
  const killedAvgWinRate = killedWRCount > 0 ? killedWRSum / killedWRCount : 0;
  const selectionLiftPct = aliveAvgWinRate - popWeightedWinRate * 100;

  return {
    alive: aliveNonOmega.length,
    killed: killed.length,
    total: aliveNonOmega.length + killed.length,
    popWeightedWinRate,
    popWeightedProfitFactor,
    aliveAvgWinRate,
    killedAvgWinRate,
    selectionLiftPct,
    sampleTrades: { alive: aliveTrades, killed: killedTrades },
  };
}

export function getGraveyardConfig() {
  return {
    mode: getGraveyardMode(),
    configured: CONFIGURED,
    tableName: 'gladiators_graveyard',
  };
}
