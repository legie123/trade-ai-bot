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
      return NextResponse.json({
         status: 'deprecated',
         message: 'unleashBattles removed — phantom trades now use real MEXC prices via evaluatePhantomTrades()',
         timestamp: new Date().toISOString()
      });
    }
    
    if (action === 'massive_phantom_test') {
      const { ArenaSimulator } = await import('@/lib/v2/arena/simulator');
      const { routeSignal } = await import('@/lib/router/signalRouter');
      const { getPhantomTrades } = await import('@/lib/store/db');
      const arena = ArenaSimulator.getInstance();
      
      // Seed 50 realistic signals
      const symbols = ['BTC', 'SOL', 'ETH', 'XRP'];
      for (let i = 0; i < 50; i++) {
        const symbol = symbols[Math.floor(Math.random() * symbols.length)];
        const routed = routeSignal({
           id: `test_mass_${i}`,
           symbol,
           signal: Math.random() > 0.5 ? 'BUY' : 'SELL',
           price: Math.random() * 50000 + 1000,
           timestamp: new Date().toISOString(),
           source: 'MASS_TEST',
           timeframe: '15m'
        });
        arena.distributeSignalToGladiators(routed);
      }
      
      // Fast-forward time for all generated phantom trades (so cron evaluates them immediately)
      const trades = getPhantomTrades();
      trades.forEach((t: any) => {
        t.timestamp = new Date(Date.now() - 60000).toISOString(); // push it 60 seconds to the past
      });
      
      // Simulate Cron Loop Evaluation
      await arena.evaluatePhantomTrades();

      return NextResponse.json({
         status: 'massive_phantom_combat_completed',
         signalsDeployed: 50,
         phantomTradesResolved: trades.length,
         timestamp: new Date().toISOString()
      });
    }

    if (action === 'reset_health') {
      const { clearSystemHealthData } = await import('@/lib/store/db');
      clearSystemHealthData();
      return NextResponse.json({ status: 'system_pnl_reset_to_green' });
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
