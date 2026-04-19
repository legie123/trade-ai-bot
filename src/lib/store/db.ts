// ============================================================
// Persistent JSON Database — Hardened with Atomic Writes,
// Backup Rotation, and Crash Recovery
// Stores decision snapshots, performance, and optimizer state
// ============================================================
import { createClient } from '@supabase/supabase-js';
import {
  DecisionSnapshot,
  PerformanceRecord,
  OptimizationState,
  BotMode,
} from '@/lib/types/radar';
import { createLogger } from '@/lib/core/logger';
import type { Gladiator } from '@/lib/types/gladiator';
import type { CrossGladiatorWashScore } from '@/lib/v2/wash/types';

const log = createLogger('Database-Supabase');

// AUDIT FIX T2.2: Simple async mutex to prevent read-merge-write race conditions
class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => {
            this.locked = false;
            if (this.queue.length > 0) {
              const next = this.queue.shift()!;
              next();
            }
          });
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}

const decisionMutex = new AsyncMutex();
// PERF FIX: Debounce remote merge in addDecision/saveGladiatorsToDb.
// Remote fetch was happening on EVERY insert (50+ Supabase roundtrips/tick).
let _lastDecisionRemoteMerge = 0;
let _lastGladiatorRemoteMerge = 0;
const gladiatorMutex = new AsyncMutex();
const phantomMutex = new AsyncMutex();

// FAZA A FIX 2026-04-19: Stats persistence race.
// saveGladiatorsToDb launches fire-and-forget IIFE awaiting gladiatorMutex.
// Before IIFE reaches syncToCloud(), flushPendingSyncs could see empty syncTasks,
// drain instantly, return, and Cloud Run freezes the process → update lost.
// Track pending saves so flushPendingSyncs can await them BEFORE draining.
const pendingGladiatorSaves: Set<Promise<void>> = new Set();

