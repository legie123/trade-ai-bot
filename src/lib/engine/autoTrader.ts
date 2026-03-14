// ============================================================
// Smart Auto-Trader — Executes trades on high-confidence signals
// Requires: confidence >= threshold + confluence confirmed
// Uses Risk Manager for position sizing and SL/TP
// ============================================================
import { DecisionSnapshot } from '@/lib/types/radar';
import { getDecisions, getBotConfig } from '@/lib/store/db';
import { calculateRisk, RiskOutput } from '@/lib/engine/riskManager';
import { applyConfluenceToCoin, applyConfluenceToBTC, ConfluenceResult } from '@/lib/engine/confluence';

export interface TradeSignal {
  decision: DecisionSnapshot;
  risk: RiskOutput;
  confluence: ConfluenceResult;
  shouldExecute: boolean;
  reason: string;
}

export interface AutoTradeConfig {
  enabled: boolean;
  minConfidence: number;
  minConfluenceTFs: number;
  maxOpenPositions: number;
  allowedSignals: string[];
  cooldownMinutes: number;  // min time between trades on same symbol
}

const DEFAULT_CONFIG: AutoTradeConfig = {
  enabled: false,
  minConfidence: 85,
  minConfluenceTFs: 2,
  maxOpenPositions: 3,
  allowedSignals: ['BUY', 'SELL', 'LONG', 'SHORT'],
  cooldownMinutes: 30,
};

// ─── Get auto-trade config ─────────────────────────
export function getAutoTradeConfig(): AutoTradeConfig {
  const botConfig = getBotConfig();
  return {
    ...DEFAULT_CONFIG,
    enabled: process.env.AUTO_TRADE_ENABLED === 'true' || (botConfig as unknown as { autoTrade?: boolean }).autoTrade === true,
  };
}

// ─── Check if we recently traded this symbol ───────
function isInCooldown(symbol: string, cooldownMinutes: number): boolean {
  const recent = getDecisions()
    .filter((d) => d.symbol === symbol && d.outcome === 'PENDING')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (recent.length === 0) return false;
  const lastTime = new Date(recent[0].timestamp).getTime();
  return Date.now() - lastTime < cooldownMinutes * 60_000;
}

// ─── Evaluate a decision for auto-trading ──────────
export function evaluateForAutoTrade(
  decision: DecisionSnapshot,
  accountBalance: number = 1000
): TradeSignal {
  const config = getAutoTradeConfig();

  // Build confluence from decision data
  const confluence: ConfluenceResult = {
    symbol: decision.symbol,
    signals: [{ timeframe: '4h', signal: decision.signal, reason: '' }],
    confluenceScore: 0,
    dominantSignal: decision.signal,
    confirmedTFs: 1,
    totalTFs: 3,
    confidenceBoost: 1.0,
  };

  // Simulate multi-TF check from available data
  const tfSignals: { timeframe: string; signal: string; reason: string }[] = [
    { timeframe: '4h', signal: decision.signal, reason: 'Primary signal' },
  ];

  // EMA structure as HTF confirmation
  if (decision.ema50 && decision.ema200) {
    const isBullish = decision.signal === 'BUY' || decision.signal === 'LONG';
    const emaConfirms = isBullish ? decision.ema50 > decision.ema200 : decision.ema50 < decision.ema200;
    if (emaConfirms) {
      tfSignals.push({ timeframe: '1D', signal: decision.signal, reason: 'EMA structure confirms' });
      confluence.confirmedTFs = 2;
    }
  }

  // Price vs Daily Open as LTF
  if (decision.dailyOpen) {
    const isBullish = decision.signal === 'BUY' || decision.signal === 'LONG';
    const priceConfirms = isBullish ? decision.price > decision.dailyOpen : decision.price < decision.dailyOpen;
    if (priceConfirms) {
      tfSignals.push({ timeframe: '1h', signal: decision.signal, reason: 'Price vs Daily Open confirms' });
      confluence.confirmedTFs = Math.min(3, confluence.confirmedTFs + 1);
    }
  }

  confluence.signals = tfSignals;
  confluence.confluenceScore = Math.round((confluence.confirmedTFs / confluence.totalTFs) * 100);
  confluence.confidenceBoost = confluence.confirmedTFs >= 3 ? 2.0 : confluence.confirmedTFs >= 2 ? 1.5 : 1.0;

  // Calculate risk
  const risk = calculateRisk({
    entryPrice: decision.price,
    signal: decision.signal,
    confidence: decision.confidence * confluence.confidenceBoost,
    symbol: decision.symbol,
    accountBalance,
  });

  // Decision logic
  const reasons: string[] = [];
  let shouldExecute = true;

  if (!config.enabled) {
    shouldExecute = false;
    reasons.push('Auto-trade disabled');
  }

  if (decision.confidence < config.minConfidence) {
    shouldExecute = false;
    reasons.push(`Confidence ${decision.confidence}% < ${config.minConfidence}% min`);
  }

  if (confluence.confirmedTFs < config.minConfluenceTFs) {
    shouldExecute = false;
    reasons.push(`Only ${confluence.confirmedTFs}/${config.minConfluenceTFs} TFs confirmed`);
  }

  if (!config.allowedSignals.includes(decision.signal)) {
    shouldExecute = false;
    reasons.push(`Signal ${decision.signal} not in allowed list`);
  }

  if (!risk.canTrade) {
    shouldExecute = false;
    reasons.push(risk.reason);
  }

  if (isInCooldown(decision.symbol, config.cooldownMinutes)) {
    shouldExecute = false;
    reasons.push(`${decision.symbol} in cooldown (${config.cooldownMinutes}min)`);
  }

  return {
    decision,
    risk,
    confluence,
    shouldExecute,
    reason: shouldExecute
      ? `✅ EXECUTE: ${decision.symbol} ${decision.signal} | $${risk.positionSize} | SL: $${risk.stopLoss} | TP: $${risk.takeProfit}`
      : `⏸️ SKIP: ${reasons.join(' | ')}`,
  };
}

// ─── Scan all pending decisions for auto-trade ─────
export function scanForAutoTrades(accountBalance: number = 1000): TradeSignal[] {
  const decisions = getDecisions().filter((d) => d.outcome === 'PENDING');
  const recent = decisions
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  return recent.map((d) => evaluateForAutoTrade(d, accountBalance));
}
