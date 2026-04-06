import { NextRequest, NextResponse } from 'next/server';
import { ManagerVizionar } from '@/lib/v2/manager/managerVizionar';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { Signal } from '@/lib/types/radar';

/**
 * POST /api/v2/test-live-cycle
 * Triggers a manual full run of Phoenix V2 (Scout -> Syndicate -> Sentinel -> Execution)
 */
export async function POST(req: NextRequest) {
  try {
    const { symbol = 'BTC', signal = 'BUY', action } = await req.json();
    
    if (action === 'arena_simulate') {
      const { ArenaSimulator } = await import('@/lib/v2/arena/simulator');
      const arena = ArenaSimulator.getInstance();
      await arena.unleashBattles(50);
      return NextResponse.json({
         status: 'arena_simulated',
         battles: 50,
         timestamp: new Date().toISOString()
      });
    }

    const manager = ManagerVizionar.getInstance();
    const gladiator = gladiatorStore.findBestGladiator(symbol);

    if (!gladiator) {
      return NextResponse.json({ error: 'No live gladiator found for symbol' }, { status: 404 });
    }

    const testSignal: Signal = {
      id: `test_${Date.now()}`,
      symbol,
      signal,
      price: 50000,
      timestamp: new Date().toISOString(),
      source: 'MANUAL_TEST',
      timeframe: '15m'
    };

    // We DON'T await it if we want it to be fire-and-forget like the webhook,
    // but for the test route, we AWAIT to see the result.
    await manager.processSignal(gladiator, testSignal);

    return NextResponse.json({
      status: 'cycle_triggered',
      gladiator: gladiator.name,
      arena: gladiator.arena,
      v2_enabled: true,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
