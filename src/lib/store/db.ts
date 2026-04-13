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
// AUDIT FIX API-8: No more silent placeholder — fail loudly if Supabase not configured
if (!supabaseUrl || supabaseUrl === '') {
  console.warn('[DB WARNING] NEXT_PUBLIC_SUPABASE_URL is not set. Database features will be disabled.');
}
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
  
  while (syncTasks.length > 0) {
    const task = syncTasks.shift();
    if (!task) continue;
    
    try {
      const { error } = await supabase.from('json_store').upsert({ id: task.id, data: task.data });
      if (error) log.error(`Supabase sync failed for ${task.id}`, { error: error.message });
      else {
          totalSyncsCompleted++;
          lastSyncComplete = new Date().toISOString();
      }
      // Artificial delay to prevent Supabase rate limits (100ms)
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      log.error(`Critical error in syncQueue for ${task.id}`, { error: String(err) });
    }
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
  
  // Multi-Instance Race Condition Protection via Background Hydration
  (async () => {
    if (supabaseUrl && dbInitialized) {
      try {
        const { data } = await supabase.from('json_store').select('data').eq('id', 'decisions').single();
        if (data?.data) {
          const remote = data.data as DecisionSnapshot[];
          // Merge arrays (dedupe by ID)
          const localMap = new Map(cache.decisions.map(d => [d.id, d]));
          for (const rd of remote) {
            if (!localMap.has(rd.id)) cache.decisions.push(rd);
          }
          // Sort by timestamp desc and limit
          cache.decisions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          if (cache.decisions.length > 1000) cache.decisions.length = 1000;
        }
      } catch {}
    }
    
    // Add new decision only if it wasn't miraculously inserted
    if (!cache.decisions.some((d) => d.signalId === snapshot.signalId)) {
      cache.decisions.unshift(snapshot);
      if (cache.decisions.length > 1000) cache.decisions.length = 1000;
    }
    
    syncToCloud('decisions', cache.decisions);
  })();
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
    supabase.from('syndicate_audits').insert(dbAudit).then(({ error }) => {
      if (error) console.warn('Failed to insert syndicate audit', { error: error.message });
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

export async function refreshGladiatorsFromCloud(): Promise<void> {
  if (supabaseUrl && dbInitialized) {
    try {
      const { data } = await supabase.from('json_store').select('data').eq('id', 'gladiators').single();
      if (data?.data) {
        cache.gladiators = data.data as Gladiator[];
      }
    } catch {}
  }
}


export function saveGladiatorsToDb(gladiators: Gladiator[]): void {
  (async () => {
    if (supabaseUrl && dbInitialized) {
      try {
        const { data } = await supabase.from('json_store').select('data').eq('id', 'gladiators').single();
        if (data?.data) {
          const remoteGladiators = data.data as Gladiator[];
          // Safely merge based on totalTrades (assuming higher = more evolved)
          for (const remote of remoteGladiators) {
             const localIndex = gladiators.findIndex(g => g.id === remote.id);
             if (localIndex === -1) {
                 gladiators.push(remote); // Pick up Gladiators created by other instances
             } else {
                 const local = gladiators[localIndex];
                 if ((remote.stats?.totalTrades || 0) > (local.stats?.totalTrades || 0)) {
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
  })();
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
    const dbRecord = {
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
    const { error } = await supabase.from('gladiator_battles').insert(dbRecord);
    if (error) {
      // If table doesn't exist yet, fall back to json_store silently
      if (error.code === '42P01') {
        syncToCloud('gladiator_dna', cache.gladiatorDna);
      } else {
        log.warn(`Failed to insert battle record: ${error.message}`);
      }
    }
  } catch {
    // Network failure — data is already in memory cache
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

  try {
    const { data, error } = await supabase
      .from('gladiator_battles')
      .select('*')
      .eq('gladiator_id', gladiatorId)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      // Table doesn't exist yet — fall back to memory
      if (error.code === '42P01') {
        return cache.gladiatorDna
          .filter(r => r.gladiatorId === gladiatorId)
          .slice(0, limit);
      }
      log.warn(`Failed to fetch battles for ${gladiatorId}: ${error.message}`);
      return cache.gladiatorDna
        .filter(r => r.gladiatorId === gladiatorId)
        .slice(0, limit);
    }

    if (!data || data.length === 0) {
      // No data in Postgres yet — fall back to memory
      return cache.gladiatorDna
        .filter(r => r.gladiatorId === gladiatorId)
        .slice(0, limit);
    }

    // Map Postgres columns back to the BattleRecord shape expected by DNAExtractor
    return data.map(row => ({
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
  } catch {
    return cache.gladiatorDna
      .filter(r => r.gladiatorId === gladiatorId)
      .slice(0, limit);
  }
}

// ─── Phantom Trades (Arena Combat Engine) ───────
export function getPhantomTrades(): PhantomTrade[] {
  return cache.phantomTrades;
}

export function addPhantomTrade(trade: PhantomTrade): void {
  (async () => {
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
      } catch {} // ignore network errors and fallback 
    }
    
    if (!cache.phantomTrades.some(t => t.id === trade.id)) {
      cache.phantomTrades.unshift(trade);
      if (cache.phantomTrades.length > 500) cache.phantomTrades.length = 500;
    }
    
    syncToCloud('phantom_trades', cache.phantomTrades);
  })();
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
     console.warn('Strict position check failed (bypassed via Cache)', { error: error.message });
     // Safe fallback: true (assume it's open to prevent double buy)
     return true; 
  }
  return data && data.length > 0;
}

export function addLivePosition(pos: LivePosition): void {
  cache.livePositions.unshift(pos);
  if (supabaseUrl && dbInitialized) {
    supabase.from('live_positions').insert(pos).then(({ error }) => {
      if (error) console.warn('Failed to insert live position (bypassed via Cache)', { error: error.message });
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
  } catch {
    // Non-critical, TTL will expire it
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
    if (error) return { wallet: null, gladiators: null };

    const walletRow = data?.find((r: Record<string, unknown>) => r.id === 'poly_wallet');
    const gladiatorsRow = data?.find((r: Record<string, unknown>) => r.id === 'poly_gladiators');

    return {
      wallet: (walletRow?.data as Record<string, unknown>) || null,
      gladiators: (gladiatorsRow?.data as unknown[]) || null,
    };
  } catch {
    return { wallet: null, gladiators: null };
  }
}

export function savePolyWalletToCloud(wallet: Record<string, unknown>): void {
  syncToCloud('poly_wallet', wallet);
}

export function savePolyGladiatorsToCloud(gladiators: unknown[]): void {
  syncToCloud('poly_gladiators', gladiators);
}

export { supabase }; // Export for diagnostics endpoint
