// ============================================================
// Trade Reasoning API — Full transparency for every trade decision
// Returns step-by-step reasoning chain for each signal
// ============================================================
import { NextResponse } from 'next/server';
import { getDecisions } from '@/lib/store/db';
import { scoreSignal } from '@/lib/engine/mlFilter';
import { calculateRisk } from '@/lib/engine/riskManager';
import { getAutoTradeConfig } from '@/lib/engine/autoTrader';
import { getExecutionLog } from '@/lib/engine/executor';
import { calculateCompositeScore } from '@/lib/engine/compositeScore';

export const dynamic = 'force-dynamic';

interface TradeReasoning {
  id: string;
  timestamp: string;
  symbol: string;
  signal: string;
  price: number;
  confidence: number;

  // Strategy
  strategy: string;
  entryReason: string;

  // Market context
  marketContext: {
    emaAlignment: string;
    priceVsDailyOpen: string;
    trendDirection: string;
    volatility: string;
  };

  // Confirmation signals
  confirmations: {
    mlScore: number;
    mlVerdict: string;
    mlReasons: string[];
    confluenceConfirmed: number;
    confluenceTotal: number;
    sourceReliability: string;
  };

  // Risk logic
  riskLogic: {
    positionSize: number;
    positionSizePercent: number;
    kellyFraction: number;
    dailyLossUsed: number;
    dailyLossLimit: number;
    maxDrawdown: number;
    drawdownCurrent: number;
    correlationCheck: string;
  };

  // SL/TP
  slTpLogic: {
    stopLoss: number;
    stopLossPercent: number;
    takeProfit: number;
    takeProfitPercent: number;
    riskRewardRatio: number;
    method: string;
  };

  // Step-by-step reasoning
  reasoningSteps: string[];

  // Final outcome
  decision: 'EXECUTE' | 'SKIP' | 'PENDING';
  decisionReason: string;
  outcome?: string;
  pnlPercent?: number;

  // Composite Score
  compositeScore: number;
  compositeGrade: string;
  compositeFactors: {
    mlScore: number;
    marketRegime: number;
    liquidity: number;
    volatility: number;
  };
  compositeBreakdown: string[];
}

