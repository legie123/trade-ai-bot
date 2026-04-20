// ============================================================
// Shared Polymarket State — Singleton used by main route + all cron routes
// Wallet, Gladiators, initialization, and serialization
// ============================================================

import { createPolyWallet, PolyWallet, type PolyPosition, type DivisionBalance } from './polyWallet';
import { PolyGladiator, spawnPolyGladiator } from './polyGladiators';
import { PolyDivision } from './polyTypes';
import {
  loadPolyStateFromCloud,
  savePolyWalletToCloud,
  savePolyGladiatorsToCloud,
  loadPolyLastScansFromCloud,
  savePolyLastScansToCloud,
  initDB,
} from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { metrics, safeSet } from '@/lib/observability/metrics';

const log = createLogger('PolyState');

let polyWallet: PolyWallet = createPolyWallet();
let polyGladiators: PolyGladiator[] = [];
let lastScanResults: Record<string, unknown> = {};
let initialized = false;
let initPromise: Promise<void> | null = null;

// ── Serialize Map → plain object for Supabase ──
export function serializeWallet(w: PolyWallet): Record<string, unknown> {
  return {
    id: w.id,
    createdAt: w.createdAt,
    type: w.type,
    totalBalance: w.totalBalance,
    totalInvested: w.totalInvested,
    totalRealizedPnL: w.totalRealizedPnL,
    allPositions: w.allPositions,
    divisionBalances: Object.fromEntries(w.divisionBalances),
    dailyLossTrackingDate: w.dailyLossTrackingDate,
    dailyRealizedPnL: w.dailyRealizedPnL,
    tradingDisabledReason: w.tradingDisabledReason,
  };
}

// ── Deserialize plain object → PolyWallet with Map ──
export function deserializeWallet(data: Record<string, unknown>): PolyWallet {
  const type = (data.type as 'PAPER' | 'LIVE') ?? 'PAPER';
  const wallet = createPolyWallet(type);
  wallet.id = data.id as string;
  wallet.createdAt = data.createdAt as string;
  wallet.totalBalance = (data.totalBalance as number) ?? wallet.totalBalance;
  wallet.totalInvested = (data.totalInvested as number) ?? 0;
  wallet.totalRealizedPnL = (data.totalRealizedPnL as number) ?? 0;
  wallet.allPositions = (data.allPositions as PolyPosition[]) ?? [];
  wallet.dailyLossTrackingDate = (data.dailyLossTrackingDate as string) ?? wallet.dailyLossTrackingDate;
  wallet.dailyRealizedPnL = (data.dailyRealizedPnL as number) ?? 0;
  wallet.tradingDisabledReason = (data.tradingDisabledReason as string) ?? undefined;

  const divBalances = data.divisionBalances as Record<string, DivisionBalance> | null;
  if (divBalances) {
    for (const [div, balance] of Object.entries(divBalances)) {
      wallet.divisionBalances.set(div as PolyDivision, balance);
    }
  }
  return wallet;
}

// ── Initialize state from cloud ──
async function initPolyState(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = _doInit();
  return initPromise;
}
async function _doInit(): Promise<void> {
  try {
    // Ensure Supabase is ready
    await initDB();

    // Load persisted state
    const { wallet: savedWallet, gladiators: savedGladiators } = await loadPolyStateFromCloud();

    if (savedWallet) {
      try {
        polyWallet = deserializeWallet(savedWallet);
      } catch (err) {
        log.warn('Failed to deserialize wallet, using fresh', { error: String(err) });
        polyWallet = createPolyWallet();
      }
    }

    if (savedGladiators && Array.isArray(savedGladiators) && savedGladiators.length > 0) {
      polyGladiators = savedGladiators as PolyGladiator[];
    } else {
      // Spawn 1 gladiator per division on first boot
      const divisions = Object.values(PolyDivision);
      for (const division of divisions) {
        const g = spawnPolyGladiator(division, `${division} Analysis`);
        polyGladiators.push(g);
      }
      await persistGladiators();
    }

    if (!savedWallet) {
      await persistWallet();
    }

    // Hydrate lastScans cross-instance (was in-memory only → /api/v2/polymarket reported lastScans:0)
    try {
      const savedScans = await loadPolyLastScansFromCloud();
      if (savedScans && typeof savedScans === 'object') {
        lastScanResults = savedScans;
      }
    } catch (err) {
      log.warn('Failed to hydrate lastScans — starting empty', { error: String(err) });
    }

    initialized = true;
    log.info('PolyState initialized', {
      gladiatorCount: polyGladiators.length,
      walletBalance: polyWallet.totalBalance,
    });
  } catch (err) {
    initPromise = null; // Allow retry on failure
    log.error('PolyState initialization failed', { error: String(err) });
    throw err;
  }
}

