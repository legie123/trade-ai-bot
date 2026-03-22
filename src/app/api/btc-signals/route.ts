// GET /api/btc-signals — run BTC engine, auto-evaluate, return analysis + signals
import { NextResponse } from 'next/server';
import { generateBTCSignals } from '@/lib/engine/btcEngine';
import { evaluatePendingDecisions } from '@/lib/engine/tradeEvaluator';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('BtcSignalsRoute');

export const dynamic = 'force-dynamic';

let cache: { data: Record<string, unknown>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 15_000;

let lastEvalTime = 0;
const EVAL_COOLDOWN_MS = 60_000;

export async function GET() {
  try {
    const now = Date.now();

    // 1. Return Cache if valid
    if (cache && now < cache.expiresAt) {
      return NextResponse.json(cache.data);
    }

    // 2. Run BTC engine (generates signals + saves decisions)
    const analysis = await generateBTCSignals();

    const responseData = {
      status: 'ok',
      btc: {
        price: analysis.price,
        ema50: analysis.ema50,
        ema200: analysis.ema200,
        ema800: analysis.ema800,
        dailyOpen: analysis.dailyOpen,
        psychHigh: analysis.psychHigh,
        psychLow: analysis.psychLow,
        prevHigh: analysis.prevHigh,
        prevLow: analysis.prevLow,
      },
      signals: analysis.signals,
      timestamp: analysis.timestamp,
    };

    // Update Cache
    cache = { data: responseData, expiresAt: now + CACHE_TTL_MS };

    // 3. Auto-evaluate pending decisions in background (Throttled)
    if (now - lastEvalTime > EVAL_COOLDOWN_MS) {
      lastEvalTime = now;
      evaluatePendingDecisions()
        .then((res) => {
          if (res.evaluated > 0) {
            log.info(`Auto-Eval: ${res.evaluated} evaluated: ${res.wins}W / ${res.losses}L`);
          }
        })
        .catch((err) => log.warn('Auto-Eval error', { error: (err as Error).message }));
    }

    return NextResponse.json(responseData);
  } catch (err) {
    log.error('BTC Engine error', { error: (err as Error).message });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 }
    );
  }
}

