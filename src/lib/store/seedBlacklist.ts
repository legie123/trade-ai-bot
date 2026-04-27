// ============================================================
// RUFLO FAZA 4/4 (2026-04-20) — Seed Revive Blacklist
// ============================================================
// PROBLEM (seed-revive cycle):
//   gladiatorStore.mergeSeedMissing() re-introduces every INITIAL_STRATEGIES
//   entry whose id is absent from the json_store blob. When Butcher kills a
//   seed (tt>=30, Wilson CI<0.35), the blob is purged of that id — then the
//   NEXT reloadFromDb (cold-start, cron tick, arena:rotation) re-inserts the
//   seed with stats=0/0/0 because it's listed in INITIAL_STRATEGIES. The
//   seed trades shadow, accumulates tt, drops below Wilson threshold, gets
//   re-killed. Infinite kill→revive→kill loop.
//
// FIX (surgical, non-destructive):
//   Maintain an in-memory Set<string> of seed ids killed within the last
//   N days (default 30). mergeSeedMissing consults the set; blacklisted
//   ids are skipped (NOT re-inserted).
//
// KILL-SWITCH:
//   SEED_BLACKLIST_ENABLED=off → isSeedBlacklisted() returns false for
//   every id; behavior reverts to pre-fix (seeds revive freely).
//   SEED_REVIVE_BLACKLIST_DAYS=<int> → lookback window; default 30.
//
// ASSUMPTIONS (if violated → memory stale, revisit):
//   1. gladiators_graveyard table schema is {gladiator_id: string,
//      killed_at: ISO-string}. Matches graveyard.ts GraveyardEntry.
//   2. Seed ids in INITIAL_STRATEGIES are stable across deploys (IDs are
//      lowercase-hyphenated constants like 'btc-momentum-alpha').
//      If someone renames a seed id, it escapes the blacklist until the
//      NEW id is killed. Acceptable.
//   3. Forge-spawned gladiators use `g_<timestamp>_<rand>` ids that NEVER
//      collide with INITIAL_STRATEGIES ids. Verified at forge.ts:493.
//      The blacklist only affects seeds, not forged lineages.
//   4. Blacklist cache is process-local. Cloud Run multi-instance means
//      each instance rebuilds its own cache. Refreshed every REFRESH_TTL_MS
//      AND awaited at initDB boot, so sub-instance drift is bounded by
//      the refresh cadence.
//
// FAIL-SOFT:
//   - Every error swallowed with a warn log. On refresh failure, cache
//     keeps its previous state. On first-ever failure, cache stays empty
//     → behavior = pre-fix (seeds revive). Safe default.
// ============================================================

import { supabase, SUPABASE_CONFIGURED } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { INITIAL_STRATEGIES } from './seedStrategies';

const log = createLogger('SeedBlacklist');

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------

function isEnabled(): boolean {
  // Default ON. Set SEED_BLACKLIST_ENABLED=off to disable.
  const raw = (process.env.SEED_BLACKLIST_ENABLED || 'on').toLowerCase();
  return raw !== 'off';
}

function getLookbackDays(): number {
  const raw = process.env.SEED_REVIVE_BLACKLIST_DAYS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return parsed;
}

const REFRESH_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ------------------------------------------------------------
// State
// ------------------------------------------------------------

let blacklist: Set<string> = new Set();
let lastRefreshAt = 0;
let inFlight: Promise<void> | null = null;
let lastRefreshOk = false;

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

/**
 * Returns true iff the id is a known seed (in INITIAL_STRATEGIES) AND
 * was killed within the lookback window AND the feature is enabled.
 *
 * Sync on purpose — called from gladiatorStore.mergeSeedMissing (sync).
 * On cache-miss (cold start before first refresh), returns false. This
 * preserves current behavior (seed revives) as the safe default.
 */
export function isSeedBlacklisted(id: string): boolean {
  if (!isEnabled()) return false;
  return blacklist.has(id);
}

/**
 * Rebuild the in-memory blacklist from the graveyard. Uses a 5-minute TTL
 * so repeated calls within one request cycle hit the cache. Returns without
 * error on any failure.
 */
export async function refreshSeedBlacklist(force = false): Promise<void> {
  if (!isEnabled()) {
    // Flag off — leave cache untouched. isSeedBlacklisted short-circuits anyway.
    return;
  }

  const now = Date.now();
  if (!force && lastRefreshOk && now - lastRefreshAt < REFRESH_TTL_MS) return;
  if (inFlight) return inFlight;

  inFlight = doRefresh().finally(() => {
    lastRefreshAt = Date.now();
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(): Promise<void> {
  if (!SUPABASE_CONFIGURED) {
    log.warn('[SeedBlacklist] supabase not configured — blacklist stays empty');
    lastRefreshOk = false;
    return;
  }

  const seedIds = new Set(INITIAL_STRATEGIES.map((s) => s.id));
  if (seedIds.size === 0) {
    blacklist = new Set();
    lastRefreshOk = true;
    return;
  }

  const sinceIso = new Date(
    Date.now() - getLookbackDays() * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    // Read only ids killed within the window. We filter seed membership
    // in memory (cheaper than building an `in (...)` with N values).
    const { data, error } = await supabase
      .from('gladiators_graveyard')
      .select('gladiator_id')
      .gte('killed_at', sinceIso);

    if (error) {
      log.warn(`[SeedBlacklist] read failed: ${error.message}`);
      lastRefreshOk = false;
      return;
    }

    const next = new Set<string>();
    for (const row of data || []) {
      const id = (row as { gladiator_id?: string }).gladiator_id;
      if (id && seedIds.has(id)) next.add(id);
    }

    const prevSize = blacklist.size;
    blacklist = next;
    lastRefreshOk = true;
    if (next.size !== prevSize) {
      log.info(
        `[SeedBlacklist] refreshed: ${next.size} seed ids blocked (window=${getLookbackDays()}d)`,
      );
    }
  } catch (err) {
    log.warn('[SeedBlacklist] refresh exception', {
      err: err instanceof Error ? err.message : String(err),
    });
    lastRefreshOk = false;
  }
}

/** Diagnostic snapshot — used by diag endpoints and tests. */
export function getSeedBlacklistInfo() {
  return {
    enabled: isEnabled(),
    lookbackDays: getLookbackDays(),
    refreshTtlMs: REFRESH_TTL_MS,
    lastRefreshAt,
    lastRefreshAgoMs: lastRefreshAt === 0 ? null : Date.now() - lastRefreshAt,
    lastRefreshOk,
    cachedIds: Array.from(blacklist).sort(),
    cachedCount: blacklist.size,
  };
}

// Test-only — reset cache so tests can force re-compute.
export function __resetSeedBlacklistCache(): void {
  blacklist = new Set();
  lastRefreshAt = 0;
  lastRefreshOk = false;
  inFlight = null;
}
