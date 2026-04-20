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
//
// 2026-04-20 PATCH (Pool-Gauges-Fresh):
//   ROOT CAUSE: gladiatorStore is a process-singleton with no auto-refresh.
//   Cloud Run instance that handled the scrape was started before forge
//   added gladiators 15..28 → store cache held only the 14 INITIAL_STRATEGIES
//   seeded at cold-boot. Other endpoints (diag/graveyard) hit different
//   instances or had been refreshed via mutations and saw 27 alive.
//   Symptom: arena_pool_size=14 but real alive=27; popWeighted gauges all 0
//   (because totalTrades summed across stale 14 had different distribution
//   than the real 27).
//
//   FIX: Before computing gauges, force-refresh the in-process db cache
//   from Supabase (refreshGladiatorsFromCloud) and reload the singleton
//   store (gladiatorStore.reloadFromDb). Both are idempotent and fail-soft.
//   Cost: 1 SELECT json_store every 60s per instance — negligible.
//
//   ASSUMPTIONS that, if broken, invalidate this fix:
//     1. supabase.from('json_store').select('data').eq('id','gladiators') is
//        the canonical source of truth for the alive pool.
//     2. reloadFromDb does not race against in-flight writes to the store.
//        (gladiatorMutex in db.ts protects the write side; reload is a read.)
//     3. dbInitialized is true by the time /api/metrics is first hit.
//        If not, refresh is a no-op and we keep stale gauges (acceptable).
// ============================================================
import { getPopulationStats } from '@/lib/v2/gladiators/graveyard';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { metrics, safeSet } from '@/lib/observability/metrics';
import { refreshGladiatorsFromCloud } from '@/lib/store/db';
import { refreshSeedBlacklist } from '@/lib/store/seedBlacklist';

const CACHE_TTL_MS = 60_000;

let lastRefreshAt = 0;
let inFlight: Promise<void> | null = null;

async function compute(): Promise<void> {
  try {
    // POOL-GAUGES-FRESH 2026-04-20: pull cloud → propagate to store.
    // Both calls are best-effort; failures are swallowed inside the helpers
    // and we still proceed with whatever the local cache currently has.
    try {
      await refreshGladiatorsFromCloud();
      gladiatorStore.reloadFromDb();
    } catch (refreshErr) {
      // eslint-disable-next-line no-console
      console.warn('[poolGauges] cloud refresh failed (using stale cache)', (refreshErr as Error).message);
    }

    // FAZA 4/4 2026-04-20 — piggy-back seed blacklist refresh on the 60s TTL.
    // Warm instances get a free update without a dedicated cron. refresh has
    // its own 5min TTL internally so the actual Supabase read runs at most
    // every 5min per instance. Failure is silent (fail-soft — safe default
    // is "no filter", i.e. seeds revive, which was pre-fix behavior).
    try {
      await refreshSeedBlacklist();
    } catch {
      /* swallowed — blacklist module already logs internally */
    }

    const alive = gladiatorStore.getGladiators();
    const stats = await getPopulationStats(alive);

    safeSet(metrics.arenaPoolSize, stats.alive);
    safeSet(metrics.arenaAlive, stats.alive);
    safeSet(metrics.arenaKilled, stats.killed);
    // FAZA 3/4 2026-04-20 — zombie survey. Expected 0 steady-state; >15/2h
    // triggers Grafana alert. Uses the same graveyard read as getPopulationStats
    // so zero additional DB cost.
    safeSet(metrics.arenaZombieCount, stats.zombieCount);
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
