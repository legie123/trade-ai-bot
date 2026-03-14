// ============================================================
// Persistent JSON Database — survives restarts
// Stores decision snapshots, performance, and optimizer state
// ============================================================
import * as fs from 'fs';
import * as path from 'path';
import {
  DecisionSnapshot,
  PerformanceRecord,
  OptimizationState,
  BotMode,
} from '@/lib/types/radar';

const DATA_DIR = path.join(process.cwd(), 'data');
const DECISIONS_FILE = path.join(DATA_DIR, 'decisions.json');
const PERFORMANCE_FILE = path.join(DATA_DIR, 'performance.json');
const OPTIMIZER_FILE = path.join(DATA_DIR, 'optimizer.json');
const CONFIG_FILE = path.join(DATA_DIR, 'bot-config.json');

// ─── Ensure data directory exists ──────────────────
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── Generic read/write ────────────────────────────
function readJSON<T>(filePath: string, fallback: T): T {
  ensureDataDir();
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(filePath: string, data: T): void {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Decision Snapshots ────────────────────────────
export function getDecisions(): DecisionSnapshot[] {
  return readJSON<DecisionSnapshot[]>(DECISIONS_FILE, []);
}

export function addDecision(snapshot: DecisionSnapshot): void {
  const all = getDecisions();
  // Dedup by signalId
  if (all.some((d) => d.signalId === snapshot.signalId)) return;
  all.unshift(snapshot);
  // Keep last 1000
  writeJSON(DECISIONS_FILE, all.slice(0, 1000));
  console.log(`[DB] Decision saved: ${snapshot.signal} ${snapshot.symbol} @ $${snapshot.price}`);
}

export function updateDecision(id: string, updates: Partial<DecisionSnapshot>): void {
  const all = getDecisions();
  const idx = all.findIndex((d) => d.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...updates };
  writeJSON(DECISIONS_FILE, all);
}

export function getPendingDecisions(): DecisionSnapshot[] {
  return getDecisions().filter((d) => d.outcome === 'PENDING');
}

export function getDecisionsToday(): DecisionSnapshot[] {
  const today = new Date().toISOString().split('T')[0];
  return getDecisions().filter((d) => d.timestamp.startsWith(today));
}

// ─── Performance Records ───────────────────────────
export function getPerformance(): PerformanceRecord[] {
  return readJSON<PerformanceRecord[]>(PERFORMANCE_FILE, []);
}

export function savePerformance(records: PerformanceRecord[]): void {
  writeJSON(PERFORMANCE_FILE, records);
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
  return readJSON<OptimizationState>(OPTIMIZER_FILE, {
    version: 0,
    weights: {
      volumeWeight: 0.25,
      liquidityWeight: 0.20,
      momentumWeight: 0.20,
      holderWeight: 0.15,
      socialWeight: 0.10,
      emaWeight: 0.10,
    },
    lastOptimizedAt: new Date().toISOString(),
    improvementPercent: 0,
    history: [],
  });
}

export function saveOptimizerState(state: OptimizationState): void {
  writeJSON(OPTIMIZER_FILE, state);
}

// ─── Bot Config ────────────────────────────────────
interface BotConfig {
  mode: BotMode;
  autoOptimize: boolean;
  paperBalance: number;
  riskPerTrade: number;
  maxOpenPositions: number;
  evaluationIntervals: number[];  // minutes after signal to check price
}

export function getBotConfig(): BotConfig {
  return readJSON<BotConfig>(CONFIG_FILE, {
    mode: 'PAPER',
    autoOptimize: false,
    paperBalance: 1000,
    riskPerTrade: 1.5,
    maxOpenPositions: 3,
    evaluationIntervals: [5, 15, 60, 240],
  });
}

export function saveBotConfig(config: Partial<BotConfig>): void {
  const current = getBotConfig();
  writeJSON(CONFIG_FILE, { ...current, ...config });
}

// ─── Equity Curve (for chart) ──────────────────────
export interface EquityPoint {
  timestamp: string;
  pnl: number;        // cumulative PnL %
  balance: number;    // paper balance
  outcome: string;
  signal: string;
  symbol: string;
}

export function getEquityCurve(): EquityPoint[] {
  const config = getBotConfig();
  const decisions = getDecisions()
    .filter((d) => d.outcome !== 'PENDING')
    .reverse(); // oldest first

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
