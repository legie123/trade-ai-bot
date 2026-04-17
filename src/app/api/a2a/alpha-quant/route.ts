/**
 * Arena 1 — Alpha Quant
 * POST /api/a2a/alpha-quant
 *
 * Processes technical analysis signals and returns a LONG/SHORT/FLAT decision
 * with confidence score and reasoning for the given symbol.
 */
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { omegaExtractor } from '@/lib/v2/superai/omegaExtractor';

export const dynamic = 'force-dynamic';

const log = createLogger('Arena:AlphaQuant');

interface AlphaQuantRequest {
  symbol: string;
  /** Optional: pre-fetched OHLCV snapshot (last 20 candles) */
  ohlcv?: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  /** Optional: indicator snapshot */
  indicators?: {
    rsi?: number;
    macd?: { value: number; signal: number; histogram: number };
    ema20?: number;
    ema50?: number;
    bbands?: { upper: number; middle: number; lower: number };
    volume24h?: number;
  };
  timeframe?: string;
}

function verifyToken(request: Request): boolean {
  const token = process.env.SWARM_TOKEN;
  // If SWARM_TOKEN not configured, allow self-to-self calls (same container)
  // Once SWARM_TOKEN is set in GCP secrets, enforce strictly
  if (!token) { console.warn('[A2A] SWARM_TOKEN not set — allowing internal calls (set token for production hardening)'); return true; }
  const header = request.headers.get('x-swarm-token');
  return header === token;
}

export async function POST(request: Request) {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: AlphaQuantRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { symbol, indicators, timeframe = '4h' } = body;
  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 });
  }

  log.info(`[AlphaQuant] Analyzing ${symbol} on ${timeframe}`);

  try {
    // Get top gladiators for this symbol's arena
    const leaderboard = gladiatorStore.getLeaderboard().slice(0, 3);
    const omegaMod = omegaExtractor.getModifierForSymbol(symbol);

    // Derive signal from indicators if provided
    let direction: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
    let confidence = 0.5;
    const reasoning: string[] = [];

    if (indicators) {
      const { rsi, macd, ema20, ema50 } = indicators;

      // RSI signal
      if (rsi !== undefined) {
        if (rsi < 35) { direction = 'LONG'; confidence += 0.1; reasoning.push(`RSI oversold (${rsi.toFixed(1)})`); }
        else if (rsi > 65) { direction = 'SHORT'; confidence += 0.1; reasoning.push(`RSI overbought (${rsi.toFixed(1)})`); }
        else reasoning.push(`RSI neutral (${rsi.toFixed(1)})`);
      }

      // MACD signal
      if (macd) {
        if (macd.histogram > 0 && macd.value > macd.signal) {
          if (direction !== 'SHORT') { direction = 'LONG'; confidence += 0.08; }
          reasoning.push('MACD bullish crossover');
        } else if (macd.histogram < 0 && macd.value < macd.signal) {
          if (direction !== 'LONG') { direction = 'SHORT'; confidence += 0.08; }
          reasoning.push('MACD bearish crossover');
        }
      }

      // EMA trend
      if (ema20 && ema50) {
        if (ema20 > ema50) { reasoning.push('EMA20 > EMA50 (uptrend)'); if (direction === 'LONG') confidence += 0.05; }
        else { reasoning.push('EMA20 < EMA50 (downtrend)'); if (direction === 'SHORT') confidence += 0.05; }
      }
    }

    // Apply Omega modifier
    confidence = parseFloat(Math.min(0.95, confidence * omegaMod).toFixed(3));

    // Gladiator consensus boost
    const liveWinRate = leaderboard.length > 0
      ? leaderboard.reduce((s, g) => s + g.stats.winRate, 0) / leaderboard.length
      : 50;

    if (liveWinRate >= 55 && direction !== 'FLAT') {
      confidence = parseFloat(Math.min(0.95, confidence + 0.03).toFixed(3));
      reasoning.push(`Gladiator consensus boost (avg WR: ${liveWinRate.toFixed(1)}%)`);
    }

    return NextResponse.json({
      arena: 'alpha-quant',
      symbol,
      timeframe,
      direction,
      confidence,
      reasoning: reasoning.join(' | ') || 'No indicators provided — neutral stance',
      omegaModifier: omegaMod,
      gladiatorWinRate: parseFloat(liveWinRate.toFixed(2)),
      timestamp: Date.now(),
    });

  } catch (err) {
    log.error('[AlphaQuant] Error', { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    arena: 'alpha-quant',
    status: 'ready',
    description: 'Technical analysis and quantitative signals arena',
    accepts: 'POST { symbol, ohlcv?, indicators?, timeframe? }',
  });
}
