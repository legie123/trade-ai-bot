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

const log = createLogger('SolanaSignalsRoute');
const manager = ManagerVizionar.getInstance();

export const dynamic = 'force-dynamic';

let cache: { data: Record<string, unknown>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 15_000;

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

    cache = { data: responseData, expiresAt: now + CACHE_TTL_MS };

    // 2. Trigger Phoenix V2 Manager
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
             };
             
             const routed = routeSignal(signalPayload);
             signalStore.addSignal(routed);
             ArenaSimulator.getInstance().distributeSignalToGladiators(routed);
             
             const gladiator = gladiatorStore.findBestGladiator(routed.symbol);
             
             if (gladiator) {
               log.info(`[V2 TRIGGER] Processing internal SOL signal with Gladiator: ${gladiator.name}`);
               manager.processSignal(gladiator, routed).catch((err: unknown) => {
                 log.error('[V2 CRITICAL] Phoenix Process Error (SOL)', { error: (err as Error).message });
               });
             }
         }
      }
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
