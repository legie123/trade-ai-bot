// ============================================================
// Risk Manager — Dynamic SL/TP, Kelly Criterion, Daily Limits
// Max Drawdown Circuit Breaker, Persistent Daily Loss
// + Kill Switch, Duplicate Protection, Stale Data Guard
// ============================================================
import { getDecisions } from '@/lib/store/db';
import { isKillSwitchEngaged, checkDailyLossLimit } from '@/lib/core/killSwitch';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('RiskManager');

export interface RiskParams {
  entryPrice: number;
  signal: string;         // BUY | SELL | LONG | SHORT
  confidence: number;     // 0-100
  symbol: string;
  accountBalance: number;
  decisionTimestamp?: string; // ISO timestamp of the signal
  apiLatencyMs?: number;     // last API response time
  kellyResult?: { suggestedRisk: number, halfKelly: number, winRate: number, payoffRatio: number, confident: boolean };
}

export interface RiskOutput {
  positionSize: number;
  positionSizePercent: number;
  stopLoss: number;
  stopLossPercent: number;
  takeProfit: number;
  takeProfitPercent: number;
  riskRewardRatio: number;
  kellyFraction: number;
  dailyLossUsed: number;
  dailyLossLimit: number;
  maxDrawdown: number;
  drawdownCurrent: number;
  canTrade: boolean;
  reason: string;
}

// ─── Persistent daily loss (survives hot reload via globalThis) ──
const gRisk = globalThis as unknown as {
  __dailyLossMap?: Record<string, number>;
  __peakBalance?: number;
};
if (!gRisk.__dailyLossMap) gRisk.__dailyLossMap = {};
if (!gRisk.__peakBalance) gRisk.__peakBalance = 1000;

function getDailyKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recordDailyLoss(lossPercent: number): void {
  const key = getDailyKey();
  gRisk.__dailyLossMap![key] = (gRisk.__dailyLossMap![key] || 0) + Math.abs(lossPercent);
}

export function resetDailyLoss(): void {
  gRisk.__dailyLossMap![getDailyKey()] = 0;
}

// ─── ATR Approximation from recent decisions ───────
function estimateATR(symbol: string): number {
  const decisions = getDecisions().filter((d) => d.symbol === symbol);
  if (decisions.length < 5) {
    // Fallback: 6% base ATR for new highly volatile DEX tokens, 2% for majors
    const isMajor = ['BTC', 'ETH', 'SOL'].includes(symbol);
    return isMajor ? 0.02 : 0.06;
  }

  const prices = decisions.slice(-20).map((d) => d.price);
  let sumRange = 0;
  for (let i = 1; i < prices.length; i++) {
    sumRange += Math.abs(prices[i] - prices[i - 1]) / prices[i - 1];
  }
  return sumRange / (prices.length - 1);
}

  // Kelly logic moved to kellySizer.ts

// ─── Calculate daily loss used (persistent) ────────
function getDailyLossUsed(): number {
  const persistedLoss = gRisk.__dailyLossMap![getDailyKey()] || 0;

  // Also check from decisions as backup
  const today = getDailyKey();
  const decisions = getDecisions().filter((d) => {
    return d.timestamp.startsWith(today) && d.outcome !== 'PENDING' && (d.pnlPercent || 0) < 0;
  });
  const decisionLoss = Math.abs(decisions.reduce((s, d) => s + (d.pnlPercent || 0), 0));

  return Math.max(persistedLoss, decisionLoss);
}

// ─── Max Drawdown Calculator ───────────────────────
function calculateDrawdown(currentBalance: number): { peak: number; drawdownPercent: number } {
  if (currentBalance > (gRisk.__peakBalance || 0)) {
    gRisk.__peakBalance = currentBalance;
  }
  const peak = gRisk.__peakBalance || currentBalance;
  const drawdownPercent = peak > 0 ? ((peak - currentBalance) / peak) * 100 : 0;
  return { peak, drawdownPercent };
}

// ─── Correlation Check (avoid overconcentration) ───
function getOpenSymbolCount(symbol: string): number {
  const ecosystem: Record<string, string[]> = {
    SOL: ['SOL', 'BONK', 'WIF', 'JUP', 'RAY', 'JTO', 'PYTH', 'RNDR'],
    BTC: ['BTC'],
    ETH: ['ETH'],
  };

  const family = Object.values(ecosystem).find((group) => group.includes(symbol));
  if (!family) return 0;

  const pending = getDecisions().filter((d) => d.outcome === 'PENDING' && family.includes(d.symbol));
  return pending.length;
}

