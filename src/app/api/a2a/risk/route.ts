/**
 * Arena 3 — Risk
 * POST /api/a2a/risk
 *
 * Evaluates a proposed trade against position sizing rules and SentinelGuard
 * thresholds. Returns approval/denial with position size and stop-loss.
 */
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { calculateAdaptiveSize } from '@/lib/v2/safety/adaptiveSizing';

export const dynamic = 'force-dynamic';

const log = createLogger('Arena:Risk');

interface RiskRequest {
  symbol: string;
  proposedDirection: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number;            // 0–1
  currentEquity: number;         // USD
  openPositions?: number;        // Count of currently open trades
  dailyLossCount?: number;       // How many losses today (for daily limit)
  currentWinRate?: number;       // Current session WR
  currentLossStreak?: number;    // Consecutive losses
  // Step 1.3: Adaptive sizing inputs (optional — defaults to safe values)
  regime?: string;               // Market regime (BULL/BEAR/RANGE/etc)
  currentMDD?: number;           // Current max drawdown (0-1)
  volatilityScore?: number;      // Volatility 0-100
}

// Sentinel thresholds (mirroring SentinelGuard hardcoded limits)
const SENTINEL = {
  maxDailyLosses: 3,
  minWinRate: 40,
  maxLossStreak: 4,
  maxOpenPositions: 5,
  maxRiskPerTrade: 0.02,        // 2% of equity
  minConfidence: 0.45,          // Below this → FLAT only
} as const;

function verifyToken(request: Request): boolean {
  const token = process.env.SWARM_TOKEN;
  if (!token) { console.warn('[A2A] SWARM_TOKEN not set — allowing internal calls'); return true; }
  return request.headers.get('x-swarm-token') === token;
}

export async function POST(request: Request) {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: RiskRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    symbol,
    proposedDirection,
    confidence,
    currentEquity,
    openPositions = 0,
    dailyLossCount = 0,
    currentWinRate,
    currentLossStreak = 0,
  } = body;

  if (!symbol || !proposedDirection || confidence == null || !currentEquity) {
    return NextResponse.json({ error: 'symbol, proposedDirection, confidence, currentEquity required' }, { status: 400 });
  }

  log.info(`[Risk] Evaluating ${symbol} ${proposedDirection} conf=${confidence} equity=${currentEquity}`);

  const denialReasons: string[] = [];

  // ── Sentinel checks ──
  if (dailyLossCount >= SENTINEL.maxDailyLosses) {
    denialReasons.push(`Daily loss limit reached (${dailyLossCount}/${SENTINEL.maxDailyLosses})`);
  }

  if (currentLossStreak >= SENTINEL.maxLossStreak) {
    denialReasons.push(`Max loss streak exceeded (${currentLossStreak}/${SENTINEL.maxLossStreak})`);
  }

  if (currentWinRate !== undefined && currentWinRate < SENTINEL.minWinRate && currentWinRate > 0) {
    denialReasons.push(`Win rate too low (${currentWinRate.toFixed(1)}% < ${SENTINEL.minWinRate}%)`);
  }

  if (openPositions >= SENTINEL.maxOpenPositions) {
    denialReasons.push(`Max open positions reached (${openPositions}/${SENTINEL.maxOpenPositions})`);
  }

  if (confidence < SENTINEL.minConfidence && proposedDirection !== 'FLAT') {
    denialReasons.push(`Confidence too low (${confidence.toFixed(3)} < ${SENTINEL.minConfidence})`);
  }

  // ── Live gladiator data ──
  const liveGladiators = gladiatorStore.getLeaderboard().filter(g => g.isLive);
  const avgLiveWR = liveGladiators.length > 0
    ? liveGladiators.reduce((s, g) => s + g.stats.winRate, 0) / liveGladiators.length
    : 0;

  // ── Position sizing (Step 1.3: Regime-Adaptive) ──
  // Base risk: 2% of equity, scaled by confidence
  const baseRisk = SENTINEL.maxRiskPerTrade;
  const confidenceScaledRisk = baseRisk * confidence;

  // Adaptive sizing: adjust based on regime, drawdown, volatility, streak
  // TODO: Wire real regime from marketRegime agent when available in request body
  const adaptiveResult = calculateAdaptiveSize({
    baseRiskFraction: confidenceScaledRisk,
    regime: body.regime || 'unknown',
    currentMDD: body.currentMDD || 0,
    volatilityScore: body.volatilityScore || 50,
    consecutiveLosses: currentLossStreak,
  });

  const scaledRisk = parseFloat(adaptiveResult.adjustedFraction.toFixed(4));
  const positionSize = parseFloat((currentEquity * scaledRisk).toFixed(2));

  // Stop-loss: 1.5× ATR proxy — simplified as 1.5% of entry price
  // Real ATR would come from ohlcv data; we use a conservative default
  const stopLossPercent = parseFloat((0.015 / confidence).toFixed(4)); // tighter at high confidence

  const approved = denialReasons.length === 0 && proposedDirection !== 'FLAT';

  return NextResponse.json({
    arena: 'risk',
    symbol,
    proposedDirection,
    approved,
    positionSize: approved ? positionSize : 0,
    riskPercent: approved ? scaledRisk : 0,
    stopLossPercent: approved ? stopLossPercent : 0,
    sentinelStatus: denialReasons.length > 0 ? 'HALTED' : 'SAFE',
    denialReasons,
    liveGladiators: liveGladiators.length,
    avgLiveWinRate: parseFloat(avgLiveWR.toFixed(2)),
    adaptiveSizing: {
      regimeMultiplier: adaptiveResult.regimeMultiplier,
      drawdownMultiplier: adaptiveResult.drawdownMultiplier,
      volatilityPenalty: adaptiveResult.volatilityPenalty,
      streakPenalty: adaptiveResult.streakPenalty,
      reasoning: adaptiveResult.reasoning,
    },
    timestamp: Date.now(),
  });
}

export async function GET() {
  return NextResponse.json({
    arena: 'risk',
    status: 'ready',
    description: 'Position sizing, drawdown management, SentinelGuard arena',
    accepts: 'POST { symbol, proposedDirection, confidence, currentEquity, openPositions?, dailyLossCount?, currentWinRate?, currentLossStreak? }',
    sentinelThresholds: SENTINEL,
  });
}
