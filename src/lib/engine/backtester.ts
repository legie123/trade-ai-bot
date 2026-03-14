// ============================================================
// Backtesting Engine — tests strategy on historical data
// Uses stored decisions to simulate performance
// ============================================================
import { getDecisions, getOptimizerState } from '@/lib/store/db';
import { DecisionSnapshot } from '@/lib/types/radar';

export interface BacktestConfig {
  startBalance: number;
  riskPerTrade: number;      // % of balance per trade
  stopLossPercent: number;
  takeProfitPercent: number;
  minConfidence: number;      // only include signals >= this confidence
  signalFilter?: string[];   // optional: only these signal types
}

export interface BacktestTrade {
  symbol: string;
  signal: string;
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
  pnlUsd: number;
  confidence: number;
  timestamp: string;
  outcome: string;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    neutral: number;
    winRate: number;
    totalPnlPercent: number;
    totalPnlUsd: number;
    finalBalance: number;
    maxDrawdownPercent: number;
    bestTrade: number;
    worstTrade: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    sharpeApprox: number;
  };
  equityCurve: { timestamp: string; balance: number; pnl: number }[];
}

const DEFAULT_CONFIG: BacktestConfig = {
  startBalance: 1000,
  riskPerTrade: 2,
  stopLossPercent: 1.5,
  takeProfitPercent: 3.0,
  minConfidence: 70,
};

// ─── Main backtest runner ──────────────────────────
export function runBacktest(config: Partial<BacktestConfig> = {}): BacktestResult {
  const cfg: BacktestConfig = { ...DEFAULT_CONFIG, ...config };
  const decisions = getDecisions()
    .filter((d) => d.outcome !== 'PENDING')
    .filter((d) => d.confidence >= cfg.minConfidence)
    .filter((d) => !cfg.signalFilter || cfg.signalFilter.includes(d.signal))
    .reverse(); // oldest first

  let balance = cfg.startBalance;
  let maxBalance = balance;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];
  const equity: BacktestResult['equityCurve'] = [
    { timestamp: new Date().toISOString(), balance, pnl: 0 },
  ];

  for (const d of decisions) {
    const positionSize = balance * (cfg.riskPerTrade / 100);
    const pnlPct = d.pnlPercent || 0;

    // Apply stop loss / take profit limits
    let effectivePnl = pnlPct;
    if (effectivePnl < -cfg.stopLossPercent) effectivePnl = -cfg.stopLossPercent;
    if (effectivePnl > cfg.takeProfitPercent) effectivePnl = cfg.takeProfitPercent;

    const pnlUsd = positionSize * (effectivePnl / 100);
    balance += pnlUsd;

    // Track drawdown
    if (balance > maxBalance) maxBalance = balance;
    const drawdown = ((maxBalance - balance) / maxBalance) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    trades.push({
      symbol: d.symbol,
      signal: d.signal,
      entryPrice: d.price,
      exitPrice: d.price * (1 + effectivePnl / 100),
      pnlPercent: Math.round(effectivePnl * 100) / 100,
      pnlUsd: Math.round(pnlUsd * 100) / 100,
      confidence: d.confidence,
      timestamp: d.timestamp,
      outcome: d.outcome,
    });

    equity.push({
      timestamp: d.timestamp,
      balance: Math.round(balance * 100) / 100,
      pnl: Math.round((balance - cfg.startBalance) / cfg.startBalance * 10000) / 100,
    });
  }

  // Calculate stats
  const wins = trades.filter((t) => t.outcome === 'WIN');
  const losses = trades.filter((t) => t.outcome === 'LOSS');
  const neutral = trades.filter((t) => t.outcome === 'NEUTRAL');
  const totalPnls = trades.map((t) => t.pnlPercent);
  const winPnls = wins.map((t) => t.pnlPercent);
  const lossPnls = losses.map((t) => t.pnlPercent);

  const avgWin = winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : 0;
  const avgLoss = lossPnls.length > 0 ? Math.abs(lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : wins.length > 0 ? Infinity : 0;

  // Sharpe approximation (annualized)
  const mean = totalPnls.length > 0 ? totalPnls.reduce((a, b) => a + b, 0) / totalPnls.length : 0;
  const variance = totalPnls.length > 1
    ? totalPnls.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / (totalPnls.length - 1)
    : 0;
  const std = Math.sqrt(variance);
  const sharpeApprox = std > 0 ? Math.round((mean / std) * Math.sqrt(252) * 100) / 100 : 0;

  return {
    config: cfg,
    trades,
    stats: {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      neutral: neutral.length,
      winRate: trades.length > 0 ? Math.round((wins.length / trades.length) * 100) : 0,
      totalPnlPercent: Math.round((balance - cfg.startBalance) / cfg.startBalance * 10000) / 100,
      totalPnlUsd: Math.round((balance - cfg.startBalance) * 100) / 100,
      finalBalance: Math.round(balance * 100) / 100,
      maxDrawdownPercent: Math.round(maxDrawdown * 100) / 100,
      bestTrade: totalPnls.length > 0 ? Math.max(...totalPnls) : 0,
      worstTrade: totalPnls.length > 0 ? Math.min(...totalPnls) : 0,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: profitFactor === Infinity ? 999 : Math.round(profitFactor * 100) / 100,
      sharpeApprox,
    },
    equityCurve: equity,
  };
}
