// ============================================================
// Crypto Radar — Core Types
// ============================================================

/** Watchlist item displayed in the main table */
export interface WatchlistItem {
  symbol: string;
  name: string;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  status: TokenStatus;
  chain: string;
  exchange: string;
  lastUpdated: string;
}

export type TokenStatus = 'bullish' | 'neutral' | 'bearish';

/** Signal received from TradingView webhook or internal */
export interface Signal {
  id: string;
  symbol: string;
  timeframe: string;
  signal: SignalType;
  price: number;
  timestamp: string;
  source: string;
  message?: string;
}

export type SignalType = 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'ALERT' | 'NEUTRAL';

/** Trade log entry (mock for now, bot-ready schema) */
export interface TradeEntry {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  pnl: number | null;
  pnlPercent: number | null;
  status: 'OPEN' | 'CLOSED' | 'STOPPED' | 'TP_HIT';
  openedAt: string;
  closedAt: string | null;
}

/** TradingView webhook payload */
export interface TradingViewWebhook {
  symbol: string;
  timeframe?: string;
  signal?: string;
  price?: number;
  message?: string;
  timestamp?: string;
}

/** Bot rule schema (infrastructure only — not active) */
export interface BotRuleSet {
  entryRules: {
    signalTypes: SignalType[];
    minConfirmations: number;
    requiredTimeframes: string[];
  };
  exitRules: {
    signalTypes: SignalType[];
    trailingStop: boolean;
    trailingStopPercent: number;
  };
  riskManagement: {
    stopLossPercent: number;
    takeProfitPercent: number;
    maxPositionSizePercent: number;
    maxOpenPositions: number;
    riskRewardRatio: number;
  };
}

/** Dashboard stats shown in top cards */
export interface DashboardStats {
  totalSignalsToday: number;
  activeAlerts: number;
  strongestMover: { symbol: string; change: number } | null;
  lastWebhookAt: string | null;
}

/** Filter state for dashboard */
export interface RadarFilters {
  search: string;
  exchange: string;
  chain: string;
  minVolume: string;
  minMarketCap: string;
  minChange: string;
}

// ============================================================
// Bot Evolution — Types
// ============================================================

export type BotMode = 'OBSERVATION' | 'PAPER' | 'LIVE';

/** A snapshot of the market state at the time a signal fired */
export interface DecisionSnapshot {
  id: string;
  signalId: string;
  symbol: string;
  signal: SignalType;
  direction: string;
  action: string;
  confidence: number;
  price: number;
  timestamp: string;
  source: string;
  // Market context when signal fired
  ema50: number;
  ema200: number;
  ema800: number;
  psychHigh: number;
  psychLow: number;
  dailyOpen: number;
  // Outcome tracking
  priceAfter5m: number | null;
  priceAfter15m: number | null;
  priceAfter1h: number | null;
  priceAfter4h: number | null;
  outcome: 'WIN' | 'LOSS' | 'NEUTRAL' | 'PENDING';
  pnlPercent: number | null;
  evaluatedAt: string | null;
}

/** Performance record aggregated by signal type / source */
export interface PerformanceRecord {
  signalType: string;
  source: string;
  totalTrades: number;
  wins: number;
  losses: number;
  neutral: number;
  winRate: number;
  avgPnlPercent: number;
  bestTrade: number;
  worstTrade: number;
  lastUpdated: string;
}

/** Optimizer state — what weights the bot has learned */
export interface OptimizationState {
  version: number;
  weights: Record<string, number>;
  lastOptimizedAt: string;
  improvementPercent: number;
  history: {
    date: string;
    weightChanges: Record<string, { from: number; to: number }>;
    winRateBefore: number;
    winRateAfter: number;
  }[];
}

/** Bot dashboard stats */
export interface BotStats {
  mode: BotMode;
  totalDecisions: number;
  todayDecisions: number;
  overallWinRate: number;
  todayWinRate: number;
  totalPnlPercent: number;
  todayPnlPercent: number;
  maxDrawdown: number;
  currentStreak: number;
  streakType: 'WIN' | 'LOSS' | 'NONE';
  strategyHealth: 'EXCELLENT' | 'GOOD' | 'CAUTION' | 'CRITICAL';
  optimizerVersion: number;
  lastOptimized: string | null;
}
