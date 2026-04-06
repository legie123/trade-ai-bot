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
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

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
          // Deduplicate by signalId
          const seen = new Set<string>();
          const deduped = raw.filter((d: DecisionSnapshot) => {
            const key = d.signalId || d.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          // Keep only latest 100 decisions (prevents infinite Supabase growth)
          const sorted = deduped.sort((a: DecisionSnapshot, b: DecisionSnapshot) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          cache.decisions = sorted.slice(0, 100);
        }
        if (row.id === 'performance') cache.performance = row.data || [];
        if (row.id === 'optimizer') cache.optimizer = row.data || cache.optimizer;
        if (row.id === 'config') cache.config = row.data || cache.config;
        if (row.id === 'gladiators') cache.gladiators = row.data || [];
        if (row.id === 'syndicate_audit') cache.syndicateAudits = row.data || [];
        if (row.id === 'gladiator_dna') cache.gladiatorDna = row.data || [];
        if (row.id === 'live_positions') cache.livePositions = row.data || [];
        if (row.id === 'invalid_symbols') cache.invalidSymbols = row.data || [];
      }
      log.info('Supabase database initialized from cloud state');
    }

    dbInitialized = true;
  } catch (err) {
    log.error('Supabase init execution error', { error: String(err) });
    dbInitialized = true;
  }
}

// ─── Atomic Sync Queue (Ensures sequential Cloud writes) ───
let syncQueue = Promise.resolve();

function syncToCloud(id: string, data: unknown) {
  if (!supabaseUrl || !dbInitialized) return;

  syncQueue = syncQueue.then(async () => {
    try {
      const { error } = await supabase.from('json_store').upsert({ id, data });
      if (error) log.error(`Supabase sync failed for ${id}`, { error: error.message });
      
      // Artificial delay to prevent Supabase rate limits (100ms)
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      log.error(`Critical error in syncQueue for ${id}`, { error: String(err) });
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
  cache.syndicateAudits.unshift({ ...audit, id: `audit-${Date.now()}` });
  if (cache.syndicateAudits.length > 500) cache.syndicateAudits.length = 500;
  syncToCloud('syndicate_audit', cache.syndicateAudits);
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
export function addGladiatorDna(record: Record<string, unknown>): void {
  cache.gladiatorDna.unshift({ ...record, internalId: `dna-${Date.now()}-${Math.random()}` });
  if (cache.gladiatorDna.length > 2000) cache.gladiatorDna.length = 2000;
  syncToCloud('gladiator_dna', cache.gladiatorDna);
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

export function addLivePosition(pos: LivePosition): void {
  cache.livePositions.unshift(pos);
  syncToCloud('live_positions', cache.livePositions);
}

export function updateLivePosition(id: string, updates: Partial<LivePosition>): void {
  const idx = cache.livePositions.findIndex((p) => p.id === id);
  if (idx > -1) {
    cache.livePositions[idx] = { ...cache.livePositions[idx], ...updates };
    syncToCloud('live_positions', cache.livePositions);
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
}// ─── Equity Curve (for chart) ──────────────────────
export interface EquityPoint {
  timestamp: string;
  pnl: number;        
  balance: number;    
  outcome: string;
  signal: string;
  symbol: string;
}

export function getEquityCurve(): EquityPoint[] {
  const config = getBotConfig();
  const allDecs = getDecisions();
  const decisions = allDecs
    .filter((d) => d.outcome !== 'PENDING')
    .reverse(); // oldest first

  let cumPnl = 0;
  let balance = config.paperBalance;
  const positionSize = 20; // 20% of balance per trade (paper trading standard)

  return decisions.map((d) => {
    const pnlPct = d.pnlPercent || 0;
    cumPnl += pnlPct;
    const tradeImpact = balance * (positionSize / 100) * (pnlPct / 100);
    balance = Math.max(balance + tradeImpact, 0);

    return {
      timestamp: d.timestamp,
      pnl: Math.round(cumPnl * 100) / 100,
      balance: Math.round(balance * 100) / 100,
      outcome: d.outcome,
      signal: d.signal,
      symbol: d.symbol,
    };
  });
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
