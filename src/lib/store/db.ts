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

const log = createLogger('Database-Supabase');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Avoid crashing if credentials are not valid during build
const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder'
);

// ─── Singleton Memory Cache ─────────────────────
interface DbStore {
  decisions: DecisionSnapshot[];
  performance: PerformanceRecord[];
  optimizer: OptimizationState;
  config: BotConfig;
}

const cache: DbStore = {
  decisions: [],
  performance: [],
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
  }
};

let dbInitialized = false;

// ─── INIT DB (Called at boot or Cron start) ────
export async function initDB() {
  if (dbInitialized) return;
  if (!supabaseUrl) return;

  try {
    const { data, error } = await supabase.from('json_store').select('*');
    if (error) {
      log.error('Supabase init fetch error', { error: error.message });
      return;
    }
    if (data && data.length > 0) {
      for (const row of data) {
        if (row.id === 'decisions') cache.decisions = row.data || [];
        if (row.id === 'performance') cache.performance = row.data || [];
        if (row.id === 'optimizer') cache.optimizer = row.data || cache.optimizer;
        if (row.id === 'config') cache.config = row.data || cache.config;
      }
      log.info('Supabase database initialized from cloud state');
    }
    dbInitialized = true;
  } catch (err) {
    log.error('Supabase init execution error', { error: String(err) });
  }
}

// ─── Fire-and-Forget Sync ──────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function syncToCloud(id: string, data: any) {
  if (!supabaseUrl || !dbInitialized) return;
  supabase.from('json_store').upsert({ id, data }).then(({ error }) => {
    if (error) log.error(`Supabase sync failed for ${id}`, { error: error.message });
  });
}

// ─── Decision Snapshots ────────────────────────────
export function getDecisions(): DecisionSnapshot[] {
  return cache.decisions;
}

export function addDecision(snapshot: DecisionSnapshot): void {
  if (cache.decisions.some((d) => d.signalId === snapshot.signalId)) return;
  
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

export function getPendingDecisions(): DecisionSnapshot[] {
  return cache.decisions.filter((d) => d.outcome === 'PENDING');
}

export function getDecisionsToday(): DecisionSnapshot[] {
  const today = new Date().toISOString().split('T')[0];
  return cache.decisions.filter((d) => d.timestamp.startsWith(today));
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
}

export function getBotConfig(): BotConfig {
  return cache.config;
}

export function saveBotConfig(config: Partial<BotConfig>): void {
  cache.config = { ...cache.config, ...config };
  syncToCloud('config', cache.config);
}

// ─── Equity Curve (for chart) ──────────────────────
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
  const decisions = getDecisions()
    .filter((d) => d.outcome !== 'PENDING')
    .reverse();

  let cumPnl = 0;
  let balance = config.paperBalance;

  return decisions.map((d) => {
    const pnlPct = d.pnlPercent || 0;
    cumPnl += pnlPct;
    balance = balance * (1 + pnlPct / 100);

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
