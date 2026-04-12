// GET /api/health — production-resilient health check
import { NextResponse } from 'next/server';
import { getWatchdogState } from '@/lib/core/watchdog';
import { getHealthSnapshot } from '@/lib/core/heartbeat';
import { isKillSwitchEngaged, getKillSwitchState } from '@/lib/core/killSwitch';
import { getDecisions } from '@/lib/store/db';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { testMexcConnection } from '@/lib/exchange/mexcClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const watchdog = getWatchdogState();
    const heartbeat = getHealthSnapshot();
    const hs = heartbeat?.status || 'YELLOW';
    
    // Test MEXC Connection
    let mexcOk = false;
    let mexcMode = 'UNKNOWN';
    let mexcLatency = 0;
    try {
      const start = Date.now();
      const conn = await testMexcConnection();
      mexcLatency = Date.now() - start;
      mexcOk = conn.ok;
      mexcMode = conn.mode;
    } catch { /* */ }

    // Test DexScreener Connection
    let dexOk = false;
    try {
      const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(3000) });
      dexOk = res.ok;
    } catch { /* */ }

    // Test CoinGecko Connection
    let cgOk = false;
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/ping', { signal: AbortSignal.timeout(3000) });
      cgOk = res.ok;
    } catch { /* */ }

    // Aggregate stats
    const decisions = getDecisions();
    const today = new Date().toISOString().slice(0, 10);
    const todayDecisions = decisions.filter(d => d.timestamp.startsWith(today)).length;
    const activeGladiators = gladiatorStore.getGladiators().length;

    // Overall Status
    const killSwitch = getKillSwitchState();
    const isRed = hs === 'RED' || !mexcOk || isKillSwitchEngaged();
    const isYellow = hs === 'YELLOW' || watchdog.status === 'WARNING';
    const overallStatus = isRed ? 'DEGRADED' : isYellow ? 'WARNING' : 'HEALTHY';

    return NextResponse.json({
      status: overallStatus,
      version: '6.0.0 (Phoenix V2)',
      systemMode: process.env.AUTO_TRADE_ENABLED === 'true' ? 'AUTO_TRADE' : 'PAPER',
      uptimeSecs: (Date.now() - 1775260800000) / 1000,
      
      coreMonitor: {
        heartbeat: heartbeat?.status || 'UNKNOWN',
        watchdog: watchdog.status,
        killSwitch: killSwitch.engaged ? `LOCKED: ${killSwitch.reason}` : 'SAFE',
      },

      trading: {
        autoSelectEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
        totalGladiators: activeGladiators,
        decisionsToday: todayDecisions,
        forgeProgress: gladiatorStore.getGladiators().find(g => g.isOmega)?.trainingProgress || 0,
      },

      api: {
        mexc: { ok: mexcOk, mode: mexcMode, latencyMs: mexcLatency },
        dexScreener: { ok: dexOk },
        coinGecko: { ok: cgOk },
      },

      memoryTracker: heartbeat?.memory || {},
      
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'ERROR', error: (err as Error).message }, { status: 500 });
  }
}