// Win Stats computation moved to kellySizer.ts

// ─── Duplicate Trade Protection ────────────────────
function isDuplicateTrade(symbol: string, signal: string, cooldownMinutes: number): boolean {
  const direction = (signal === 'BUY' || signal === 'LONG') ? 'BULLISH' : 'BEARISH';
  const recent = getDecisions()
    .filter(d => {
      if (d.symbol !== symbol) return false;
      const dDirection = (d.signal === 'BUY' || d.signal === 'LONG') ? 'BULLISH' : 'BEARISH';
      if (dDirection !== direction) return false;
      const age = Date.now() - new Date(d.timestamp).getTime();
      return age < cooldownMinutes * 60_000;
    });
  return recent.length > 0;
}

// ─── Stale Data Guard ──────────────────────────────
// Calibration #6: widened from 10min to 45min — aligned with BTC cooldown (30min)
// Signals have cached timestamps from engine cycles, not real-time
function isStaleData(decisionTimestamp: string | undefined, maxAgeMs: number = 45 * 60_000): boolean {
  if (!decisionTimestamp) return false; // no timestamp = can't check, allow
  const age = Date.now() - new Date(decisionTimestamp).getTime();
  return age > maxAgeMs;
}

// ─── Helper: build rejection output ────────────────
function rejectOutput(
  entryPrice: number,
  dailyLossUsed: number,
  maxDailyLoss: number,
  maxDrawdownLimit: number,
  drawdownPercent: number,
  reason: string,
): RiskOutput {
  return {
    positionSize: 0, positionSizePercent: 0,
    stopLoss: entryPrice, stopLossPercent: 0,
    takeProfit: entryPrice, takeProfitPercent: 0,
    riskRewardRatio: 0, kellyFraction: 0,
    dailyLossUsed, dailyLossLimit: maxDailyLoss,
    maxDrawdown: maxDrawdownLimit,
    drawdownCurrent: Math.round(drawdownPercent * 100) / 100,
    canTrade: false,
    reason,
  };
}

