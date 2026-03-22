// GET /api/solana-signals — run Solana multi-coin engine
import { NextResponse } from 'next/server';
import { analyzeMultiCoin } from '@/lib/engine/solanaEngine';
import { evaluatePendingDecisions } from '@/lib/engine/tradeEvaluator';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('SolanaSignalsRoute');

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

    const result = await analyzeMultiCoin();

    const responseData = {
      status: 'ok',
      coins: result.coins,
      totalSignals: result.totalSignals,
      timestamp: result.timestamp,
    };

    // Update Cache
    cache = { data: responseData, expiresAt: now + CACHE_TTL_MS };

    // 2. Auto-evaluate pending decisions (Throttled)
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
    log.error('Solana Engine error', { error: (err as Error).message });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 }
    );
  }
}
