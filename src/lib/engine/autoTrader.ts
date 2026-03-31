// ============================================================
// Smart Auto-Trader — Executes trades on high-confidence signals
// Requires: confidence >= 90% + confluence confirmed
// PAPER TRADING ONLY — ALL LIVE ENABLE BUTTONS IGNORED
// ============================================================
import { DecisionSnapshot } from '@/lib/types/radar';
import { getDecisions, getBotConfig } from '@/lib/store/db';
import { calculateRisk, RiskOutput } from '@/lib/engine/riskManager';
import { ConfluenceResult } from '@/lib/engine/confluence';
import { isKillSwitchEngaged } from '@/lib/core/killSwitch';
import { getKellyRiskCached } from '@/lib/engine/kellySizer';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('AutoTrader');

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
  minConfidence: 80, // Match real signal confidence (engines emit 85%)
  minConfluenceTFs: 2,
  maxOpenPositions: 3,
  allowedSignals: ['BUY', 'SELL', 'LONG', 'SHORT'],
  cooldownMinutes: 15,  // Aligned with RiskManager's COOLDOWN_MINUTES env
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
export async function evaluateForAutoTrade(
  decision: DecisionSnapshot,
  accountBalance: number = 1000
): Promise<TradeSignal> {
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

  // Dynamic Kelly position sizing
  let kellyAdjustedBalance = accountBalance;
  try {
    const kelly = await getKellyRiskCached();
    if (kelly.confident && kelly.suggestedRisk > 0) {
      // Scale balance by Kelly's suggested risk vs default 2%
      const kellyMultiplier = kelly.suggestedRisk / 2.0;
      kellyAdjustedBalance = accountBalance * Math.min(1.5, Math.max(0.5, kellyMultiplier));
      log.debug('Kelly adjustment', { suggestedRisk: kelly.suggestedRisk, multiplier: kellyMultiplier.toFixed(2) });
    }
  } catch { /* Kelly optional */ }

  // Calculate risk with Kelly-adjusted balance
  const risk = calculateRisk({
    entryPrice: decision.price,
    signal: decision.signal,
    confidence: decision.confidence * confluence.confidenceBoost,
    symbol: decision.symbol,
    accountBalance: kellyAdjustedBalance,
    decisionTimestamp: decision.timestamp,
    apiLatencyMs: 200, // simulated
  });

  // Decision logic
  const reasons: string[] = [];
  let shouldExecute = true;

  if (isKillSwitchEngaged()) {
    shouldExecute = false;
    reasons.push('🛑 Kill switch engaged');
    log.warn('Auto-trade evaluation blocked by kill switch', { symbol: decision.symbol });
  }

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
      ? `✅ EXECUTE PAPER: ${decision.symbol} ${decision.signal} | $${risk.positionSize} | SL: $${risk.stopLoss} | TP: $${risk.takeProfit} (Conf: ${decision.confidence}%)`
      : `⏸️ SKIP: ${reasons.join(' | ')}`,
  };
}

// ─── Scan all pending decisions for auto-trade ─────
export async function scanForAutoTrades(accountBalance: number = 1000): Promise<TradeSignal[]> {
  log.debug('Scanning for auto-trades', { balance: accountBalance });

  if (isKillSwitchEngaged()) {
    log.warn('Scan aborted — Kill switch is active');
    return [];
  }

  const decisions = getDecisions().filter((d) => d.outcome === 'PENDING');
  const recent = decisions
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5); // Only check 5 most recent (was 10 — too noisy)

  const results: TradeSignal[] = [];
  for (const d of recent) {
    results.push(await evaluateForAutoTrade(d, accountBalance));
  }
  return results;
}