// ─── Main Risk Calculator ──────────────────────────
export function calculateRisk(params: RiskParams): RiskOutput {
  const { entryPrice, signal, confidence, symbol, accountBalance, decisionTimestamp, apiLatencyMs } = params;

  const maxDailyLoss = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '15'); // Audit #21: was 5%, too strict for paper trading
  const maxDrawdownLimit = parseFloat(process.env.MAX_DRAWDOWN_PERCENT || '15');
  const baseRisk = parseFloat(process.env.RISK_PER_TRADE_PERCENT || '2');
  const maxCorrelatedPositions = parseInt(process.env.MAX_CORRELATED_POSITIONS || '4');
  const cooldownMinutes = parseInt(process.env.COOLDOWN_MINUTES || '30'); // Master Audit: was 5min, caused 3 RNDR losses in 22min
  const maxLatencyMs = parseInt(process.env.MAX_LATENCY_MS || '2000');

  const dailyLossUsed = getDailyLossUsed();
  const dailyLossRemaining = maxDailyLoss - dailyLossUsed;
  const { drawdownPercent } = calculateDrawdown(accountBalance);

  // ── Kill switch check (FIRST — overrides everything) ──
  if (isKillSwitchEngaged()) {
    log.warn('Trade blocked by kill switch', { symbol, signal });
    return rejectOutput(entryPrice, dailyLossUsed, maxDailyLoss, maxDrawdownLimit, drawdownPercent,
      '🛑 KILL SWITCH ENGAGED — all trading halted');
  }

  // ── Stale data guard ──
  if (isStaleData(decisionTimestamp)) {
    log.warn('Trade blocked — stale data', { symbol, signal, timestamp: decisionTimestamp });
    return rejectOutput(entryPrice, dailyLossUsed, maxDailyLoss, maxDrawdownLimit, drawdownPercent,
      '⏰ Data too stale (>10 min old) — rejecting for safety');
  }

  // ── Latency check ──
  if (apiLatencyMs !== undefined && apiLatencyMs > maxLatencyMs) {
    log.warn('Trade blocked — high latency', { symbol, latencyMs: apiLatencyMs, maxLatencyMs });
    return rejectOutput(entryPrice, dailyLossUsed, maxDailyLoss, maxDrawdownLimit, drawdownPercent,
      `⚡ API latency too high (${apiLatencyMs}ms > ${maxLatencyMs}ms max)`);
  }

  // ── Duplicate trade protection ──
  if (isDuplicateTrade(symbol, signal, cooldownMinutes)) {
    log.debug('Trade blocked — duplicate', { symbol, signal, cooldownMinutes });
    return rejectOutput(entryPrice, dailyLossUsed, maxDailyLoss, maxDrawdownLimit, drawdownPercent,
      `🔄 Duplicate trade: ${symbol} ${signal} already active within ${cooldownMinutes}min cooldown`);
  }

  // ── Circuit breaker: max drawdown ──
  if (drawdownPercent >= maxDrawdownLimit) {
    log.warn('Circuit breaker — max drawdown', { drawdownPercent, maxDrawdownLimit });
    return rejectOutput(entryPrice, dailyLossUsed, maxDailyLoss, maxDrawdownLimit, drawdownPercent,
      `🛑 CIRCUIT BREAKER: Drawdown ${drawdownPercent.toFixed(1)}% >= ${maxDrawdownLimit}% limit`);
  }

  // ── Daily loss limit ──
  if (dailyLossRemaining <= 0) {
    // Auto-engage kill switch on daily loss breach
    checkDailyLossLimit(dailyLossUsed, maxDailyLoss);
    return rejectOutput(entryPrice, dailyLossUsed, maxDailyLoss, maxDrawdownLimit, drawdownPercent,
      `Daily loss limit reached (${dailyLossUsed.toFixed(1)}% / ${maxDailyLoss}%)`);
  }

  // ── Correlation check ──
  const correlatedCount = getOpenSymbolCount(symbol);
  if (correlatedCount >= maxCorrelatedPositions) {
    return rejectOutput(entryPrice, dailyLossUsed, maxDailyLoss, maxDrawdownLimit, drawdownPercent,
      `Too many correlated positions (${correlatedCount}/${maxCorrelatedPositions} in same ecosystem)`);
  }

  // ATR-based SL/TP
  const atr = estimateATR(symbol);
  const isBullish = signal === 'BUY' || signal === 'LONG';
  const slMultiplier = 1.5;
  const tpMultiplier = 3.0;

  const slPercent = atr * slMultiplier * 100;
  const tpPercent = atr * tpMultiplier * 100;

  const stopLoss = isBullish
    ? entryPrice * (1 - slPercent / 100)
    : entryPrice * (1 + slPercent / 100);

  const takeProfit = isBullish
    ? entryPrice * (1 + tpPercent / 100)
    : entryPrice * (1 - tpPercent / 100);

  // Kelly-based position sizing from cache or default base
  const kellyPercent = params.kellyResult ? params.kellyResult.suggestedRisk : baseRisk;
  const kellyForLog = params.kellyResult ? params.kellyResult.halfKelly : (baseRisk / 100);

  // Confidence-adjusted risk
  const confidenceMultiplier = confidence >= 90 ? 1.5 : confidence >= 80 ? 1.2 : confidence >= 70 ? 1.0 : 0.5;

  // Scale down risk if drawdown is high
  const drawdownScale = drawdownPercent > 10 ? 0.5 : drawdownPercent > 5 ? 0.75 : 1.0;

  const riskPercent = Math.min(
    baseRisk * confidenceMultiplier * drawdownScale, // Adjusted classic risk
    kellyPercent > 0 ? kellyPercent : baseRisk,      // Scaled Kelly risk
    dailyLossRemaining
  );

  const positionSize = accountBalance * (riskPercent / 100);
  const rr = slPercent > 0 ? tpPercent / slPercent : 0;

  log.debug('Risk calculated', {
    symbol, signal, confidence,
    positionSize: Math.round(positionSize * 100) / 100,
    riskPercent: Math.round(riskPercent * 100) / 100,
    rr: Math.round(rr * 100) / 100,
  });

  return {
    positionSize: Math.round(positionSize * 100) / 100,
    positionSizePercent: Math.round(riskPercent * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    stopLossPercent: Math.round(slPercent * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
    takeProfitPercent: Math.round(tpPercent * 100) / 100,
    riskRewardRatio: Math.round(rr * 100) / 100,
    kellyFraction: Math.round(kellyForLog * 1000) / 1000,
    dailyLossUsed: Math.round(dailyLossUsed * 100) / 100,
    dailyLossLimit: maxDailyLoss,
    maxDrawdown: maxDrawdownLimit,
    drawdownCurrent: Math.round(drawdownPercent * 100) / 100,
    canTrade: true,
    reason: `Risk: ${riskPercent.toFixed(1)}% | RR: ${rr.toFixed(1)} | Kelly: ${(kellyForLog * 100).toFixed(1)}% | DD: ${drawdownPercent.toFixed(1)}%`,
  };
}
