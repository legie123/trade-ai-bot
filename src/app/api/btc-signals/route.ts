// GET /api/btc-signals — run BTC scanner, return analysis + trigger Phoenix V2
import { NextResponse } from 'next/server';
import { analyzeBTC } from '@/lib/v2/scouts/ta/btcEngine';
import { createLogger } from '@/lib/core/logger';
import { ManagerVizionar } from '@/lib/v2/manager/managerVizionar';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { Signal } from '@/lib/types/radar';
import { routeSignal } from '@/lib/router/signalRouter';
import { signalStore } from '@/lib/store/signalStore';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';
import { initDB } from '@/lib/store/db';

const log = createLogger('BtcSignalsRoute');
const manager = ManagerVizionar.getInstance();

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

let cache: { data: Record<string, unknown>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 15_000;

export async function GET() {
  try {
    // COLD-START FIX (2026-04-18): Hydrate gladiatorStore before findBestGladiator().
    await initDB();

    const now = Date.now();

    // 1. Return Cache if valid
    if (cache && now < cache.expiresAt) {
      return NextResponse.json(cache.data);
    }

    // 2. Obtain raw BTC TA signals (Scout Level)
    const analysis = await analyzeBTC();

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

    cache = { data: responseData, expiresAt: now + CACHE_TTL_MS };

    // 3. Phoenix V2 Auto-Trigger — PARALLEL per signal
    const signalTasks: Promise<void>[] = [];
    for (const rawSig of analysis.signals) {
      if (rawSig.signal !== 'NEUTRAL') {
         const signalId = `btc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
         const signalPayload: Signal = {
           id: signalId,
           symbol: 'BTC',
           timeframe: '1h',
           signal: rawSig.signal as Signal['signal'],
           price: analysis.price,
           timestamp: analysis.timestamp,
           source: 'BTC Scout V2',
           message: rawSig.reason,
         };

         const routed = routeSignal(signalPayload);
         signalStore.addSignal(routed);
         ArenaSimulator.getInstance().distributeSignalToGladiators(routed);

         const gladiator = gladiatorStore.findBestGladiator(routed.symbol);

         if (gladiator) {
           log.info(`[V2 TRIGGER] Processing internal BTC signal with Gladiator: ${gladiator.name}`);
           signalTasks.push(
             manager.processSignal(gladiator, routed).catch(err => {
               log.error('[V2 CRITICAL] Phoenix Process Error (BTC)', { error: (err as Error).message });
             })
           );
         }
      }
    }
    if (signalTasks.length > 0) await Promise.allSettled(signalTasks);

    return NextResponse.json(responseData);
  } catch (err) {
    log.error('BTC Engine error', { error: (err as Error).message });
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 }
    );
  }
}
