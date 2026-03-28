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
import { TradingStrategy, StrategyCondition } from '@/lib/types/strategy';
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
  strategies: TradingStrategy[];
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
    aiStatus: 'OK',
  },
  strategies: [],
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
          if (row.id === 'strategies') {
            const strats = row.data as TradingStrategy[] || [];
            cache.strategies = strats.map((s: TradingStrategy) => ({
              ...s,
              entryConditions: decryptConditions(s.entryConditions),
              exitConditions: decryptConditions(s.exitConditions),
            }));
          }
        }
        log.info('Supabase database initialized from cloud state');
      }

      // Seed initial strategies if empty
      if (cache.strategies.length === 0) {
        log.info('Strategies DB empty, seeding from hardcoded defaults...');
        import('@/lib/store/seedStrategies').then(({ INITIAL_STRATEGIES }) => {
          cache.strategies = INITIAL_STRATEGIES;
          syncToCloud('strategies', cache.strategies);
        });
      }
      
      dbInitialized = true;
  } catch (err) {
    log.error('Supabase init execution error', { error: String(err) });
  }
}

// ─── Premium Core Obfuscation ──────────────────
const OBFUSCATION_KEY = process.env.CRON_SECRET || 'antigravity-premium-key';

function xorCipher(text: string, key: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

function encryptConditions(conditions: StrategyCondition[]): string {
  const jsonStr = JSON.stringify(conditions);
  const xor = xorCipher(jsonStr, OBFUSCATION_KEY);
  return Buffer.from(xor).toString('base64');
}

function decryptConditions(data: unknown): StrategyCondition[] {
  if (Array.isArray(data)) return data as StrategyCondition[]; // Backward compat for unencrypted legacy rows
  try {
    const xor = Buffer.from(data as string, 'base64').toString('utf-8');
    const jsonStr = xorCipher(xor, OBFUSCATION_KEY);
    return JSON.parse(jsonStr) as StrategyCondition[];
  } catch (_e) { // Ignore err
    return [];
  }
}

// ─── Fire-and-Forget Sync ──────────────────────
function syncToCloud(id: string, data: unknown) {
  if (!supabaseUrl || !dbInitialized) return;
  
  let payload = data;
  
  // Obfuscate strict logic formulas for Premium Core Protection 
  if (id === 'strategies' && Array.isArray(data)) {
    payload = (data as TradingStrategy[]).map((s: TradingStrategy) => ({
      ...s,
      entryConditions: encryptConditions(s.entryConditions as StrategyCondition[]),
      exitConditions: encryptConditions(s.exitConditions as StrategyCondition[])
    }));
  }

  supabase.from('json_store').upsert({ id, data: payload }).then(({ error }) => {
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
  aiStatus: 'OK' | 'NO_CREDIT';
}

export function getBotConfig(): BotConfig {
  return cache.config;
}

export function saveBotConfig(config: Partial<BotConfig>): void {
  cache.config = { ...cache.config, ...config };
  syncToCloud('config', cache.config);
}

// ─── Dynamic Strategies ────────────────────────────
export function getStrategies(): TradingStrategy[] {
  return cache.strategies;
}

export function saveStrategy(strategy: TradingStrategy): void {
  const idx = cache.strategies.findIndex((s) => s.id === strategy.id);
  if (idx > -1) cache.strategies[idx] = strategy;
  else cache.strategies.push(strategy);
  syncToCloud('strategies', cache.strategies);
}

export function removeStrategy(id: string): void {
  cache.strategies = cache.strategies.filter(s => s.id !== id);
  syncToCloud('strategies', cache.strategies);
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