// ── Ensure initialization is done ──
export function ensureInitialized(): void {
  if (!initPromise) {
    initPromise = initPolyState().catch(err => {
      log.error('Init promise failed', { error: String(err) });
      // Don't re-throw; keep promise once created so we don't retry infinitely
    });
  }
}

// ── Getters (read-only access to state) ──
export function getWallet(): PolyWallet {
  return polyWallet;
}

export function getGladiators(): PolyGladiator[] {
  return polyGladiators;
}

export function getLastScans(): Record<string, unknown> {
  return lastScanResults;
}

export function setLastScans(results: Record<string, unknown>): void {
  lastScanResults = results;

  // FAZA 4.2 — persistence observability. Expose per-division scan freshness
  // as a Prometheus gauge so Grafana can compute age = time() - gauge_value.
  // Stale age + nonzero persist-failure counter = multi-instance cache drift
  // or Supabase write path broken (root cause of "opportunities disappear").
  // ASUMPȚII (rup → gauge wrong, NOT financial):
  //   - Each scan result has `scannedAt: ISO string` (confirmed in marketScanner.ts:79).
  //   - If scannedAt missing/invalid → fall back to "now" so operator sees fresh
  //     (alternative: skip; chose fresh to avoid false-stale alerts on shape drift).
  //   - Division keys in Record match PolyDivision enum members (low-cardinality label).
  try {
    const nowSec = Date.now() / 1000;
    for (const [division, scan] of Object.entries(results)) {
      const scannedAt = (scan as { scannedAt?: string } | null)?.scannedAt;
      let ts = nowSec;
      if (typeof scannedAt === 'string') {
        const parsed = new Date(scannedAt).getTime();
        if (Number.isFinite(parsed)) ts = parsed / 1000;
      }
      safeSet(metrics.polymarketLastScanTimestamp, ts, { division });
    }
  } catch (e) {
    // Observability must never break persistence. Log + continue.
    log.warn('lastScan timestamp gauge update failed', { error: String(e) });
  }

  // Fire-and-forget persist to Supabase. savePolyLastScansToCloud returns void
  // (wraps debounced syncToCloud queue); persist failures are observable via
  // Cloud Logging warnings from processSyncQueue, not here. The timestamp
  // gauge above is the primary signal: if it stays fresh but UI shows lastScans=0
  // → multi-instance cache drift (instance that persisted ≠ instance that reads).
  try { savePolyLastScansToCloud(results); } catch { /* non-fatal */ }
}

// ── Persistence ──
export async function persistWallet(): Promise<void> {
  try {
    const serialized = serializeWallet(polyWallet);
    await savePolyWalletToCloud(serialized);
    log.debug('Wallet persisted', { balance: polyWallet.totalBalance });
  } catch (err) {
    log.error('Failed to persist wallet', { error: String(err) });
  }
}

export async function persistGladiators(): Promise<void> {
  try {
    await savePolyGladiatorsToCloud(polyGladiators);
    log.debug('Gladiators persisted', { count: polyGladiators.length });
  } catch (err) {
    log.error('Failed to persist gladiators', { error: String(err) });
  }
}

export async function persistBoth(): Promise<void> {
  await Promise.all([persistWallet(), persistGladiators()]);
}

// ── Wait for initialization ──
export async function waitForInit(timeoutMs = 10_000): Promise<void> {
  ensureInitialized();
  if (initPromise) {
    await Promise.race([
      initPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('PolyState init timeout')), timeoutMs),
      ),
    ]).catch(() => {
      // Timeout or init failure — proceed with defaults rather than blocking
    });
  }
}
