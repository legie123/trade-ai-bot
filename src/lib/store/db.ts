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

const log = createLogger('Database-Supabase');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// Upgrade: Prefer Service Role Key for backend operations to bypass RLS restrictions
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Avoid crashing if credentials are not valid during build
const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder'
);

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
    riskPerTrade: 1.5,
    maxOpenPositions: 3,
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

  if (!supabaseUrl) {
    dbInitialized = true;
    log.info('DB initialized in memory-only mode (no Supabase URL)');
    return;
  }

  try {
    const { data, error } = await supabase.from('json_store').select('*');
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
        if (row.id === 'invalid_symbols') cache.invalidSymbols = row.data || [];
      }
    }

    // --- NEW: Load from True Postgres Tables ---
    const { data: equityData, error: eqErr } = await supabase.from('equity_history').select('*').order('timestamp', { ascending: true }).limit(500);
    if (!eqErr && equityData) {
      cache.equityHistory = equityData;
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

    dbInitialized = true;
  } catch (err) {
    log.error('Supabase init execution error', { error: String(err) });
    dbInitialized = true;
  }
}

// ─── Atomic Sync Queue (Ensures sequential Cloud writes) ───
let syncQueue = Promise.resolve();
let syncQueueLength = 0;
let totalSyncsCompleted = 0;
let lastSyncComplete = new Date().toISOString();

export function getSyncQueueStats() {
  return {
    pending: syncQueueLength,
    totalCompleted: totalSyncsCompleted,
    lastSyncComplete,
  };
}

function syncToCloud(id: string, data: unknown) {
  if (!supabaseUrl || !dbInitialized) return;

  syncQueueLength++;
  syncQueue = syncQueue.then(async () => {
    try {
      const { error } = await supabase.from('json_store').upsert({ id, data });
      if (error) log.error(`Supabase sync failed for ${id}`, { error: error.message });
      else {
          totalSyncsCompleted++;
          lastSyncComplete = new Date().toISOString();
      }
      // Artificial delay to prevent Supabase rate limits (100ms)
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      log.error(`Critical error in syncQueue for ${id}`, { error: String(err) });
    } finally {
        syncQueueLength--;
    }
  });
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

  // Calibration #13: Final confidence floor — reject garbage signals at DB level
  if (snapshot.confidence < 65 && snapshot.signal !== 'NEUTRAL') {
    return; // Silent drop — engine should have caught this
  }
  
  cache.decisions.unshift(snapshot);
  if (cache.decisions.length > 1000) cache.decisions.length = 1000;
  syncToCloud('decisions', cache.decisions);
}

export function updateDecision(id: string, updates: Partial<DecisionSnapshot>): void {
  const idx = cache.decisions.findIndex((d) => d.id === id);
  if (idx === -1) return;
  cache.decisions[idx] = { ...cache.decisions[idx], ...updates };
  syncToCloud('decisions', cache.decisions);
}

// ─── Syndicate Audit (Combat Logs) ────────────────
export function addSyndicateAudit(audit: Record<string, unknown>): void {
  const newAudit = { ...audit, id: `audit-${Date.now()}` };
  cache.syndicateAudits.unshift(newAudit);
  if (cache.syndicateAudits.length > 500) cache.syndicateAudits.length = 500;
  
  if (supabaseUrl && dbInitialized) {
    const cleanAudit = { ...newAudit };
    if ((cleanAudit as Record<string, unknown>).finalDirection) {
      (cleanAudit as Record<string, unknown>).signal = (cleanAudit as Record<string, unknown>).finalDirection;
    }
    delete (cleanAudit as Record<string, unknown>).finalDirection; // 🛡️ Fix scheme mismatch missing column
    supabase.from('syndicate_audits').insert(cleanAudit).then(({ error }) => {
      if (error) log.error('Failed to insert syndicate audit', { error: error.message });
    });
  }
}

export function getSyndicateAudits(): Record<string, unknown>[] {
  return cache.syndicateAudits;
}

// ─── Gladiators (V2 Memory) ──────────────────────
export function getGladiatorsFromDb(): Gladiator[] {
  return cache.gladiators;
}

export function saveGladiatorsToDb(gladiators: Gladiator[]): void {
  cache.gladiators = gladiators;
  syncToCloud('gladiators', cache.gladiators);
}

// ─── DNA Bank (Gladiator Battles) ────────────────
export async function addGladiatorDna(record: Record<string, unknown>): Promise<void> {
  const newRecord = { ...record, internalId: `dna-${Date.now()}-${Math.random()}` };

  if (!supabaseUrl) {
    cache.gladiatorDna.unshift(newRecord);
    if (cache.gladiatorDna.length > 2000) cache.gladiatorDna.length = 2000;
    return;
  }

  try {
    // 🛡️ MULTI-INSTANCE FIX: Fetch absolute latest before appending
    const { data } = await supabase.from('json_store').select('data').eq('id', 'gladiator_dna').single();
    const currentDna = (data?.data as Record<string, unknown>[]) || cache.gladiatorDna;
    
    currentDna.unshift(newRecord);
    if (currentDna.length > 2000) currentDna.length = 2000;
    
    cache.gladiatorDna = currentDna;
    syncToCloud('gladiator_dna', currentDna);
  } catch {
    // Fallback if network fails
    cache.gladiatorDna.unshift(newRecord);
    syncToCloud('gladiator_dna', cache.gladiatorDna);
  }
}

