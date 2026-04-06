// GET /api/watchdog/ping — Health check for external monitors (e.g. OpenClaw)
import { NextResponse } from 'next/server';
import { gladiatorStore } from '@/lib/store/gladiatorStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const startTime = performance.now();
    const dbStatus = 'ok';
    
    // Agent Check
    const activeGladiators = gladiatorStore.getGladiators().length;
    const isSyndicateAlive = activeGladiators > 0;

    const health = {
      system: 'Phoenix V2 (GTC)',
      status: dbStatus === 'ok' && isSyndicateAlive ? 'LIVE' : 'DEGRADED',
      components: {
        database: dbStatus,
        syndicate: isSyndicateAlive ? 'active' : 'inactive',
        gladiatorsLoaded: activeGladiators,
      },
      metrics: {
        memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        uptime: (Date.now() - 1775260800000) / 1000,
        latencyMs: Math.round(performance.now() - startTime),
      },
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(health, { status: health.status === 'LIVE' ? 200 : 503 });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', message: (err as Error).message },
      { status: 500 }
    );
  }
}
