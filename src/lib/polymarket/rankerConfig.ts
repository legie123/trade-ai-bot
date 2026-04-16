// ============================================================
// Ranker Runtime Config — Phase 2 Batch 11
//
// ADDITIVE. Supabase-backed runtime overrides for scanner edge floors.
// Avoids the env-flip cost on Cloud Run by storing promoted
// recommendations in `poly_ranker_active` (single-row keyed config).
//
// Resolution order (checked by scanner.getEdgeFloor):
//   POLY_EDGE_THRESHOLD_<DIV>   (env, per-div)   — hard override
//   POLY_EDGE_THRESHOLD         (env, global)    — hard override
//   runtime active.perDivision[DIV]              — operator-promoted
//   runtime active.global                        — operator-promoted
//   EDGE_THRESHOLD_DEFAULT (40)                  — hard-coded fallback
//
// Cache: 60s TTL. Refreshed on miss; never throws to scanner.
// ============================================================
import { supabase } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('RankerConfig');
const CACHE_TTL_MS = 60_000;

export interface ActiveConfig {
  global: number | null;
  perDivision: Record<string, number>;
  updatedAt: number;
}

const state: { cache: ActiveConfig | null; fetchedAt: number; inflight: Promise<ActiveConfig | null> | null } = {
  cache: null,
  fetchedAt: 0,
  inflight: null,
};

async function fetchActive(): Promise<ActiveConfig | null> {
  try {
    const { data, error } = await supabase
      .from('poly_ranker_active')
      .select('global_floor, per_division, updated_at')
      .eq('id', 1)
      .single();
    if (error || !data) return null;
    return {
      global: typeof data.global_floor === 'number' ? data.global_floor : null,
      perDivision: (data.per_division || {}) as Record<string, number>,
      updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : Date.now(),
    };
  } catch {
    return null;
  }
}

/** Synchronous read of the cache. Returns null if nothing cached yet. */
export function getActiveConfigSync(): ActiveConfig | null {
  return state.cache;
}

/** Async refresh — safe to fire-and-forget; never throws. */
export async function refreshActiveConfig(): Promise<ActiveConfig | null> {
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    const fresh = await fetchActive();
    if (fresh) {
      state.cache = fresh;
      state.fetchedAt = Date.now();
    }
    state.inflight = null;
    return fresh;
  })();
  return state.inflight;
}

/** Ensure cache is fresh (≤ TTL). Non-blocking for hot path users. */
export function maybeRefresh(): void {
  if (!state.cache || Date.now() - state.fetchedAt > CACHE_TTL_MS) {
    void refreshActiveConfig();
  }
}

/**
 * Promote a recommendation into the active config.
 * Guarded by POLY_EDGE_AUTOPROMOTE=true — otherwise no-op.
 * Returns the row that was written, or null if skipped/failed.
 */
export async function promoteFloor(input: {
  global?: number;
  perDivision?: Record<string, number>;
  source?: string;
}): Promise<ActiveConfig | null> {
  if ((process.env.POLY_EDGE_AUTOPROMOTE || '').toLowerCase() !== 'true') {
    log.info('promotion skipped (POLY_EDGE_AUTOPROMOTE not true)');
    return null;
  }
  try {
    const existing = state.cache || (await fetchActive()) || {
      global: null,
      perDivision: {},
      updatedAt: 0,
    };
    const merged: ActiveConfig = {
      global: input.global !== undefined ? input.global : existing.global,
      perDivision: { ...existing.perDivision, ...(input.perDivision || {}) },
      updatedAt: Date.now(),
    };
    await supabase.from('poly_ranker_active').upsert({
      id: 1,
      global_floor: merged.global,
      per_division: merged.perDivision,
      updated_at: new Date(merged.updatedAt).toISOString(),
      source: input.source || 'auto-tune',
    });
    state.cache = merged;
    state.fetchedAt = merged.updatedAt;
    log.info('ranker floor promoted', { global: merged.global, divs: Object.keys(merged.perDivision) });
    return merged;
  } catch (e) {
    log.warn('promotion failed', { error: String(e) });
    return null;
  }
}