export function getGladiatorDna(): Record<string, unknown>[] {
  return cache.gladiatorDna;
}

// ─── Phantom Trades (Arena Combat Engine) ───────
export function getPhantomTrades(): PhantomTrade[] {
  return cache.phantomTrades;
}

export function addPhantomTrade(trade: PhantomTrade): void {
  cache.phantomTrades.unshift(trade);
  if (cache.phantomTrades.length > 500) cache.phantomTrades.length = 500;
  syncToCloud('phantom_trades', cache.phantomTrades);
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
  const { data, error } = await supabase.from('live_positions')
    .select('id')
    .eq('symbol', symbol)
    .eq('status', 'OPEN')
    .limit(1);

  if (error) {
     log.error('Strict position check failed', { error: error.message });
     // Safe fallback: true (assume it's open to prevent double buy)
     return true; 
  }
  return data && data.length > 0;
}

export function addLivePosition(pos: LivePosition): void {
  cache.livePositions.unshift(pos);
  if (supabaseUrl && dbInitialized) {
    supabase.from('live_positions').insert(pos).then(({ error }) => {
      if (error) log.error('Failed to insert live position', { error: error.message });
    });
  }
}

export function updateLivePosition(id: string, updates: Partial<LivePosition>): void {
  const idx = cache.livePositions.findIndex((p) => p.id === id);
  if (idx > -1) {
    cache.livePositions[idx] = { ...cache.livePositions[idx], ...updates };
    if (supabaseUrl && dbInitialized) {
      supabase.from('live_positions').update(updates).eq('id', id).then(({ error }) => {
         if (error) log.error('Failed to update live position', { id, error: error.message });
      });
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
}

export function getEquityCurve(): EquityPoint[] {
  if (cache.equityHistory.length === 0) {
    return [{
      timestamp: new Date().toISOString(),
      balance: cache.config.paperBalance || 1000,
      pnl: 0,
      outcome: 'WIN', // Dummy values to fulfill EquityPoint schema
      signal: 'SEED',
      symbol: 'SYSTEM',
    }];
  }
  return cache.equityHistory;
}

// Internal function to push a closed trade onto the real curve 
// without recalculating the history (so we never reset on truncations)
export function appendToEquityCurve(dec: DecisionSnapshot, pnlPct: number): void {
  if (cache.equityHistory.some(e => e.timestamp === dec.timestamp && e.symbol === dec.symbol)) return;

  const config = getBotConfig();
  const positionSize = config.riskPerTrade || 1.5;
  let currentPnl = 0;
  let currentBalance = cache.config.paperBalance || 1000;

  if (cache.equityHistory.length > 0) {
    const last = cache.equityHistory[cache.equityHistory.length - 1];
    currentPnl = last.pnl;
    currentBalance = last.balance;
  }

  currentPnl += pnlPct;
  const tradeImpact = currentBalance * (positionSize / 100) * (pnlPct / 100);
  currentBalance = Math.max(currentBalance + tradeImpact, 0);

  // Auto-compound into the master config so baseline goes up
  saveBotConfig({ paperBalance: currentBalance });

  const newPoint: EquityPoint = {
    timestamp: dec.timestamp || new Date().toISOString(),
    pnl: Math.round(currentPnl * 100) / 100,
    balance: Math.round(currentBalance * 100) / 100,
    outcome: dec.outcome,
    signal: dec.signal,
    symbol: dec.symbol,
  };

  cache.equityHistory.push(newPoint);
  if (cache.equityHistory.length > 1000) cache.equityHistory.shift(); 
  
  if (supabaseUrl && dbInitialized) {
    supabase.from('equity_history').insert(newPoint).then(({ error }) => {
      if (error) log.error('Failed to insert equity history', { error: error.message });
    });
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
  if (!supabaseUrl || !dbInitialized) return true; // Fallback: local-only

  try {
    const expiresAt = new Date(now + LOCK_TTL_MS).toISOString();
    
    // First: cleanup expired locks from other instances
    await supabase.from('trade_locks').delete().lt('expires_at', new Date().toISOString());
    
    // Then: attempt to acquire lock via INSERT (conflict = another instance has it)
    const { error } = await supabase.from('trade_locks').insert({
      symbol,
      instance_id: instanceId,
      expires_at: expiresAt,
    });

    if (error) {
      // Conflict = another instance already locked this symbol
      if (error.code === '23505') { // unique_violation
        log.warn(`[TradeLock] DISTRIBUTED lock conflict for ${symbol} — another instance is handling it.`);
        localLocks.delete(symbol); // Release local lock since we can't get distributed
        return false;
      }
      // Other Supabase error — treat as lock acquired (graceful degradation)
      log.warn(`[TradeLock] Supabase error (${error.message}), proceeding with local lock only.`);
    }

    return true;
  } catch (err) {
    log.warn(`[TradeLock] Distributed lock failed (${(err as Error).message}), local lock only.`);
    return true; // Graceful degradation to local-only
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
  } catch {
    // Non-critical, TTL will expire it
  }
}

export { supabase }; // Export for diagnostics endpoint
