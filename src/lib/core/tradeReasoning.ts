// ============================================================
// Trade Reasoning — Generates detailed breakdown logs of why 
// a trade was accepted or rejected. Used for transparency.
// ============================================================
import { DecisionSnapshot } from '@/lib/types/radar';
import { calculateRisk, RiskOutput } from '@/lib/engine/riskManager';
import { scoreSignal, MLScore } from '@/lib/engine/mlFilter';
import { calculateCompositeScore, CompositeResult } from '@/lib/engine/compositeScore';
import { aggregateConfidence, ConfidenceResult } from '@/lib/core/confidenceAggregator';
import type { KellyResult } from '@/lib/engine/kellySizer';

export interface TradeReasoningReport {
  symbol: string;
  signal: string;
  timestamp: string;
  action: 'ACCEPT' | 'REJECT';
  rejectionReason?: string;
  confidence: ConfidenceResult;
  risk: RiskOutput;
  ml: MLScore;
  composite: CompositeResult;
  strategyUsed: string;
  sources: string[];
}

// ─── Identify the primary strategy used ────────────────
function identifyStrategy(decision: DecisionSnapshot): string {
  const { ema50, ema200, dailyOpen, price, signal } = decision;

  if (ema50 && ema200) {
    if (signal === 'LONG' && ema50 > ema200) return 'Bullish EMA Cross Confirmation';
    if (signal === 'SHORT' && ema50 < ema200) return 'Bearish EMA Cross Confirmation';
    if (signal === 'BUY' && price > ema200) return 'Trend Continuation Breakout';
  }

  if (dailyOpen && price) {
    if (signal === 'BUY' && price > dailyOpen) return 'Daily Open Reclaim';
    if (signal === 'SELL' && price < dailyOpen) return 'Daily Open Rejection';
  }

  return 'Momentum & Trend Following'; // Fallback
}

export function generateTradeReasoning(
  decision: DecisionSnapshot,
  allPending: DecisionSnapshot[],
  accountBalance: number,
  isAccepted: boolean,
  rejectionReason?: string,
  kellyResult?: KellyResult
): TradeReasoningReport {

  const confidence = aggregateConfidence(allPending, decision.symbol);
  
  // Use confidence aggregator's score.
  // We don't overwrite decision.confidence in DB directly here, just use it for risk check.
  const risk = calculateRisk({
    entryPrice: decision.price,
    signal: decision.signal,
    confidence: confidence.finalConfidence, // Use the new 0-100 aggregated confidence
    symbol: decision.symbol,
    accountBalance,
    decisionTimestamp: decision.timestamp,
    apiLatencyMs: 0, // Not evaluating network here
    kellyResult,
  });

  const ml = scoreSignal(decision);
  const composite = calculateCompositeScore(decision);

  const sources = Array.from(
    new Set(allPending.filter(d => d.symbol === decision.symbol).map(d => d.source))
  );

  return {
    symbol: decision.symbol,
    signal: decision.signal,
    timestamp: decision.timestamp,
    action: isAccepted ? 'ACCEPT' : 'REJECT',
    rejectionReason: !isAccepted ? rejectionReason || 'Failed unspecified gate' : undefined,
    confidence,
    risk,
    ml,
    composite,
    strategyUsed: identifyStrategy(decision),
    sources,
  };
}

// ─── Human readable format ──────────────────────────────
export function formatReasoningText(report: TradeReasoningReport): string {
  const { symbol, signal, action, rejectionReason, risk, confidence, ml, composite, strategyUsed } = report;

  const lines = [
    `Trade Evaluation: ${symbol} ${signal} [${action}]`,
    `Strategy: ${strategyUsed}`,
    `----------------------------------------`,
    `Confidence Score: ${confidence.finalConfidence}% (Grade: ${confidence.grade})`,
    `  - Base: ${confidence.baseConfidence}%`,
    `  - Confluence Boost: +${confidence.confluenceBoost}%`,
    `  - ML Bonus: ${confidence.mlBonus >= 0 ? '+' : ''}${confidence.mlBonus}%`,
    `  - Sources: ${report.sources.join(', ')}`,
    `----------------------------------------`,
    `ML & Composite:`,
    `  - ML Verdict: ${ml.verdict} (${ml.score}%)`,
    `  - Regime: ${composite.factors.marketRegime.toFixed(2)}`,
    `  - Liquidity: ${composite.factors.liquidity.toFixed(2)}`,
    `----------------------------------------`,
    `Risk Management:`,
    `  - Position Risk: ${risk.positionSizePercent}%`,
    `  - R:R Ratio: ${risk.riskRewardRatio}`,
    `  - SL: ${risk.stopLoss} | TP: ${risk.takeProfit}`,
    `  - Kelly: ${risk.kellyFraction}`,
    `  - DD: ${risk.drawdownCurrent}%`,
    `----------------------------------------`,
  ];

  if (action === 'REJECT' && rejectionReason) {
    lines.push(`❌ REJECTED: ${rejectionReason}`);
  } else {
    lines.push(`✅ ACCEPTED FOR PAPER FILL`);
  }

  return lines.join('\n');
}
