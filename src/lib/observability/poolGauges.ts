// ============================================================
// FAZA A BATCH 2 — Pool-state gauge refresher
//
// Refreshes 6 gauges from gladiatorStore + graveyard before each
// /api/metrics scrape:
//   - tradeai_arena_pool_size       (alive count, omega excluded — matches popStats)
//   - tradeai_arena_alive_total     (alive count, redundant w/ pool_size for legacy panel compat)
//   - tradeai_arena_killed_total    (graveyard count)
//   - tradeai_selection_lift_pct    (alive avg WR - popWeighted WR*100)
//   - tradeai_pop_weighted_pf
//   - tradeai_pop_weighted_winrate  (0..1)
//
// CACHE: 60s. Scraper calls every 30s; halving DB cost is worth it.
// FAIL-SOFT: never throws. On error, gauges keep their last value.
// ============================================================
import { getPopulationStats } from '@/lib/v2/gladiators/graveyard';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { metrics, safeSet } from '@/lib/observability/metrics';

const CACHE_TTL_MS = 60_000;

let lastRefreshAt = 0;
let inFlight: Promise<void> | null = null;

async function compute(): Promise<void> {
  try {
    const alive = gladiatorStore.getGladiators();
    const stats = await getPopulationStats(alive);

    safeSet(metrics.arenaPoolSize, stats.alive);
    safeSet(metrics.arenaAlive, stats.alive);
    safeSet(metrics.arenaKilled, stats.killed);
    safeSet(metrics.selectionLiftPct, stats.selectionLiftPct);
    safeSet(metrics.popWeightedPF, stats.popWeightedProfitFactor);
    safeSet(metrics.popWeightedWR, stats.popWeightedWinRate);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[poolGauges] refresh failed', (e as Error).message);
  }
}

/**
 * Refresh pool-state gauges. Cached 60s. Concurrent callers share the
 * same in-flight promise. Always resolves (never throws).
 */
export async function refreshPoolGauges(): Promise<void> {
  const now = Date.now();
  if (now - lastRefreshAt < CACHE_TTL_MS) return;
  if (inFlight) return inFlight;

  inFlight = compute().finally(() => {
    lastRefreshAt = Date.now();
    inFlight = null;
  });
  return inFlight;
}

// Test-only — reset cache so tests can force re-compute.
export function __resetPoolGaugesCache() {
  lastRefreshAt = 0;
  inFlight = null;
}
