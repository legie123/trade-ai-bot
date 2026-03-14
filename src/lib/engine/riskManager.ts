// ============================================================
// Risk Manager — Dynamic SL/TP, Kelly Criterion, Daily Limits
// Controls position sizing and risk per trade
// ============================================================
import { getDecisions } from '@/lib/store/db';

export interface RiskParams {
  entryPrice: number;
  signal: string;         // BUY | SELL | LONG | SHORT
  confidence: number;     // 0-100
  symbol: string;
  accountBalance: number;
}

export interface RiskOutput {
  positionSize: number;      // in USD
  positionSizePercent: number;
  stopLoss: number;          // price
  stopLossPercent: number;
  takeProfit: number;        // price
  takeProfitPercent: number;
  riskRewardRatio: number;
  kellyFraction: number;
  dailyLossUsed: number;     // how much of daily loss limit used
  dailyLossLimit: number;
  canTrade: boolean;         // false if daily limit hit
  reason: string;
}

// ─── ATR Approximation from recent decisions ───────
function estimateATR(symbol: string): number {
  const decisions = getDecisions().filter((d) => d.symbol === symbol);
  if (decisions.length < 5) return 0.02; // default 2%

  const prices = decisions.slice(-20).map((d) => d.price);
  let sumRange = 0;
  for (let i = 1; i < prices.length; i++) {
    sumRange += Math.abs(prices[i] - prices[i - 1]) / prices[i - 1];
  }
  return sumRange / (prices.length - 1);
}

// ─── Kelly Criterion ───────────────────────────────
function kellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0 || winRate === 0) return 0;
  const b = avgWin / avgLoss; // win/loss ratio
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  // Half-Kelly for safety
  return Math.max(0, Math.min(kelly * 0.5, 0.25)); // cap at 25%
}

// ─── Calculate daily loss used ─────────────────────
function getDailyLossUsed(): number {
  const today = new Date().toISOString().slice(0, 10);
  const decisions = getDecisions().filter((d) => {
    return d.timestamp.startsWith(today) && d.outcome !== 'PENDING' && (d.pnlPercent || 0) < 0;
  });
  return Math.abs(decisions.reduce((s, d) => s + (d.pnlPercent || 0), 0));
}

// ─── Get historical win rate ───────────────────────
function getWinStats(): { winRate: number; avgWin: number; avgLoss: number } {
  const evaluated = getDecisions().filter((d) => d.outcome === 'WIN' || d.outcome === 'LOSS');
  if (evaluated.length < 3) return { winRate: 0.5, avgWin: 1.5, avgLoss: 1.0 };

  const wins = evaluated.filter((d) => d.outcome === 'WIN');
  const losses = evaluated.filter((d) => d.outcome === 'LOSS');
  const winRate = wins.length / evaluated.length;
  const avgWin = wins.length > 0
    ? wins.reduce((s, d) => s + Math.abs(d.pnlPercent || 0), 0) / wins.length
    : 1.5;
  const avgLoss = losses.length > 0
    ? losses.reduce((s, d) => s + Math.abs(d.pnlPercent || 0), 0) / losses.length
    : 1.0;

  return { winRate, avgWin, avgLoss };
}

// ─── Main Risk Calculator ──────────────────────────
export function calculateRisk(params: RiskParams): RiskOutput {
  const { entryPrice, signal, confidence, symbol, accountBalance } = params;

  const maxDailyLoss = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '5');
  const baseRisk = parseFloat(process.env.RISK_PER_TRADE_PERCENT || '2');
  const dailyLossUsed = getDailyLossUsed();
  const dailyLossRemaining = maxDailyLoss - dailyLossUsed;

  // Can't trade if daily limit exceeded
  if (dailyLossRemaining <= 0) {
    return {
      positionSize: 0, positionSizePercent: 0,
      stopLoss: entryPrice, stopLossPercent: 0,
      takeProfit: entryPrice, takeProfitPercent: 0,
      riskRewardRatio: 0, kellyFraction: 0,
      dailyLossUsed, dailyLossLimit: maxDailyLoss,
      canTrade: false,
      reason: `Daily loss limit reached (${dailyLossUsed.toFixed(1)}% / ${maxDailyLoss}%)`,
    };
  }

  // ATR-based SL/TP
  const atr = estimateATR(symbol);
  const isBullish = signal === 'BUY' || signal === 'LONG';
  const slMultiplier = 1.5;  // 1.5× ATR for stop loss
  const tpMultiplier = 3.0;  // 3× ATR for take profit (2:1 RR)

  const slPercent = atr * slMultiplier * 100;
  const tpPercent = atr * tpMultiplier * 100;

  const stopLoss = isBullish
    ? entryPrice * (1 - slPercent / 100)
    : entryPrice * (1 + slPercent / 100);

  const takeProfit = isBullish
    ? entryPrice * (1 + tpPercent / 100)
    : entryPrice * (1 - tpPercent / 100);

  // Kelly-based position sizing
  const { winRate, avgWin, avgLoss } = getWinStats();
  const kelly = kellyFraction(winRate, avgWin, avgLoss);

  // Confidence-adjusted risk: higher confidence = more of base risk
  const confidenceMultiplier = confidence >= 90 ? 1.5 : confidence >= 80 ? 1.2 : confidence >= 70 ? 1.0 : 0.5;
  const riskPercent = Math.min(
    baseRisk * confidenceMultiplier,
    kelly > 0 ? kelly * 100 : baseRisk,
    dailyLossRemaining
  );

  const positionSize = accountBalance * (riskPercent / 100);
  const rr = slPercent > 0 ? tpPercent / slPercent : 0;

  return {
    positionSize: Math.round(positionSize * 100) / 100,
    positionSizePercent: Math.round(riskPercent * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    stopLossPercent: Math.round(slPercent * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
    takeProfitPercent: Math.round(tpPercent * 100) / 100,
    riskRewardRatio: Math.round(rr * 100) / 100,
    kellyFraction: Math.round(kelly * 1000) / 1000,
    dailyLossUsed: Math.round(dailyLossUsed * 100) / 100,
    dailyLossLimit: maxDailyLoss,
    canTrade: true,
    reason: `Risk: ${riskPercent.toFixed(1)}% | RR: ${rr.toFixed(1)} | Kelly: ${(kelly * 100).toFixed(1)}%`,
  };
}
