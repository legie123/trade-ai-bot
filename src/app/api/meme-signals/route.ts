// GET /api/meme-signals
import { NextResponse } from 'next/server';
import { runMemeEngineScan } from '@/lib/v2/scouts/ta/memeEngine';
import { createLogger } from '@/lib/core/logger';
import { ManagerVizionar } from '@/lib/v2/manager/managerVizionar';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { routeSignal } from '@/lib/router/signalRouter';
import { signalStore } from '@/lib/store/signalStore';
import { ArenaSimulator } from '@/lib/v2/arena/simulator';
import { initDB } from '@/lib/store/db';

const log = createLogger('MemeApi');
const manager = ManagerVizionar.getInstance();

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // COLD-START FIX (2026-04-18): Hydrate gladiatorStore before findBestGladiator().
    await initDB();

    const result = await runMemeEngineScan();
    
    // Process generated signals through the main AI manager
    if (result.signals && result.signals.length > 0) {
      for (const rawSig of result.signals) {
        if (rawSig.signal !== 'NEUTRAL') {
          const routed = routeSignal(rawSig);
          signalStore.addSignal(routed);
          ArenaSimulator.getInstance().distributeSignalToGladiators(routed);
          
          const gladiator = await gladiatorStore.findBestGladiator(routed.symbol);
          if (gladiator) {
            log.info(`[MEME TRIGGER] Processing MEME signal with Gladiator: ${gladiator.name}`);
            try {
              await manager.processSignal(gladiator, routed);
            } catch (err) {
              log.error('[MEME CRITICAL] Phoenix Process Error', { error: (err as Error).message });
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    log.error('Meme-signals engine failed', { error });
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