// RUFLO FAZA 3 Batch 2 (C3+C4) 2026-04-19: Same race pattern applies to
// addDecision (decisions blob) and addPhantomTrade (phantom_trades blob).
// Both IIFE fire-and-forget → Cloud Run may freeze before sync lands.
// Fix: Identical tracker pattern to pendingGladiatorSaves.
// ASUMPȚIE: if tracker overhead causes perf regression, kill-switch via env
// DB_AWAIT_TRACKERS=0 is not (yet) wired — rollback by git revert instead.
const pendingDecisionSaves: Set<Promise<void>> = new Set();
const pendingPhantomSaves: Set<Promise<void>> = new Set();
// C7 FIX #4: Live position writes were fire-and-forget — same race as gladiator/decision/phantom.
const pendingLivePositionSaves: Set<Promise<unknown>> = new Set();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// Upgrade: Prefer Service Role Key for backend operations to bypass RLS restrictions
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// AUDIT FIX: No placeholder — if Supabase not configured, client is null and ops gracefully degrade
// AUDIT FIX: No placeholder — if Supabase not configured, db() throws and callers degrade gracefully via existing catches
const SUPABASE_CONFIGURED = !!(supabaseUrl && supabaseKey && !supabaseUrl.includes('placeholder'));
if (!SUPABASE_CONFIGURED) {
  log.warn('Supabase NOT configured — all DB operations will return defaults. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
}
const supabase = SUPABASE_CONFIGURED
  ? createClient(supabaseUrl, supabaseKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key');

/** Guard: throws if Supabase is not properly configured. Callers catch and degrade. */
function requireDb() {
  if (!SUPABASE_CONFIGURED) {
    throw new Error('[DB] Supabase not configured — operation skipped');
  }
  return supabase;
}

export interface PhantomTrade {
  id: string;
  gladiatorId: string;
  symbol: string;
  signal: string;
  entryPrice: number;
  timestamp: string;
}

export interface LivePosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  partialTPHit: boolean;
  highestPriceObserved: number;
  lowestPriceObserved: number;
  currentPrice?: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  isPaperTrade?: boolean;
}

// ─── Singleton Memory Cache ─────────────────────
interface DbStore {
  decisions: DecisionSnapshot[];
  performance: PerformanceRecord[];
  optimizer: OptimizationState;
  config: BotConfig;
  gladiators: Gladiator[]; // V2 Gladiators
  syndicateAudits: Record<string, unknown>[]; // Stores Master arguments
  gladiatorDna: Record<string, unknown>[]; // Stores battle DNA for Omega Super AI
  phantomTrades: PhantomTrade[]; // Shadow trades for Gladiator Combat Engine
  livePositions: LivePosition[]; // Real live trades for Trailing Stop Engine
  invalidSymbols: string[]; // Blacklist for delisted MEXC symbols
  equityHistory: EquityPoint[]; // Immutable history for PnL
}

const cache: DbStore = {
  decisions: [],
  performance: [],
  gladiators: [],
  optimizer: {
    version: 0,
    weights: { volumeWeight: 0.25, liquidityWeight: 0.20, momentumWeight: 0.20, holderWeight: 0.15, socialWeight: 0.10, emaWeight: 0.10 },
    lastOptimizedAt: new Date().toISOString(),
    improvementPercent: 0,
    history: [],
  },
  config: {
    mode: 'PAPER',
    autoOptimize: false,
    paperBalance: 1000,
    riskPerTrade: 1.0,        // Hardened from 1.5% — institutional conservative for initial phase
    maxOpenPositions: 2,       // Hardened from 3 — reduce concurrent exposure until WR stabilizes
    evaluationIntervals: [5, 15, 60, 240],
    aiStatus: 'OK',
    haltedUntil: null,
  },
  syndicateAudits: [],
  gladiatorDna: [],
  phantomTrades: [],
  livePositions: [],
  invalidSymbols: [],
  equityHistory: [],
};

let dbInitialized = false;

// ─── INIT DB (Called at boot or Cron start) ────
export async function initDB() {
  if (dbInitialized) return;

  if (!SUPABASE_CONFIGURED) {
    dbInitialized = true;
    log.warn('DB initialized in memory-only mode (Supabase not configured)');
    return;
  }

  try {
    const { data, error } = await requireDb().from('json_store').select('*');
    if (error) {
      log.error('Supabase init fetch error', { error: error.message });
      dbInitialized = true;
      return;
    }
    if (data && data.length > 0) {
      for (const row of data) {
        if (row.id === 'decisions') {
          const raw = row.data || [];
          const seen = new Set<string>();
          const deduped = raw.filter((d: DecisionSnapshot) => {
            const key = d.signalId || d.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          const sorted = deduped.sort((a: DecisionSnapshot, b: DecisionSnapshot) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          cache.decisions = sorted.slice(0, 100);
        }
        if (row.id === 'performance') cache.performance = row.data || [];
        if (row.id === 'optimizer') cache.optimizer = row.data || cache.optimizer;
        if (row.id === 'config') cache.config = row.data || cache.config;
        if (row.id === 'gladiators') cache.gladiators = row.data || [];
        if (row.id === 'gladiator_dna') cache.gladiatorDna = row.data || [];
        if (row.id === 'phantom_trades') cache.phantomTrades = row.data || [];
        if (row.id === 'invalid_symbols') cache.invalidSymbols = row.data || [];
      }
    }

    // --- NEW: Load from True Postgres Tables ---
    const { data: equityData, error: eqErr } = await supabase.from('equity_history').select('*').order('timestamp', { ascending: true }).limit(500);
    if (!eqErr && equityData) {
      // Map Supabase schema (equity, pnl_total) → in-memory EquityPoint (balance, pnl)
      cache.equityHistory = equityData.map((row: Record<string, unknown>) => ({
        timestamp: String(row.timestamp || ''),
        pnl: Number(row.pnl_total ?? row.pnl ?? 0),
        balance: Number(row.equity ?? row.balance ?? 0),
        outcome: String(row.outcome || 'WIN'),
        signal: String(row.signal || 'SYSTEM'),
        symbol: String(row.symbol || 'SYSTEM'),
        mode: (row.mode as 'PAPER' | 'LIVE') || 'PAPER',
      }));
    }

    const { data: auditsData, error: audErr } = await supabase.from('syndicate_audits').select('*').order('timestamp', { ascending: false }).limit(200);
    if (!audErr && auditsData) {
      cache.syndicateAudits = auditsData;
    }

    const { data: liveData, error: lErr } = await supabase.from('live_positions').select('*');
    if (!lErr && liveData) {
      cache.livePositions = liveData;
    }

    log.info('Supabase database initialized from cloud Postgres tables');

    // FIX: gladiatorStore singleton seeds defaults on import (before initDB runs).
    // Force-reload from now-populated cache so isLive/status match Supabase.
    try {
      const { gladiatorStore } = await import('@/lib/store/gladiatorStore');
      gladiatorStore.reloadFromDb();
      const liveCount = cache.gladiators.filter(g => g.isLive === true).length;
      log.info(`[initDB] Gladiators reloaded from Supabase: ${cache.gladiators.length} total, ${liveCount} live`);
    } catch (err) {
      log.warn('[initDB] Failed to reload gladiatorStore', { error: String(err) });
    }

    dbInitialized = true;
  } catch (err) {
    log.error('Supabase init execution error', { error: String(err) });
    dbInitialized = true;
  }
}

// ─── Task Queue (Fixes memory leaks & debounces duplicates) ───
const syncTasks: { id: string, data: unknown }[] = [];
let isSyncing = false;
let totalSyncsCompleted = 0;
let lastSyncComplete = new Date().toISOString();

export function getSyncQueueStats() {
  return {
    pending: syncTasks.length,
    totalCompleted: totalSyncsCompleted,
    lastSyncComplete,
  };
}

async function processSyncQueue() {
  if (isSyncing || syncTasks.length === 0) return;
  isSyncing = true;

  // C12 (2026-04-19): Batch upsert replaces sequential-with-100ms-delay.
  // PRIOR: N tasks × (Supabase ~200ms + 100ms delay) = 3-4s flush on typical tick.
  // NOW: single upsert([...]) = 1 round-trip ~200-300ms. Fallback: per-record on batch failure.
  // The 100ms "rate limit" delay was overly conservative — Supabase free tier allows
  // ~500 req/s. Batch eliminates the concern entirely.
  const batch = syncTasks.splice(0, syncTasks.length);
  if (batch.length === 0) { isSyncing = false; return; }

  try {
    const rows = batch.map(t => ({ id: t.id, data: t.data }));
    const { error } = await supabase.from('json_store').upsert(rows);
    if (error) {
      log.warn(`[SyncQueue] Batch upsert failed (${batch.length} rows): ${error.message}. Falling back to per-record.`);
      let ok = 0;
      for (const row of rows) {
        const { error: e2 } = await supabase.from('json_store').upsert(row);
        if (!e2) ok++;
        else log.error(`Supabase sync failed for ${row.id}`, { error: e2.message });
      }
      totalSyncsCompleted += ok;
    } else {
      totalSyncsCompleted += batch.length;
    }
    lastSyncComplete = new Date().toISOString();
  } catch (err) {
    log.error(`Critical error in syncQueue batch (${batch.length} rows)`, { error: String(err) });
    // Re-queue failed tasks for next cycle
    syncTasks.push(...batch);
  }

  isSyncing = false;
}

function syncToCloud(id: string, data: unknown) {
  if (!supabaseUrl || !dbInitialized) return;

  // Debounce: overwrite existing task for the same ID to only upload the absolute latest version
  const existingTaskIndex = syncTasks.findIndex(t => t.id === id);
  if (existingTaskIndex !== -1) {
    syncTasks[existingTaskIndex].data = data;
  } else {
    syncTasks.push({ id, data });
  }

  // Fire and forget
  processSyncQueue().catch(err => log.error('Sync process queue crashed', { error: String(err) }));
}

/**
 * FIX: Cloud Run freezes process after HTTP response → async fire-and-forget
 * syncs never complete → gladiator stats lost on instance restart.
 * Call this at the end of cron/route.ts BEFORE returning the response.
 * Waits for all pending syncTasks to drain + any in-flight processSyncQueue().
 */
export async function flushPendingSyncs(timeoutMs = 5000): Promise<{ flushed: number; timedOut: boolean }> {
  const start = Date.now();
  let flushed = 0;

  // FAZA A FIX 2026-04-19: Wait for in-flight saveGladiatorsToDb IIFEs FIRST.
  // They're awaiting the mutex → haven't called syncToCloud yet → syncTasks empty.
  // Without this wait, drain loop exits immediately and Cloud Run freezes before write lands.
  // Budget: min(half timeout, 2500ms) so we still leave time for the drain loop below.
  //
  // RUFLO FAZA 3 Batch 2 (C3+C4) 2026-04-19: Same wait applies to decision + phantom
  // saves. All three trackers share the save budget (single Promise.allSettled call)
  // to avoid triple-waiting. If all three trackers have pending, we still yield to
  // drain loop after the combined budget.
  const combinedPending = pendingGladiatorSaves.size + pendingDecisionSaves.size + pendingPhantomSaves.size + pendingLivePositionSaves.size;
  if (combinedPending > 0) {
    // C7 FIX #12: Tighter save budget (1/3 instead of 1/2) leaves more time for drain loop.
    const saveBudget = Math.min(Math.floor(timeoutMs / 3), 1500);
    await Promise.race([
      Promise.allSettled([
        ...pendingGladiatorSaves,
        ...pendingDecisionSaves,
        ...pendingPhantomSaves,
        ...pendingLivePositionSaves,
      ]),
      new Promise<void>(r => setTimeout(r, saveBudget)),
    ]);
  }

  // Wait for any in-flight sync to complete, then drain remaining
  while ((isSyncing || syncTasks.length > 0) && (Date.now() - start) < timeoutMs) {
    if (!isSyncing && syncTasks.length > 0) {
      await processSyncQueue();
    }
    if (isSyncing) {
      await new Promise(r => setTimeout(r, 50));
    }
    flushed++;
  }

  return { flushed: totalSyncsCompleted, timedOut: (Date.now() - start) >= timeoutMs };
}

// ─── Decision Snapshots ────────────────────────────
export function getDecisions(): DecisionSnapshot[] {
  return cache.decisions;
}

export function getDecisionsToday(): DecisionSnapshot[] {
  const today = new Date().toISOString().slice(0, 10);
  return cache.decisions.filter(d => d.timestamp.startsWith(today));
}

export function getPendingDecisions(): DecisionSnapshot[] {
  return cache.decisions.filter(d => d.outcome === 'PENDING');
}

// ─── System Health Reset ──────────────────────────
export function clearSystemHealthData(): void {
  cache.decisions = [];
  syncToCloud('decisions', cache.decisions);
}

export function addDecision(snapshot: DecisionSnapshot): void {
  if (cache.decisions.some((d) => d.signalId === snapshot.signalId)) return;

  // Calibration #13: Final confidence floor — reject garbage signals at DB level.
  // REVERT 2026-04-19: "PAPER=LIVE parity" (commit 50754f8d09, 2026-04-18) raised
  // unified floor to 65%, silently dropping ALL scout signals in confidence 20-64
  // range → PAPER pipeline went dry at 20:45 UTC (0 new decisions for 3h+).
  // PAPER mode by design collects training data at lower floor; LIVE stays strict.
  // ASUMPȚIE CRITICĂ: LIVE gate-keeping is enforced elsewhere (Sentinel, killSwitch);
  // this floor is only the DB-level final filter — NOT the only defense for LIVE.
  const isPaperMode = (process.env.TRADING_MODE || 'PAPER').toUpperCase() === 'PAPER';
  const CONFIDENCE_FLOOR = isPaperMode ? 20 : 65;
  if (snapshot.confidence < CONFIDENCE_FLOOR && snapshot.signal !== 'NEUTRAL') {
    return; // Silent drop — engine should have caught this
  }

  // FIX 2026-04-18: Insert into cache SYNCHRONOUSLY so getPendingDecisions()
  // sees the new decision in the same tick. Previously the insert was inside
  // an async IIFE → cache was empty when cron evaluated pending decisions
  // → on Cloud Run the process froze before the async IIFE completed → decisions lost.
  cache.decisions.unshift(snapshot);
  if (cache.decisions.length > 1000) cache.decisions.length = 1000;

  // FAZA A BATCH 1: emit metric per decision (verdict = direction downcase, NEUTRAL → flat)
  try {
    // Lazy require to avoid circular import pressure in this hot path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { metrics: m, safeInc } = require('@/lib/observability/metrics');
    const verdict = snapshot.signal === 'NEUTRAL'
      ? 'flat'
      : (snapshot.direction === 'LONG' ? 'buy' : 'sell');
    safeInc(m.decisions, { verdict });
  } catch { /* instrumentation must never crash decision path */ }

  // PERF FIX 2026-04-18: Remote merge debounced to max once per 60s.
  // Was: full Supabase SELECT + merge on EVERY insert → 50+ roundtrips/tick.
  // Now: local cache is authoritative within a tick, remote merge only when stale.
  //
  // RUFLO FAZA 3 Batch 2 (C3) 2026-04-19: Track IIFE promise so flushPendingSyncs
  // can await it before draining. Without tracking, Cloud Run can freeze process
  // between IIFE launch and syncToCloud() call → decision lost on restart.
  const p = (async () => {
    const release = await decisionMutex.acquire();
    try {
      const now = Date.now();
      // C7 FIX #6: Remote merge debounce 60s → 300s. Local cache is authoritative
      // within instance; remote merge only needed for cross-instance consistency.
      if (supabaseUrl && dbInitialized && now - _lastDecisionRemoteMerge > 300_000) {
        _lastDecisionRemoteMerge = now;
        try {
          const { data } = await supabase.from('json_store').select('data').eq('id', 'decisions').single();
          if (data?.data) {
            const remote = data.data as DecisionSnapshot[];
            const localMap = new Map(cache.decisions.map(d => [d.id, d]));
            for (const rd of remote) {
              if (!localMap.has(rd.id)) cache.decisions.push(rd);
            }
            cache.decisions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            if (cache.decisions.length > 1000) cache.decisions.length = 1000;
          }
        } catch (err) { log.warn('Failed to merge remote decisions before insert', { error: String(err) }); }
      }

      syncToCloud('decisions', cache.decisions);
    } finally {
      release();
    }
  })();
  pendingDecisionSaves.add(p);
  p.finally(() => pendingDecisionSaves.delete(p)).catch(() => { /* tracked via add/delete */ });
}

export function updateDecision(id: string, updates: Partial<DecisionSnapshot>): void {
  const idx = cache.decisions.findIndex((d) => d.id === id);
  if (idx === -1) return;
  cache.decisions[idx] = { ...cache.decisions[idx], ...updates };
  syncToCloud('decisions', cache.decisions);
}

/**
 * Multi-horizon eval helper (2026-04-18).
 * Merges ONE horizon slot into horizonOutcomes without stomping the others.
 * `updateDecision` does a shallow merge → passing `{horizonOutcomes: {5: X}}` would
 * wipe already-set horizons. This helper deep-merges the specific horizon key.
 *
 * WHY separate from updateDecision: shallow-merge semantics are load-bearing for
 * other callers. Don't change them.
 */
export function setHorizonOutcome(
  id: string,
  horizonMin: number,
  result: { price: number; pnlPercent: number; label: 'WIN' | 'LOSS' | 'NEUTRAL'; evaluatedAt: string }
): void {
  // Local write first (sync) — same-tick reads see our write.
  const idx = cache.decisions.findIndex((d) => d.id === id);
  if (idx === -1) return;
  const dec = cache.decisions[idx];
  const existing = dec.horizonOutcomes || {};
  cache.decisions[idx] = {
    ...dec,
    horizonOutcomes: { ...existing, [String(horizonMin)]: result },
  };

  // RUFLO FAZA 3 / BATCH 5 / F6 fix (P1) — cross-instance merge-before-sync.
  //
  // BUG (pre-fix): Two Cloud Run instances can both fill horizons for the same
  // decision (A fills HO[5], B fills HO[15]) based on their own in-memory
  // cache.decisions. syncToCloud() writes the WHOLE decisions array → the
  // second instance to sync overwrites the first's horizon. Even with lease
  // on cron:main-tick (50s TTL), warm instances can hydrate stale decisions
  // from Supabase BEFORE leader's sync lands, then overwrite on next
  // leadership transition.
  //
  // FIX: Spawn async IIFE under decisionMutex that fetches remote decisions,
  // merges horizonOutcomes for THIS decision (UNION semantics; local wins on
  // conflict because we just wrote it), pulls in remote-only decisions,
  // then syncToCloud with the merged view.
  //
  // COST: +1 Supabase SELECT per horizon fill (~20 × 4 = ~80/tick). Accepted
  // because F6 data loss is correctness-critical; addDecision's 60s debounce
  // pattern is INSUFFICIENT for horizons (same decision ID gets written 4
  // times across horizons, often from different instances).
  //
  // Env rollback: HORIZON_UPSERT_OFF=1 → legacy direct overwrite.
  //
  // ASUMPȚII invalidatoare:
  //   1) remote SELECT < 3s. Tracked via pendingDecisionSaves; flushPendingSyncs
  //      awaits it.
  //   2) Local horizon = "latest". Cron lease prevents same-tick concurrency;
  //      cross-tick conflict on same horizon is extremely rare.
  if (process.env.HORIZON_UPSERT_OFF === '1' || !supabaseUrl || !dbInitialized) {
    syncToCloud('decisions', cache.decisions);
    return;
  }

  const p = (async () => {
    const release = await decisionMutex.acquire();
    try {
      try {
        const { data } = await supabase.from('json_store').select('data').eq('id', 'decisions').single();
        if (data?.data) {
          const remote = data.data as DecisionSnapshot[];
          const remoteIdx = remote.findIndex(d => d.id === id);
          const localDec = cache.decisions.find(d => d.id === id);
          const localHO = localDec?.horizonOutcomes || {};
          if (remoteIdx !== -1 && localDec) {
            const remoteHO = remote[remoteIdx].horizonOutcomes || {};
            // UNION — local wins on key conflict (we just wrote it).
            const mergedHO = { ...remoteHO, ...localHO };
            const cacheIdx = cache.decisions.findIndex(d => d.id === id);
            if (cacheIdx !== -1) {
              cache.decisions[cacheIdx] = { ...cache.decisions[cacheIdx], horizonOutcomes: mergedHO };
            }
          }
          // Pull remote decisions not in local (addDecision pattern) so sync
          // doesn't clobber new decisions from other instances.
          const localMap = new Map(cache.decisions.map(d => [d.id, d]));
          for (const rd of remote) {
            if (!localMap.has(rd.id)) cache.decisions.push(rd);
          }
          cache.decisions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          if (cache.decisions.length > 1000) cache.decisions.length = 1000;
        }
      } catch (err) {
        log.warn('[Horizon] merge-before-write failed, proceeding with local state', { error: String(err) });
      }
      syncToCloud('decisions', cache.decisions);
    } finally {
      release();
    }
  })();
  pendingDecisionSaves.add(p);
  p.finally(() => pendingDecisionSaves.delete(p)).catch(() => { /* tracked */ });
}

/**
 * Returns decisions that still have at least one horizon to evaluate.
 * Criteria:
 *   - Age < maxHorizonMin (past 4h we give up — decision is fossilized).
 *   - At least one horizon in HORIZONS is still unset on horizonOutcomes.
 * NOTE: deliberately does NOT filter by `outcome === PENDING`. A decision can
 * be "finalized" (primary outcome set at 15m) but still awaiting 60m/240m fills.
 */
export function getDecisionsWithOpenHorizons(
  horizons: number[],
  nowMs: number = Date.now()
): DecisionSnapshot[] {
  const maxH = Math.max(...horizons);
  return cache.decisions.filter((d) => {
    const ageMin = (nowMs - new Date(d.timestamp).getTime()) / 60_000;
    if (ageMin > maxH + 5) return false; // some slack past last horizon
    const ho = d.horizonOutcomes || {};
    return horizons.some((h) => !ho[String(h)]);
  });
}

// ─── Syndicate Audit (Combat Logs) ────────────────
export function addSyndicateAudit(audit: Record<string, unknown>): void {
  const newAudit = { ...audit, id: `audit-${Date.now()}` };
  cache.syndicateAudits.unshift(newAudit);
  if (cache.syndicateAudits.length > 500) cache.syndicateAudits.length = 500;
  
  if (supabaseUrl && dbInitialized) {
    // INSTITUTIONAL FIX: Schema has finalDirection + hallucinationReport columns.
    // Previous code deleted these fields, losing critical hallucination defense data.
    // Now we persist them properly for full audit trail.
    const auditRec = newAudit as Record<string, unknown>;
    const dbAudit: Record<string, unknown> = {
      timestamp: auditRec.timestamp,
      symbol: auditRec.symbol || 'UNKNOWN',
      finalDirection: auditRec.finalDirection || 'FLAT',
      weightedConfidence: auditRec.weightedConfidence || 0,
      opinions: auditRec.opinions || [],
      hallucinationReport: auditRec.hallucinationReport || null,
    };
    // SAFETY FAZA 3.1: Handle BOTH PostgREST payload error AND transport-level promise rejection.
    // Supabase builder returns PromiseLike (not full Promise), so .catch() is not available.
    // Use .then(onFulfilled, onRejected) two-arg form to cover both paths without unhandled rejections.
    // Critical: hallucinationReport audit trail must not be lost silently on timeout/network failure.
    supabase.from('syndicate_audits').insert(dbAudit).then(
      ({ error }) => {
        if (error) log.warn('Failed to insert syndicate audit to Supabase', { error: error.message });
      },
      (err: unknown) => {
        log.warn('Syndicate audit insert REJECTED (transport)', { err: err instanceof Error ? err.message : String(err) });
      }
    );
  }
}

export function getSyndicateAudits(): Record<string, unknown>[] {
  return cache.syndicateAudits;
}

// ─── Gladiators (V2 Memory) ──────────────────────
export function getGladiatorsFromDb(): Gladiator[] {
  return cache.gladiators;
}

export async function refreshGladiatorsFromCloud(): Promise<void> {
  if (supabaseUrl && dbInitialized) {
    try {
      const { data } = await supabase.from('json_store').select('data').eq('id', 'gladiators').single();
      if (data?.data) {
        cache.gladiators = data.data as Gladiator[];
      }
    } catch (err) { log.warn('Failed to refresh gladiators from cloud', { error: String(err) }); }
  }
}


export function saveGladiatorsToDb(gladiators: Gladiator[]): Promise<void> {
  // AUDIT FIX T2.2: Mutex-protected read-merge-write to prevent gladiator data loss
  // PERF FIX 2026-04-18: Remote merge debounced to max once per 60s.
  // Was: full Supabase SELECT+merge on EVERY updateGladiatorStats → 50+ roundtrips/tick.
  // FAZA A FIX 2026-04-19: Return Promise so flushPendingSyncs can await in-flight writes
  // before draining syncTasks. Existing fire-and-forget callers unaffected (ignore Promise).
  const p = (async () => {
    const release = await gladiatorMutex.acquire();
    try {
      const now = Date.now();
      // C7 FIX #6: Remote merge debounce 60s → 300s (same as decision merge).
      if (supabaseUrl && dbInitialized && now - _lastGladiatorRemoteMerge > 300_000) {
        _lastGladiatorRemoteMerge = now;
        try {
          const { data } = await supabase.from('json_store').select('data').eq('id', 'gladiators').single();
          if (data?.data) {
            const remoteGladiators = data.data as Gladiator[];
            for (const remote of remoteGladiators) {
               const localIndex = gladiators.findIndex(g => g.id === remote.id);
               if (localIndex === -1) {
                   gladiators.push(remote);
               } else {
                   const local = gladiators[localIndex];
                   const remoteTime = remote.lastUpdated || 0;
                   const localTime = local.lastUpdated || 0;
                   if (remoteTime > localTime || (remoteTime === localTime && (remote.stats?.totalTrades || 0) > (local.stats?.totalTrades || 0))) {
                       gladiators[localIndex] = remote;
                   }
               }
            }
          }
        } catch (err) {
          log.warn('Could not sync gladiators for merge. Overwriting directly.', { err: String(err) });
        }
      }

      cache.gladiators = gladiators;
      syncToCloud('gladiators', cache.gladiators);
    } finally {
      release();
    }
  })();

  pendingGladiatorSaves.add(p);
  p.finally(() => pendingGladiatorSaves.delete(p)).catch(() => { /* tracked via add/delete */ });
  return p;
}

// ─── DNA Bank (Gladiator Battles) ────────────────
// INSTITUTIONAL UPGRADE: Writes to dedicated `gladiator_battles` Postgres table
// instead of json_store blob. No more 2000-record cap. Full indexed history.
// Falls back to in-memory cache if Supabase is unavailable.

export async function addGladiatorDna(record: Record<string, unknown>): Promise<void> {
  // Always keep in memory cache for fast reads
  cache.gladiatorDna.unshift(record);
  if (cache.gladiatorDna.length > 5000) cache.gladiatorDna.length = 5000;

  if (!supabaseUrl || !dbInitialized) return;

  try {
    const dbRecord = _toDnaDbRecord(record);
    const { error } = await supabase.from('gladiator_battles').insert(dbRecord);
    if (error) {
      // If table doesn't exist yet, fall back to json_store silently
      if (error.code === '42P01') {
        syncToCloud('gladiator_dna', cache.gladiatorDna);
      } else {
        log.warn(`Failed to insert battle record: ${error.message}`);
      }
    }
  } catch (err) {
    // Network failure — data is already in memory cache
    log.warn('Failed to insert gladiator battle record, falling back to json_store', { error: String(err) });
    syncToCloud('gladiator_dna', cache.gladiatorDna);
  }
}

// C10 (2026-04-19) — Shared record mapper for single + batch inserts.
function _toDnaDbRecord(record: Record<string, unknown>) {
  return {
    id: record.id || `battle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    gladiator_id: record.gladiatorId,
    symbol: record.symbol,
    decision: record.decision,
    entry_price: record.entryPrice,
    outcome_price: record.outcomePrice,
    pnl_percent: record.pnlPercent,
    is_win: record.isWin,
    timestamp: record.timestamp,
    market_context: record.marketContext || {},
  };
}

// C10 (2026-04-19) — Batch DNA write. Replaces N sequential Supabase inserts
// with a single bulk insert. evaluatePhantomTrades was spending ~13s on ~100
// individual await-ed inserts (130ms each). Batch insert = 1 round-trip ≈ 200ms.
// In-memory cache is updated synchronously per record (for mid-tick reads).
// ASSUMPTION: Supabase PostgREST .insert(array) is atomic per-batch.
// If batch fails, records remain in memory cache (eventual re-sync via json_store fallback).
export async function addGladiatorDnaBatch(records: Record<string, unknown>[]): Promise<void> {
  if (records.length === 0) return;

  // 1. Update in-memory cache synchronously (same as single-record path)
  for (const record of records) {
    cache.gladiatorDna.unshift(record);
  }
  if (cache.gladiatorDna.length > 5000) cache.gladiatorDna.length = 5000;

  if (!supabaseUrl || !dbInitialized) return;

  try {
    const dbRecords = records.map(_toDnaDbRecord);
    const { error } = await supabase.from('gladiator_battles').insert(dbRecords);
    if (error) {
      if (error.code === '42P01') {
        syncToCloud('gladiator_dna', cache.gladiatorDna);
      } else {
        log.warn(`[DNA Batch] Failed to batch-insert ${records.length} battle records: ${error.message}`);
        // Fallback: try individual inserts for partial success
        let ok = 0;
        for (const r of dbRecords) {
          const { error: e2 } = await supabase.from('gladiator_battles').insert(r);
          if (!e2) ok++;
        }
        log.info(`[DNA Batch] Fallback: ${ok}/${dbRecords.length} inserted individually`);
      }
    }
  } catch (err) {
    log.warn(`[DNA Batch] Network failure on ${records.length} records, using json_store fallback`, { error: String(err) });
    syncToCloud('gladiator_dna', cache.gladiatorDna);
  }
}

/**
 * Retrieves gladiator battle history.
 * Reads from dedicated Postgres table with optional gladiator_id filter.
 * Falls back to in-memory cache if Supabase is unavailable.
 */
export function getGladiatorDna(): Record<string, unknown>[] {
  return cache.gladiatorDna;
}

/**
 * INSTITUTIONAL UPGRADE: Fetch battles for a specific gladiator from Postgres.
 * Returns up to `limit` most recent battles, sorted newest-first.
 * Falls back to in-memory cache filtered by gladiatorId.
 */
export async function getGladiatorBattles(gladiatorId: string, limit = 500): Promise<Record<string, unknown>[]> {
  if (!supabaseUrl || !dbInitialized) {
    // Fallback: filter in-memory cache
    return cache.gladiatorDna
      .filter(r => r.gladiatorId === gladiatorId)
      .slice(0, limit);
  }

  // AUDIT FIX 2026-04-19 (RUFLO pagination): PostgREST caps .limit(N) silently
  // at the PostgREST-configured max-rows (default 1000). When a caller needs
  // the full history (e.g. reconcileStatsFromBattles), a bare .limit(10000)
  // used to return only the first 1000 rows. We now paginate via .range(from,to)
  // in 1000-row chunks whenever the requested limit exceeds that cap.
  //
  // ASUMPȚII:
  //  - gladiator_battles has an index on (gladiator_id, timestamp DESC). If not,
  //    sequential range reads are still O(N) but acceptable at current volumes.
  //  - Mapping shape below must NOT diverge from DNAExtractor's BattleRecord
  //    expectations (id/gladiatorId/symbol/decision/entryPrice/outcomePrice/
  //    pnlPercent/isWin/timestamp/marketContext).
  const PAGE_SIZE = 1000;
  const collected: Array<Record<string, unknown>> = [];

  try {
    let from = 0;
    while (collected.length < limit) {
      const take = Math.min(PAGE_SIZE, limit - collected.length);
      const to = from + take - 1;

      const { data, error } = await supabase
        .from('gladiator_battles')
        .select('*')
        .eq('gladiator_id', gladiatorId)
        .order('timestamp', { ascending: false })
        .range(from, to);

      if (error) {
        // Table doesn't exist yet — fall back to memory (only if first page)
        if (error.code === '42P01' && collected.length === 0) {
          return cache.gladiatorDna
            .filter(r => r.gladiatorId === gladiatorId)
            .slice(0, limit);
        }
        log.warn(`Failed to fetch battles for ${gladiatorId} at range ${from}-${to}: ${error.message}`);
        if (collected.length === 0) {
          return cache.gladiatorDna
            .filter(r => r.gladiatorId === gladiatorId)
            .slice(0, limit);
        }
        break; // Partial result better than nothing once we already have rows
      }

      if (!data || data.length === 0) {
        // No data in Postgres yet — fall back to memory (only if first page)
        if (collected.length === 0) {
          return cache.gladiatorDna
            .filter(r => r.gladiatorId === gladiatorId)
            .slice(0, limit);
        }
        break; // Reached end of rows
      }

      collected.push(...(data as Array<Record<string, unknown>>));
      if (data.length < take) break; // Exhausted rows server-side
      from += take;
    }

    // Map Postgres columns back to the BattleRecord shape expected by DNAExtractor
    return collected.map(row => ({
      id: row.id,
      gladiatorId: row.gladiator_id,
      symbol: row.symbol,
      decision: row.decision,
      entryPrice: row.entry_price,
      outcomePrice: row.outcome_price,
      pnlPercent: row.pnl_percent,
      isWin: row.is_win,
      timestamp: row.timestamp,
      marketContext: row.market_context || {},
    }));
  } catch (err) {
    log.warn(`Failed to fetch gladiator battles for ${gladiatorId}, falling back to memory`, { error: String(err) });
    return cache.gladiatorDna
      .filter(r => r.gladiatorId === gladiatorId)
      .slice(0, limit);
  }
}

/**
 * FAZA 3/5 BATCH 2/4 (2026-04-19) — Dedupe-aware sample size for promotion gate.
 *
 * Returns the number of INDEPENDENT trading decisions for a gladiator, deduplicated
 * by (minute bucket of entry_timestamp, symbol, direction). This addresses the
 * wash-assignment artifact where 1 signal routed to N gladiators produces N phantom
 * rows but only 1 independent decision.
 *
 * ASUMPȚIE: dacă 2 signale distincte pentru același symbol+direction sosesc în aceeași
 * minută, se colapsează în 1 sample. Cost acceptabil vs. pollution pe gate LIVE.
 * Fallback (no DB): numără BattleRecord unici din in-memory cache prin aceeași cheie.
 *
 * IMPACT: înlocuiește `stats.totalTrades` în QW-8 gate — previne promovări pe stats
 * inflate de wash. Dacă 1 gladiator are 50 independent samples, e real.
 */
export async function getIndependentSampleSize(gladiatorId: string): Promise<number> {
  if (!supabaseUrl || !dbInitialized) {
    // In-memory fallback: dedupe local cache
    const keys = new Set<string>();
    for (const r of cache.gladiatorDna) {
      if (r.gladiatorId !== gladiatorId) continue;
      const ts = r.timestamp;
      const minuteBucket = typeof ts === 'number'
        ? Math.floor(ts / 60000)
        : Math.floor(new Date(String(ts)).getTime() / 60000);
      keys.add(`${minuteBucket}|${r.symbol}|${r.decision}`);
    }
    return keys.size;
  }
  try {
    // Postgres path: pull timestamp/symbol/decision and dedupe client-side.
    // Schema (schema.sql:67): gladiator_battles has `timestamp BIGINT` (epoch ms), no separate
    // entry_timestamp column. Grouping by minute_bucket of timestamp is the correct proxy.
    // Preferabil aș rula COUNT(DISTINCT ...) în SQL via RPC; fallback client OK sub 10k rows.
    const { data, error } = await supabase
      .from('gladiator_battles')
      .select('timestamp, symbol, decision')
      .eq('gladiator_id', gladiatorId)
      .limit(10000);
    if (error || !data) {
      // Table absent or query failed → fall back to memory
      const keys = new Set<string>();
      for (const r of cache.gladiatorDna) {
        if (r.gladiatorId !== gladiatorId) continue;
        const ts = r.timestamp;
        const minuteBucket = typeof ts === 'number'
          ? Math.floor(ts / 60000)
          : Math.floor(new Date(String(ts)).getTime() / 60000);
        keys.add(`${minuteBucket}|${r.symbol}|${r.decision}`);
      }
      return keys.size;
    }
    const keys = new Set<string>();
    for (const row of data as Record<string, unknown>[]) {
      const ts = row.timestamp;
      if (ts === undefined || ts === null) continue;
      const t = typeof ts === 'number' ? ts : new Date(String(ts)).getTime();
      if (!Number.isFinite(t)) continue;
      const minuteBucket = Math.floor(t / 60000);
      keys.add(`${minuteBucket}|${row.symbol}|${row.decision}`);
    }
    return keys.size;
  } catch {
    return 0;
  }
}

// ============================================================
// FAZA 3/5 BATCH 3/4 (2026-04-20) — Cross-Gladiator Wash Guard
// Detects BOTH same-direction wash AND opposite-direction mirror-hedge
// by computing Pearson on SIGNED pnl (SHORT inverted) over shared
// (bucket|symbol) keys with a candidate's peer set. Caller uses |corr|.
//
// ASUMPȚII care invalidează scorul:
//   A1) bucketMs=30min — wall-clock ACF din audit 2026-04-19 arată ≈30min
//       este bucketul în care signalele replicate cad 95% din timp. Sub
//       30min = false positives (aceleași market prints, gladiatori diferiți
//       cu entry strategy naturală coincidentă). Peste 30min = miss pe
//       wash cu mic lag.
//   A2) Drop `decision` din cheie — prior versiune lega cheia de
//       LONG/SHORT, ceea ce permitea bypass prin flip (gladiator mirror
//       pe aceleași bucket-uri trecea neutru). Folosim signed pnl
//       (SHORT inverted) + Pearson → |corr|≈1 indică wash direct,
//       |corr|≈-1 indică mirror-hedge. Gate-ul folosește |corr|.
//   A3) FUTURES_FALLBACK_FEE=0.14 (aliniat feeModel.ts) pentru battles
//       pre-FAZA-B.2. Schimbarea asumpției (ex. pivot SPOT) invalidează
//       scorurile istorice.
//   A4) Early-exit la overlap≥0.95 + |corr|≈1 — dincolo de prag e wash
//       evident; continuăm scanul doar dacă vrem debug exhaustiv.
//   A5) min `minSharedTrades` (default 30) — sub acest prag Pearson
//       are varianță infirmă; returnăm corr=0 pentru a nu bloca greșit.
//
// FAIL-CLOSED CONTRACT:
//   Orice eșec de I/O (Supabase error, table missing, timeout) →
//   returnăm washPeerId='__fetch_error__' + maxOverlapRatio=1.0 +
//   washPeerPnlCorr=1.0. Caller MUST hard-reject pe acest sentinel
//   (nu se bazează doar pe prag — altfel corr=0 din cache fail trece).
// ============================================================

const WASH_FAIL_CLOSED: CrossGladiatorWashScore = {
  maxOverlapRatio: 1.0,
  washPeerPnlCorr: 1.0,
  washPeerId: '__fetch_error__',
  totalCandidateKeys: 0,
};

interface WashRow {
  timestamp: number;
  symbol: string;
  decision: string;
  pnl_percent: number;
}

function normalizeDecision(d: unknown): 'LONG' | 'SHORT' | 'FLAT' | 'UNK' {
  if (typeof d !== 'string') return 'UNK';
  const s = d.trim().toUpperCase();
  if (s === 'LONG' || s === 'BUY') return 'LONG';
  if (s === 'SHORT' || s === 'SELL') return 'SHORT';
  if (s === 'FLAT' || s === 'NEUTRAL' || s === 'HOLD') return 'FLAT';
  return 'UNK';
}

/**
 * Build key→signed-pnl map for one gladiator's rows.
 * Key = `${bucket}|${symbol}` (decision dropped; direction captured in sign).
 * Signed pnl: LONG → +pnl, SHORT → -pnl (so both-right same-dir trades correlate +1,
 * mirror-hedge correlates -1, parallel wash with any direction mix collapses to |corr|≈1).
 */
function buildWashKeyMap(rows: WashRow[], bucketMs: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const t = typeof r.timestamp === 'number' ? r.timestamp : Number(r.timestamp);
    if (!Number.isFinite(t) || t <= 0) continue;
    const dir = normalizeDecision(r.decision);
    if (dir === 'UNK') continue;
    const sym = typeof r.symbol === 'string' ? r.symbol : String(r.symbol || '');
    if (!sym) continue;
    const bucket = Math.floor(t / bucketMs);
    const key = `${bucket}|${sym}`;
    const pnlRaw = typeof r.pnl_percent === 'number' ? r.pnl_percent : Number(r.pnl_percent);
    if (!Number.isFinite(pnlRaw)) continue;
    const signed = dir === 'SHORT' ? -pnlRaw : (dir === 'FLAT' ? 0 : pnlRaw);
    // If the same key repeats within one gladiator (rare), keep the latest entry.
    map.set(key, signed);
  }
  return map;
}

/**
 * Streaming Pearson (Welford-style single-pass) on aligned value pairs.
 * Returns 0 for n<5 (insufficient samples) or non-finite result.
 */
function streamingPearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return 0;
  let meanX = 0, meanY = 0, c = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    const dx = x - meanX;
    meanX += dx / (i + 1);
    const dy = y - meanY;
    meanY += dy / (i + 1);
    c += dx * (y - meanY);
    varX += dx * (x - meanX);
    varY += dy * (y - meanY);
  }
  const denom = Math.sqrt(varX * varY);
  if (!Number.isFinite(denom) || denom <= 0) return 0;
  const corr = c / denom;
  if (!Number.isFinite(corr)) return 0;
  return Math.max(-1, Math.min(1, corr));
}

/**
 * Cross-gladiator wash score for a candidate against a peer set.
 *
 * @param candidateId  gladiator under evaluation (promotion candidate)
 * @param peerIds      peers to compare against (live first, then phantom; caller caps to maxPeers)
 * @param opts         bucketMs (default 30min), lookbackTrades (default 200), minShared (default 30)
 * @returns            CrossGladiatorWashScore; on I/O failure returns WASH_FAIL_CLOSED sentinel.
 */
export async function getCrossGladiatorWashScore(
  candidateId: string,
  peerIds: string[],
  opts: { bucketMs?: number; lookbackTrades?: number; minSharedTrades?: number } = {}
): Promise<CrossGladiatorWashScore> {
  const bucketMs = opts.bucketMs ?? 1_800_000;
  const lookback = opts.lookbackTrades ?? 200;
  const minShared = opts.minSharedTrades ?? 30;
  const peers = (peerIds || []).filter((p) => p && p !== candidateId);
  const ids = [candidateId, ...peers];

  if (!supabaseUrl || !dbInitialized) {
    // Memory fallback — acceptable for tests/dev; LIVE path has DB.
    try {
      const perGladRows: Record<string, WashRow[]> = {};
      for (const id of ids) {
        const own = (cache.gladiatorDna as Record<string, unknown>[])
          .filter((r) => r.gladiatorId === id)
          .slice(0, lookback);
        perGladRows[id] = own.map((r) => ({
          timestamp: typeof r.timestamp === 'number' ? r.timestamp : Number(r.timestamp),
          symbol: typeof r.symbol === 'string' ? r.symbol : String(r.symbol || ''),
          decision: typeof r.decision === 'string' ? r.decision : String(r.decision || ''),
          pnl_percent: typeof r.pnlPercent === 'number' ? r.pnlPercent : Number(r.pnlPercent),
        }));
      }
      return scoreFromPerGladiator(candidateId, peers, perGladRows, bucketMs, minShared);
    } catch {
      return WASH_FAIL_CLOSED;
    }
  }

  try {
    // Batched single round-trip: pull newest `lookback * ids.length` rows for all gladiators.
    // Filter client-side per gladiator (simpler than N queries; rows capped by lookback later).
    const totalLimit = Math.max(1000, lookback * ids.length * 2);
    const { data, error } = await supabase
      .from('gladiator_battles')
      .select('gladiator_id, timestamp, symbol, decision, pnl_percent')
      .in('gladiator_id', ids)
      .order('timestamp', { ascending: false })
      .limit(totalLimit);
    if (error || !data) return WASH_FAIL_CLOSED;

    const perGladRows: Record<string, WashRow[]> = {};
    for (const id of ids) perGladRows[id] = [];
    for (const row of data as Record<string, unknown>[]) {
      const gid = typeof row.gladiator_id === 'string' ? row.gladiator_id : '';
      if (!gid || !perGladRows[gid]) continue;
      if (perGladRows[gid].length >= lookback) continue;
      const ts = typeof row.timestamp === 'number' ? row.timestamp : Number(row.timestamp);
      const pnl = typeof row.pnl_percent === 'number' ? row.pnl_percent : Number(row.pnl_percent);
      if (!Number.isFinite(ts) || !Number.isFinite(pnl)) continue;
      perGladRows[gid].push({
        timestamp: ts,
        symbol: typeof row.symbol === 'string' ? row.symbol : String(row.symbol || ''),
        decision: typeof row.decision === 'string' ? row.decision : String(row.decision || ''),
        pnl_percent: pnl,
      });
    }
    return scoreFromPerGladiator(candidateId, peers, perGladRows, bucketMs, minShared);
  } catch {
    return WASH_FAIL_CLOSED;
  }
}

function scoreFromPerGladiator(
  candidateId: string,
  peers: string[],
  perGladRows: Record<string, WashRow[]>,
  bucketMs: number,
  minShared: number
): CrossGladiatorWashScore {
  const candMap = buildWashKeyMap(perGladRows[candidateId] || [], bucketMs);
  const totalCand = candMap.size;
  if (totalCand === 0) {
    return { maxOverlapRatio: 0, washPeerPnlCorr: 0, washPeerId: null, totalCandidateKeys: 0 };
  }

  let bestOverlap = 0;
  let bestAbsCorr = 0;
  let bestPeer: string | null = null;
  let bestSignedCorr = 0;

  for (const pid of peers) {
    const peerMap = buildWashKeyMap(perGladRows[pid] || [], bucketMs);
    if (peerMap.size === 0) continue;

    // Shared keys
    const xs: number[] = [];
    const ys: number[] = [];
    let shared = 0;
    for (const [k, vCand] of candMap) {
      const vPeer = peerMap.get(k);
      if (vPeer === undefined) continue;
      xs.push(vCand);
      ys.push(vPeer);
      shared++;
    }
    if (shared === 0) continue;

    const denom = Math.min(totalCand, peerMap.size);
    const overlap = denom > 0 ? shared / denom : 0;
    const corr = shared >= minShared ? streamingPearson(xs, ys) : 0;
    const absCorr = Math.abs(corr);

    // Track maxima independently; same peer often dominates both.
    if (overlap > bestOverlap) bestOverlap = overlap;
    if (absCorr > bestAbsCorr) {
      bestAbsCorr = absCorr;
      bestSignedCorr = corr;
      bestPeer = pid;
    }

    // Early exit — unmistakable wash.
    if (bestOverlap >= 0.95 && bestAbsCorr >= 0.95) break;
  }

  return {
    maxOverlapRatio: parseFloat(bestOverlap.toFixed(4)),
    washPeerPnlCorr: parseFloat(bestSignedCorr.toFixed(4)),
    washPeerId: bestPeer,
    totalCandidateKeys: totalCand,
  };
}

// ─── Phantom Trades (Arena Combat Engine) ───────
export function getPhantomTrades(): PhantomTrade[] {
  return cache.phantomTrades;
}

export function addPhantomTrade(trade: PhantomTrade): void {
  // FIX 2026-04-19: phantomMutex prevents concurrent reads of stale localMap
  // (was fire-and-forget IIFE with no lock → duplicates + array corruption)
  //
  // RUFLO FAZA 3 Batch 2 (C4) 2026-04-19: Track IIFE promise so flushPendingSyncs
  // can await it before draining. Same race as addDecision / saveGladiatorsToDb.
  const p = (async () => {
    const release = await phantomMutex.acquire();
    try {
      if (supabaseUrl && dbInitialized) {
        try {
          const { data } = await supabase.from('json_store').select('data').eq('id', 'phantom_trades').single();
          if (data?.data) {
            const remote = data.data as PhantomTrade[];
            const localMap = new Map(cache.phantomTrades.map(t => [t.id, t]));
            for (const rt of remote) {
              if (!localMap.has(rt.id)) cache.phantomTrades.push(rt);
            }
            cache.phantomTrades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          }
        } catch (err) { log.warn('Failed to merge remote phantom trades', { error: String(err) }); }
      }

      if (!cache.phantomTrades.some(t => t.id === trade.id)) {
        cache.phantomTrades.unshift(trade);
        // FIX 2026-04-19: was 500 — evicted trades before MAX_HOLD_SEC (3600s) expiry.
        // At ~24 trades/tick × 12 ticks/hr = ~1440 trades/hr. Cap 2500 = ~1.7hr buffer.
        // Only trades that have been evaluated (via evaluatePhantomTrades) are removed
        // by removePhantomTrade(). This cap is safety valve for memory, not flow control.
        if (cache.phantomTrades.length > 2500) cache.phantomTrades.length = 2500;
      }

      syncToCloud('phantom_trades', cache.phantomTrades);
    } finally {
      release();
    }
  })();
  pendingPhantomSaves.add(p);
  p.finally(() => pendingPhantomSaves.delete(p)).catch(() => { /* tracked via add/delete */ });
}

export function removePhantomTrade(id: string): void {
  cache.phantomTrades = cache.phantomTrades.filter(t => t.id !== id);
  syncToCloud('phantom_trades', cache.phantomTrades);
}

// ─── Live Positions (Real Time Manager) ─────────
export function getLivePositions(): LivePosition[] {
  return cache.livePositions;
}

// ─── OMEGA: Strict DB Verification ──────────────
// Pulls directly from Postgres to bypass stale memory
export async function isPositionOpenStrict(symbol: string): Promise<boolean> {
  if (!supabaseUrl) {
    return cache.livePositions.some(p => p.symbol === symbol && p.status === 'OPEN');
  }
  // FIX 2026-04-19: 3s timeout prevents hung DB from blocking live trade path
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const { data, error } = await supabase.from('live_positions')
      .select('id')
      .eq('symbol', symbol)
      .eq('status', 'OPEN')
      .limit(1)
      .abortSignal(ctrl.signal);

    if (error) {
      log.warn('Strict position check failed, falling back to cache', { symbol, error: error.message });
      return true; // Safe fallback: assume open to prevent double buy
    }
    return data && data.length > 0;
  } catch (err) {
    log.warn('Strict position check timed out, falling back to cache', { symbol, error: String(err) });
    return cache.livePositions.some(p => p.symbol === symbol && p.status === 'OPEN');
  } finally {
    clearTimeout(timer);
  }
}

export function addLivePosition(pos: LivePosition): void {
  cache.livePositions.unshift(pos);
  if (supabaseUrl && dbInitialized) {
    // C7 FIX #1+#4: Add .catch() + promise tracking for flushPendingSyncs.
    // Was fire-and-forget → Cloud Run freeze before write lands = position lost.
    const p = Promise.resolve(supabase.from('live_positions').insert(pos)).then(({ error }) => {
      if (error) log.warn('Failed to insert live position to Supabase', { error: error.message });
    }).catch((err: unknown) => log.error('addLivePosition transport error', { error: String(err) }));
    pendingLivePositionSaves.add(p);
    p.finally(() => pendingLivePositionSaves.delete(p));
  }
}

export function updateLivePosition(id: string, updates: Partial<LivePosition>): void {
  const idx = cache.livePositions.findIndex((p) => p.id === id);
  if (idx > -1) {
    cache.livePositions[idx] = { ...cache.livePositions[idx], ...updates };
    if (supabaseUrl && dbInitialized) {
      // C7 FIX #1+#4: Add .catch() + promise tracking.
      const p = Promise.resolve(supabase.from('live_positions').update(updates).eq('id', id)).then(({ error }) => {
         if (error) log.error('Failed to update live position', { id, error: error.message });
      }).catch((err: unknown) => log.error('updateLivePosition transport error', { id, error: String(err) }));
      pendingLivePositionSaves.add(p);
      p.finally(() => pendingLivePositionSaves.delete(p));
    }
    // FIX 2026-04-19: Trim closed positions to prevent unbounded memory growth.
    // Keep max 200 closed + all OPEN. In LIVE mode with many trades, this prevents OOM.
    const closed = cache.livePositions.filter(p => p.status !== 'OPEN');
    if (closed.length > 200) {
      const openPositions = cache.livePositions.filter(p => p.status === 'OPEN');
      const recentClosed = closed.slice(0, 200); // already sorted newest-first (unshift in addLivePosition)
      cache.livePositions = [...openPositions, ...recentClosed];
    }
  }
}

// ─── Invalid Symbols (Ticker Filter) ──────────────
export function getInvalidSymbols(): string[] {
  return cache.invalidSymbols;
}

export function addInvalidSymbol(symbol: string): void {
  if (!cache.invalidSymbols.includes(symbol)) {
    cache.invalidSymbols.push(symbol);
    syncToCloud('invalid_symbols', cache.invalidSymbols);
    log.warn(`⚠️ Symbol ${symbol} blacklisted manually due to MEXC fetch error.`);
  }
}

export function isSymbolValid(symbol: string): boolean {
  return !cache.invalidSymbols.includes(symbol);
}

// ─── Performance Records ───────────────────────────
export function getPerformance(): PerformanceRecord[] {
  return cache.performance;
}

export function savePerformance(records: PerformanceRecord[]): void {
  cache.performance = records;
  syncToCloud('performance', cache.performance);
}

export function recalculatePerformance(): PerformanceRecord[] {
  const decisions = getDecisions().filter((d) => d.outcome !== 'PENDING');
  const groups: Record<string, DecisionSnapshot[]> = {};

  for (const d of decisions) {
    const key = `${d.signal}|${d.source}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  }

  const records: PerformanceRecord[] = Object.entries(groups).map(([key, trades]) => {
    const [signalType, source] = key.split('|');
    const wins = trades.filter((t) => t.outcome === 'WIN').length;
    const losses = trades.filter((t) => t.outcome === 'LOSS').length;
    const neutral = trades.filter((t) => t.outcome === 'NEUTRAL').length;
    const pnls = trades.map((t) => t.pnlPercent || 0);

    return {
      signalType,
      source,
      totalTrades: trades.length,
      wins,
      losses,
      neutral,
      winRate: trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0,
      avgPnlPercent: pnls.length > 0 ? Math.round((pnls.reduce((a, b) => a + b, 0) / pnls.length) * 100) / 100 : 0,
      bestTrade: Math.max(...pnls, 0),
      worstTrade: Math.min(...pnls, 0),
      lastUpdated: new Date().toISOString(),
    };
  });

  savePerformance(records);
  return records;
}

// ─── Optimizer State ───────────────────────────────
export function getOptimizerState(): OptimizationState {
  return cache.optimizer;
}

export function saveOptimizerState(state: OptimizationState): void {
  cache.optimizer = state;
  syncToCloud('optimizer', cache.optimizer);
}

// ─── Bot Config ────────────────────────────────────
export interface BotConfig {
  mode: BotMode;
  autoOptimize: boolean;
  paperBalance: number;
  riskPerTrade: number;
  maxOpenPositions: number;
  evaluationIntervals: number[];
  aiStatus: 'OK' | 'NO_CREDIT';
  haltedUntil: string | null; // ISO Timestamp for cooldown
}

export function getBotConfig(): BotConfig {
  return cache.config;
}

export function saveBotConfig(config: Partial<BotConfig>): void {
  cache.config = { ...cache.config, ...config };
  syncToCloud('config', cache.config);
}// ─── Equity Curve (Continuous & Non-Destructive) ─────
export interface EquityPoint {
  timestamp: string;
  pnl: number;
  balance: number;
  outcome: string;
  signal: string;
  symbol: string;
  mode?: 'PAPER' | 'LIVE'; // AUDIT FIX CRITIC-8: Separate paper/live equity
}

export function getEquityCurve(filterMode?: 'PAPER' | 'LIVE'): EquityPoint[] {
  if (cache.equityHistory.length === 0) {
    // ═══ BOOTSTRAP: Reconstruct equity curve from historical decisions ═══
    const evaluated = cache.decisions
      .filter(d => d.outcome === 'WIN' || d.outcome === 'LOSS' || d.outcome === 'NEUTRAL')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    if (evaluated.length === 0) {
      return [{
        timestamp: new Date().toISOString(),
        balance: cache.config.paperBalance || 1000,
        pnl: 0,
        outcome: 'WIN',
        signal: 'SEED',
        symbol: 'SYSTEM',
      }];
    }

    const startBalance = cache.config.paperBalance || 1000;
    const positionSize = cache.config.riskPerTrade || 1.0;
    let currentBalance = startBalance;
    let cumulativePnl = 0;
    const bootstrapped: EquityPoint[] = [];

    for (const dec of evaluated) {
      const pnlPct = dec.pnlPercent || 0;
      const tradeImpact = currentBalance * (positionSize / 100) * (pnlPct / 100);
      currentBalance = Math.max(currentBalance + tradeImpact, 0);
      // Real cumulative PnL derived from balance (compounded, not linear sum)
      cumulativePnl = ((currentBalance - startBalance) / startBalance) * 100;

      bootstrapped.push({
        timestamp: dec.timestamp,
        balance: Math.round(currentBalance * 100) / 100,
        pnl: Math.round(cumulativePnl * 100) / 100,
        outcome: dec.outcome,
        signal: dec.signal,
        symbol: dec.symbol,
      });
    }

    // Cache the bootstrapped curve so we don't reconstruct every time
    cache.equityHistory = bootstrapped;
    log.info(`[Equity Bootstrap] Reconstructed ${bootstrapped.length} points from decisions. Balance: $${currentBalance.toFixed(2)}`);
    
    return filterMode ? bootstrapped.filter(e => e.mode === filterMode) : bootstrapped;
  }
  // AUDIT FIX CRITIC-8: Filter equity curve by mode to prevent paper/live contamination
  return filterMode ? cache.equityHistory.filter(e => e.mode === filterMode) : cache.equityHistory;
}

// Internal function to push a closed trade onto the real curve 
// without recalculating the history (so we never reset on truncations)
export function appendToEquityCurve(dec: DecisionSnapshot, pnlPct: number): void {
  if (cache.equityHistory.some(e => e.timestamp === dec.timestamp && e.symbol === dec.symbol)) return;

  const config = getBotConfig();
  const positionSize = config.riskPerTrade || 1.0;
  let currentPnl = 0;
  let currentBalance = cache.config.paperBalance || 1000;

  if (cache.equityHistory.length > 0) {
    const last = cache.equityHistory[cache.equityHistory.length - 1];
    currentPnl = last.pnl;
    currentBalance = last.balance;
  }

  const tradeImpact = currentBalance * (positionSize / 100) * (pnlPct / 100);
  currentBalance = Math.max(currentBalance + tradeImpact, 0);
  // Real cumulative PnL from balance (compounded)
  const startBal = cache.config.paperBalance || 1000;
  currentPnl = ((currentBalance - startBal) / startBal) * 100;

  // Auto-compound into the master config so baseline goes up
  saveBotConfig({ paperBalance: currentBalance });

  const newPoint: EquityPoint = {
    timestamp: dec.timestamp || new Date().toISOString(),
    pnl: Math.round(currentPnl * 100) / 100,
    balance: Math.round(currentBalance * 100) / 100,
    outcome: dec.outcome,
    signal: dec.signal,
    symbol: dec.symbol,
    mode: config.mode as 'PAPER' | 'LIVE', // AUDIT FIX CRITIC-8: Tag equity by mode
  };

  // C7 FIX #9: Cap at append instead of reactive trim — avoids unnecessary array reallocation.
  if (cache.equityHistory.length >= 1000) cache.equityHistory.shift();
  cache.equityHistory.push(newPoint);
  
  if (supabaseUrl && dbInitialized) {
    // Map in-memory EquityPoint to actual Supabase table schema
    // Table columns: id, timestamp, equity, cash, positions, pnl_day, pnl_total, mode
    const dbRow = {
      timestamp: newPoint.timestamp,
      equity: newPoint.balance,         // balance → equity column
      cash: newPoint.balance,           // no separate cash tracking yet
      positions: [],                    // no position-level detail yet
      pnl_day: pnlPct,                 // this trade's PnL %
      pnl_total: newPoint.pnl,         // cumulative PnL %
      mode: newPoint.mode || 'PAPER',
    };
    Promise.resolve(supabase.from('equity_history').insert(dbRow)).then(({ error }) => {
      if (error) log.error('Failed to insert equity history', { error: error.message });
    }).catch((err: unknown) => log.error('equity_history transport error', { error: String(err) }));
  }
}

// ─── OMEGA: Distributed Trade Lock ─────────────────
// Prevents duplicate trade execution across Cloud Run instances.
// Uses Supabase `trade_locks` table with row-level insert conflict detection.
// Schema: CREATE TABLE trade_locks (symbol TEXT PRIMARY KEY, instance_id TEXT, expires_at TIMESTAMPTZ);
// If Supabase is unavailable, defaults to in-memory lock (single-instance fallback).

const instanceId = `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const localLocks = new Map<string, number>(); // symbol -> expiry timestamp
const LOCK_TTL_MS = 30_000; // 30 seconds

/**
 * INSTITUTIONAL FIX: Removed broken RPC call that always failed (function never existed).
 * Standardized on INSERT with conflict detection — clean, predictable, no log pollution.
 * Pattern: cleanup expired → INSERT → conflict = lock held by another instance.
 */
export async function acquireTradeLock(symbol: string): Promise<boolean> {
  // Cleanup expired local locks
  const now = Date.now();
  for (const [sym, exp] of localLocks) {
    if (exp < now) localLocks.delete(sym);
  }

  // Check local lock first (protects within same instance)
  if (localLocks.has(symbol) && localLocks.get(symbol)! > now) {
    log.warn(`[TradeLock] LOCAL lock active for ${symbol} — skipping.`);
    return false;
  }

  // Set local lock immediately
  localLocks.set(symbol, now + LOCK_TTL_MS);

  // Try Supabase distributed lock (cross-instance protection)
  if (!supabaseUrl || !dbInitialized) return false; // Fallback: CONSERVATIVE — prevent double trades if DB is down

  try {
    const expiresAt = new Date(now + LOCK_TTL_MS).toISOString();

    // Step 1: Cleanup expired locks (prevent stale locks from blocking)
    await supabase.from('trade_locks').delete().lt('expires_at', new Date().toISOString());

    // Step 2: Atomic INSERT — if another instance holds an active lock, PRIMARY KEY
    // conflict (23505) means we must not proceed.
    const { error: insertErr } = await supabase.from('trade_locks').insert({
      symbol, instance_id: instanceId, expires_at: expiresAt,
    });

    if (insertErr) {
      if (insertErr.code === '23505') {
        log.info(`[TradeLock] Distributed lock conflict for ${symbol} — another instance is handling it.`);
        localLocks.delete(symbol);
        return false;
      }
      // Non-conflict error (table doesn't exist, permissions, etc.) — degrade to local
      log.warn(`[TradeLock] Supabase error (${insertErr.message}), proceeding with local lock only.`);
    }

    return true;
  } catch (err) {
    log.warn(`[TradeLock] Distributed lock failed (${(err as Error).message}), local lock only.`);
    return false; // CONSERVATIVE — if Supabase fails, DENY lock to prevent double trades
  }
}

export async function releaseTradeLock(symbol: string): Promise<void> {
  localLocks.delete(symbol);

  if (!supabaseUrl || !dbInitialized) return;

  try {
    await supabase.from('trade_locks')
      .delete()
      .eq('symbol', symbol)
      .eq('instance_id', instanceId);
  } catch (err) {
    log.warn('Failed to release distributed trade lock, TTL will expire it', { symbol, error: String(err) });
  }
}

// ─── R5-lite: Cross-Instance Task Lease ────────────────
// Prevents duplicate execution of cron/scheduler tasks across Cloud Run instances.
// Reuses trade_locks table with reserved `__task__` prefix on the symbol column.
//
// WHY reuse trade_locks:
//   - Already has PRIMARY KEY on symbol → true atomic INSERT-or-conflict semantics.
//   - Dedicated lease table would require a Supabase migration (blocks autonomous deploy).
//   - Prefix `__task__` cannot collide with a real MEXC symbol (no double-underscore tickers).
//
// TTL tradeoff: lease expires even if holder crashes → no stuck lock.
// If an instance takes longer than ttlMs to finish its work, a second instance
// may take over mid-tick. This is ACCEPTED — a stuck instance is worse than overlap.
// Choose ttlMs slightly BELOW the cron cadence (cron=60s → lease=50s).
//
// ASSUMPTION: Supabase reachable. If DB is down we return { acquired: true, degraded: true }
// so cron keeps running in single-instance mode (no idempotence but also no silent halt).
export function getInstanceId(): string { return instanceId; }

export async function tryAcquireTaskLease(
  taskKey: string,
  ttlMs: number
): Promise<{ acquired: boolean; holder?: string; degraded?: boolean }> {
  const lockSymbol = `__task__${taskKey}`;

  if (!supabaseUrl || !dbInitialized) {
    // Degraded mode: DB unreachable. Allow tick to proceed (no idempotence, but
    // better than silently halting the entire cron loop).
    return { acquired: true, degraded: true };
  }

  try {
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs).toISOString();

    // Step 1: Cleanup expired leases system-wide (cheap; keeps table small).
    await supabase.from('trade_locks').delete().lt('expires_at', new Date().toISOString());

    // Step 2: Atomic INSERT. If another instance holds active lease → 23505.
    const { error: insertErr } = await supabase.from('trade_locks').insert({
      symbol: lockSymbol, instance_id: instanceId, expires_at: expiresAt,
    });

    if (!insertErr) return { acquired: true };

    if (insertErr.code === '23505') {
      // Conflict: someone else holds it. Read holder for observability.
      const { data } = await supabase.from('trade_locks')
        .select('instance_id')
        .eq('symbol', lockSymbol)
        .maybeSingle();
      return { acquired: false, holder: (data?.instance_id as string) || 'unknown' };
    }

    // Non-conflict Supabase error (schema/permissions) → degrade to allow.
    log.warn(`[TaskLease] Supabase insert error for ${lockSymbol} (${insertErr.message}) — degrading to allow.`);
    return { acquired: true, degraded: true };
  } catch (err) {
    log.warn(`[TaskLease] Lease acquisition crashed (${(err as Error).message}) — degrading to allow.`);
    return { acquired: true, degraded: true };
  }
}

export async function releaseTaskLease(taskKey: string): Promise<void> {
  if (!supabaseUrl || !dbInitialized) return;
  const lockSymbol = `__task__${taskKey}`;
  try {
    await supabase.from('trade_locks')
      .delete()
      .eq('symbol', lockSymbol)
      .eq('instance_id', instanceId);
  } catch (err) {
    log.warn('Failed to release task lease, TTL will expire it', { taskKey, error: String(err) });
  }
}

// ─── Polymarket State Persistence ───────────────────────
export async function loadPolyStateFromCloud(): Promise<{ wallet: Record<string, unknown> | null; gladiators: unknown[] | null }> {
  if (!supabaseUrl || !dbInitialized) return { wallet: null, gladiators: null };

  try {
    const { data, error } = await supabase
      .from('json_store')
      .select('*')
      .in('id', ['poly_wallet', 'poly_gladiators']);
    if (error) { log.warn('Failed to load Polymarket state from cloud', { error: error.message }); return { wallet: null, gladiators: null }; }

    const walletRow = data?.find((r: Record<string, unknown>) => r.id === 'poly_wallet');
    const gladiatorsRow = data?.find((r: Record<string, unknown>) => r.id === 'poly_gladiators');

    return {
      wallet: (walletRow?.data as Record<string, unknown>) || null,
      gladiators: (gladiatorsRow?.data as unknown[]) || null,
    };
  } catch (err) {
    log.warn('Failed to load Polymarket state from cloud', { error: String(err) });
    return { wallet: null, gladiators: null };
  }
}

export function savePolyWalletToCloud(wallet: Record<string, unknown>): void {
  syncToCloud('poly_wallet', wallet);
}

export function savePolyGladiatorsToCloud(gladiators: unknown[]): void {
  syncToCloud('poly_gladiators', gladiators);
}

// Persist/restore scanner results cross-instance — fixes lastScans=0 artifact
// when Cron writes on instance A and UI reads from instance B (in-memory only).
export function savePolyLastScansToCloud(scans: Record<string, unknown>): void {
  syncToCloud('poly_last_scans', scans);
}

export async function loadPolyLastScansFromCloud(): Promise<Record<string, unknown> | null> {
  if (!supabaseUrl || !dbInitialized) return null;
  try {
    const { data, error } = await supabase
      .from('json_store')
      .select('data')
      .eq('id', 'poly_last_scans')
      .maybeSingle();
    if (error) { log.warn('Failed to load poly_last_scans', { error: error.message }); return null; }
    return (data?.data as Record<string, unknown>) || null;
  } catch (err) {
    log.warn('Failed to load poly_last_scans', { error: String(err) });
    return null;
  }
}

export { supabase }; // Export for diagnostics endpoint
