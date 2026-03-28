// ============================================================
// Cron Scan — Vercel serverless-compatible scan cycle
// Runs engines INLINE (no setInterval), saves to Supabase
// Called by external cron every 5 minutes
// ============================================================
import { NextResponse } from 'next/server';
import { initDB } from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('Vercel-Cron');

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const startTime = Date.now();
  log.info('🔄 Cron scan cycle starting...');

  const results = {
    btcSignals: 0,
    solSignals: 0,
    evaluated: 0,
    autoTrades: 0,
    errors: [] as string[],
  };

  try {
    // 1. Hydrate DB from Supabase (restore state between serverless invocations)
    await initDB();

    // 3. Run all engines IN PARALLEL to avoid Vercel strict hobby tier timeout (10s)
    await Promise.allSettled([
      // BTC Engine
      import('@/lib/engine/btcEngine').then(m => m.generateBTCSignals()).then(res => {
        results.btcSignals = res.signals.filter(s => s.signal !== 'NEUTRAL').length;
        log.info(`BTC: ${results.btcSignals} signals, price $${res.price}`);
      }).catch(err => {
        results.errors.push(`BTC: ${(err as Error).message}`);
        log.error('BTC engine failed', { error: String(err) });
      }),

      // Solana Engine
      import('@/lib/engine/solanaEngine').then(m => m.analyzeMultiCoin()).then(res => {
        results.solSignals = res.totalSignals;
        log.info(`SOL: ${results.solSignals} signals across ${res.coins.length} coins`);
      }).catch(err => {
        results.errors.push(`SOL: ${(err as Error).message}`);
        log.error('Solana engine failed', { error: String(err) });
      }),

      // Evaluate pending decisions
      import('@/lib/engine/tradeEvaluator').then(m => m.evaluatePendingDecisions()).then(res => {
        results.evaluated = res.evaluated;
      }).catch(err => {
        results.errors.push(`Eval: ${(err as Error).message}`);
      }),

      // Auto-trade scan (if enabled)
      import('@/lib/engine/autoTrader').then(m => m.scanForAutoTrades()).then(res => {
        results.autoTrades = res.filter(t => t.shouldExecute).length;
      }).catch(err => {
        results.errors.push(`Trade: ${(err as Error).message}`);
      })
    ]);

    const elapsed = Date.now() - startTime;
    log.info(`✅ Cron cycle complete in ${elapsed}ms`, results);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      elapsedMs: elapsed,
      results,
    });
  } catch (err) {
    log.error('Cron cycle failed', { error: String(err) });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
