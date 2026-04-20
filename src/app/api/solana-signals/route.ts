// GET /api/solana-signals — run Solana multi-coin scanner
import { NextResponse } from 'next/server';
import { analyzeMultiCoin } from '@/lib/v2/scouts/ta/solanaEngine';
import { createLogger } from '@/lib/core/logger';
import { ManagerVizionar } from '@/lib/v2/manager/managerVizionar';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { Signal } from '@/lib/types/radar';
import { routeSignal } from '@/lib/router/signalRouter';
import { signalStore } from '@/lib/store/signalStore';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';
import { initDB } from '@/lib/store/db';
// P2-6b (2026-04-20): pull cid from AsyncLocalStorage scope set by cron wrap.
import { getCurrentCid } from '@/lib/observability/correlationId';

const log = createLogger('SolanaSignalsRoute');
const manager = ManagerVizionar.getInstance();

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

let cache: { data: Record<string, unknown>; expiresAt: number } | null = null;
// C20 (2026-04-20): Route cache 15s→90s. Prior: every 15s re-ran analyzeMultiCoin + processSignal
// even though 4h candle data doesn't change. 90s aligns with cron period (~60s) plus margin.
// On cache hit, returns instantly (no processSignal, no OHLC fetches).
const CACHE_TTL_MS = 90_000;

export async function GET() {
  try {
    // COLD-START FIX (2026-04-18): Hydrate gladiatorStore before findBestGladiator().
    await initDB();

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

    cache = { data: responseData, expiresAt: now + CACHE_TTL_MS };

    // 2. Trigger Phoenix V2 Manager — PARALLEL per signal (each is independent)
    // PERF FIX 2026-04-18: processSignal was sequential per signal → 5 LLM calls × ~4s each = 20s.
    // Parallel: max(all LLM calls) ≈ 4-8s. Rate-limit safe: LLM providers handle concurrent requests.
    const signalTasks: Promise<void>[] = [];
    for (const coin of result.coins) {
      for (const rawSig of coin.signals) {
         if (rawSig.signal !== 'NEUTRAL') {
             const signalId = `sol_${coin.symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
             const signalPayload: Signal = {
               id: signalId,
               symbol: coin.symbol,
               timeframe: '1h',
               signal: rawSig.signal as Signal['signal'],
               price: coin.price,
               timestamp: result.timestamp,
               source: 'Solana Scout V2',
               message: rawSig.reason,
               // P2-6b: cid flows signal → processSignal → dualMaster → syndicate_audits.
               correlationId: getCurrentCid() || undefined,
             };

             const routed = routeSignal(signalPayload);
             signalStore.addSignal(routed);
             ArenaSimulator.getInstance().distributeSignalToGladiators(routed);

             const gladiator = await gladiatorStore.findBestGladiator(routed.symbol);

             if (gladiator) {
               log.info(`[V2 TRIGGER] Processing internal SOL signal with Gladiator: ${gladiator.name}`);
               signalTasks.push(
                 manager.processSignal(gladiator, routed).catch(err => {
                   log.error('[V2 CRITICAL] Phoenix Process Error (SOL)', { error: (err as Error).message });
                 })
               );
             }
         }
      }
    }
    if (signalTasks.length > 0) await Promise.allSettled(signalTasks);

    return NextResponse.json(responseData);
  } catch (err) {
    log.error('Solana Engine error', { error: (err as Error).message });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 }
    );
  }
}