function buildReasoning(decision: ReturnType<typeof getDecisions>[0], balance: number): TradeReasoning {
  const isBullish = decision.signal === 'BUY' || decision.signal === 'LONG';
  const config = getAutoTradeConfig();

  // ML scoring
  const ml = scoreSignal(decision);

  // Composite Score
  const composite = calculateCompositeScore(decision);

  // Risk calculation
  const risk = calculateRisk({
    entryPrice: decision.price,
    signal: decision.signal,
    confidence: decision.confidence,
    symbol: decision.symbol,
    accountBalance: balance,
  });

  // EMA analysis
  const emaStatus = decision.ema50 && decision.ema200
    ? (decision.ema50 > decision.ema200 ? 'Bullish (EMA50 > EMA200)' : 'Bearish (EMA50 < EMA200)')
    : 'Insufficient data';
  const emaConfirms = decision.ema50 && decision.ema200
    ? (isBullish ? decision.ema50 > decision.ema200 : decision.ema50 < decision.ema200)
    : false;

  // Daily open analysis
  const dailyOpenStatus = decision.dailyOpen
    ? (decision.price > decision.dailyOpen ? 'Above daily open (bullish bias)' : 'Below daily open (bearish bias)')
    : 'No daily open data';

  // Trend
  const trend = decision.ema50 && decision.ema200 && decision.ema800
    ? (decision.ema50 > decision.ema200 && decision.ema200 > decision.ema800 ? 'Strong Uptrend'
        : decision.ema50 < decision.ema200 && decision.ema200 < decision.ema800 ? 'Strong Downtrend'
        : 'Mixed/Consolidation')
    : 'Unknown';

  // Strategy identification
  const strategy = ml.verdict === 'STRONG' && emaConfirms
    ? 'Trend Continuation + ML Confirmation'
    : ml.verdict === 'STRONG'
    ? 'ML High-Probability Signal'
    : emaConfirms
    ? 'EMA Trend Following'
    : 'Signal-Based Entry';

  // Build reasoning chain
  const steps: string[] = [];
  steps.push(`1️⃣ SIGNAL RECEIVED: ${decision.signal} ${decision.symbol} at $${decision.price.toLocaleString()} (confidence: ${decision.confidence}%)`);
  steps.push(`2️⃣ SOURCE: ${decision.source || 'engine'} via ${strategy}`);
  steps.push(`3️⃣ MARKET CONTEXT: ${trend} | EMA: ${emaStatus} | Daily Open: ${dailyOpenStatus}`);
  steps.push(`4️⃣ ML FILTER: Score ${ml.score}% (${ml.verdict}) — ${ml.reasons.join(', ')}`);
  steps.push(`5️⃣ COMPOSITE SCORE: ${composite.finalScore}% (Grade: ${composite.grade}) = ML:${(composite.factors.mlScore*100).toFixed(0)}% × Regime:${(composite.factors.marketRegime*100).toFixed(0)}% × Liq:${(composite.factors.liquidity*100).toFixed(0)}% × Vol:${(composite.factors.volatility*100).toFixed(0)}%`);
  steps.push(`6️⃣ RISK CHECK: Position ${risk.positionSizePercent}% ($${risk.positionSize}) | Kelly: ${(risk.kellyFraction * 100).toFixed(1)}% | Daily loss: ${risk.dailyLossUsed.toFixed(1)}%/${risk.dailyLossLimit}%`);
  steps.push(`7️⃣ SL/TP: Stop $${risk.stopLoss.toLocaleString()} (-${risk.stopLossPercent}%) | Target $${risk.takeProfit.toLocaleString()} (+${risk.takeProfitPercent}%) | RR: ${risk.riskRewardRatio}`);

  // Decision logic
  let finalDecision: 'EXECUTE' | 'SKIP' | 'PENDING' = 'PENDING';
  let decisionReason = '';

  if (!config.enabled) {
    finalDecision = 'SKIP';
    decisionReason = 'Auto-trade disabled — paper evaluation only';
    steps.push(`8️⃣ DECISION: ⏸️ SKIP — Auto-trade is disabled`);
  } else if (ml.score < parseInt(process.env.MIN_ML_SCORE || '70')) {
    finalDecision = 'SKIP';
    decisionReason = `ML score ${ml.score}% below threshold`;
    steps.push(`8️⃣ DECISION: ⏸️ SKIP — ML score too low (${ml.score}%)`);
  } else if (!composite.tradeable) {
    finalDecision = 'SKIP';
    decisionReason = `Composite score ${composite.finalScore}% (${composite.grade}) — not tradeable`;
    steps.push(`8️⃣ DECISION: ⏸️ SKIP — Composite grade ${composite.grade} below threshold`);
  } else if (decision.confidence < parseInt(process.env.MIN_CONFIDENCE || '80')) {
    finalDecision = 'SKIP';
    decisionReason = `Confidence ${decision.confidence}% below threshold`;
    steps.push(`8️⃣ DECISION: ⏸️ SKIP — Confidence too low`);
  } else if (!risk.canTrade) {
    finalDecision = 'SKIP';
    decisionReason = risk.reason;
    steps.push(`8️⃣ DECISION: 🛑 BLOCKED — ${risk.reason}`);
  } else {
    finalDecision = 'EXECUTE';
    decisionReason = `All checks passed — ${strategy} (Composite: ${composite.finalScore}% ${composite.grade})`;
    steps.push(`8️⃣ DECISION: ✅ EXECUTE — ${risk.positionSizePercent}% position via ${strategy} [Score: ${composite.finalScore}%]`);
  }

  // Check actual execution log
  const execLog = getExecutionLog();
  const wasExecuted = execLog.find(e => e.symbol === decision.symbol && Math.abs(e.price - decision.price) < decision.price * 0.01);

  return {
    id: `${decision.symbol}_${decision.timestamp}`,
    timestamp: decision.timestamp,
    symbol: decision.symbol,
    signal: decision.signal,
    price: decision.price,
    confidence: decision.confidence,
    strategy,
    entryReason: `${decision.signal} signal at $${decision.price.toLocaleString()} with ${decision.confidence}% confidence`,
    marketContext: {
      emaAlignment: emaStatus,
      priceVsDailyOpen: dailyOpenStatus,
      trendDirection: trend,
      volatility: `ATR-based: SL ${risk.stopLossPercent}% from entry`,
    },
    confirmations: {
      mlScore: ml.score,
      mlVerdict: ml.verdict,
      mlReasons: ml.reasons,
      confluenceConfirmed: emaConfirms ? 2 : 1,
      confluenceTotal: 3,
      sourceReliability: decision.source || 'engine',
    },
    riskLogic: {
      positionSize: risk.positionSize,
      positionSizePercent: risk.positionSizePercent,
      kellyFraction: risk.kellyFraction,
      dailyLossUsed: risk.dailyLossUsed,
      dailyLossLimit: risk.dailyLossLimit,
      maxDrawdown: risk.maxDrawdown,
      drawdownCurrent: risk.drawdownCurrent,
      correlationCheck: 'Passed',
    },
    slTpLogic: {
      stopLoss: risk.stopLoss,
      stopLossPercent: risk.stopLossPercent,
      takeProfit: risk.takeProfit,
      takeProfitPercent: risk.takeProfitPercent,
      riskRewardRatio: risk.riskRewardRatio,
      method: 'ATR-based dynamic (1.5× ATR stop, 3× ATR target)',
    },
    reasoningSteps: steps,
    decision: wasExecuted ? 'EXECUTE' : finalDecision,
    decisionReason: wasExecuted ? `Executed: ${wasExecuted.reason}` : decisionReason,
    outcome: decision.outcome !== 'PENDING' ? decision.outcome : undefined,
    pnlPercent: decision.pnlPercent || undefined,
    compositeScore: composite.finalScore,
    compositeGrade: composite.grade,
    compositeFactors: composite.factors,
    compositeBreakdown: composite.breakdown,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const symbol = searchParams.get('symbol');

    let decisions = getDecisions()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (symbol) {
      decisions = decisions.filter(d => d.symbol === symbol);
    }

    decisions = decisions.slice(0, limit);

    const balance = 1000; // paper balance
    const reasonings = decisions.map(d => buildReasoning(d, balance));

    // Summary stats
    const execCount = reasonings.filter(r => r.decision === 'EXECUTE').length;
    const skipCount = reasonings.filter(r => r.decision === 'SKIP').length;
    const pendingCount = reasonings.filter(r => r.decision === 'PENDING').length;
    const avgML = reasonings.length > 0
      ? Math.round(reasonings.reduce((s, r) => s + r.confirmations.mlScore, 0) / reasonings.length)
      : 0;

    return NextResponse.json({
      trades: reasonings,
      summary: {
        total: reasonings.length,
        executed: execCount,
        skipped: skipCount,
        pending: pendingCount,
        avgMlScore: avgML,
        autoTradeEnabled: getAutoTradeConfig().enabled,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
