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
  initDB,
} from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyState');

let polyWallet: PolyWallet = createPolyWallet();
let polyGladiators: PolyGladiator[] = [];
let lastScanResults: Record<string, unknown> = {};
let initialized = false;
let initPromise: Promise<void> | null = null;

// ── Serialize Map → plain object for Supabase ──
function serializeWallet(w: PolyWallet): Record<string, unknown> {
  return {
    id: w.id,
    createdAt: w.createdAt,
    totalBalance: w.totalBalance,
    totalInvested: w.totalInvested,
    totalRealizedPnL: w.totalRealizedPnL,
    allPositions: w.allPositions,
    divisionBalances: Object.fromEntries(w.divisionBalances),
  };
}

// ── Deserialize plain object → PolyWallet with Map ──
function deserializeWallet(data: Record<string, unknown>): PolyWallet {
  const wallet = createPolyWallet();
  wallet.id = data.id as string;
  wallet.createdAt = data.createdAt as string;
  wallet.totalBalance = (data.totalBalance as number) ?? wallet.totalBalance;
  wallet.totalInvested = (data.totalInvested as number) ?? 0;
  wallet.totalRealizedPnL = (data.totalRealizedPnL as number) ?? 0;
  wallet.allPositions = (data.allPositions as PolyPosition[]) ?? [];

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
export async function waitForInit(): Promise<void> {
  ensureInitialized();
  if (initPromise) {
    await initPromise;
  }
}
