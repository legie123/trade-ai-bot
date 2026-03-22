// GET /api/health — production-resilient health check
import { NextResponse } from 'next/server';
import { getWatchdogState } from '@/lib/core/watchdog';
import { getHealthSnapshot } from '@/lib/core/heartbeat';
import { isKillSwitchEngaged, getKillSwitchState } from '@/lib/core/killSwitch';
import { startAutoScan } from '@/lib/engine/autoScan';
import { getAggregatorStats } from '@/lib/engine/signalAggregator';
import { getExecutionLog } from '@/lib/engine/executor';
import { getDecisions } from '@/lib/store/db';
import { testConnection } from '@/lib/exchange/binanceClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Auto-start scanning loop on first health check if dead
    const watchdog = getWatchdogState();
    if (!watchdog.alive && watchdog.status !== 'HEALTHY') {
      startAutoScan();
    }

    const heartbeat = getHealthSnapshot();
    const hs = heartbeat?.status || 'YELLOW';
    
    // Test Binance Connection
    let binanceOk = false;
    let binanceMode = 'UNKNOWN';
    let binanceLatency = 0;
    try {
      const start = Date.now();
      const conn = await testConnection();
      binanceLatency = Date.now() - start;
      binanceOk = conn.ok;
      binanceMode = conn.mode;
    } catch { /* */ }

    // Aggregate stats
    const agg = getAggregatorStats();
    const execLog = getExecutionLog();
    const decisions = getDecisions();
    const today = new Date().toISOString().slice(0, 10);
    const todayDecisions = decisions.filter(d => d.timestamp.startsWith(today)).length;
    const executedToday = execLog.filter(r => r.executed && r.timestamp?.startsWith(today)).length;

    // Overall Status
    const killSwitch = getKillSwitchState();
    const isRed = hs === 'RED' || !binanceOk || isKillSwitchEngaged();
    const isYellow = hs === 'YELLOW' || watchdog.status === 'WARNING';
    const overallStatus = isRed ? 'DEGRADED' : isYellow ? 'WARNING' : 'HEALTHY';

    return NextResponse.json({
      status: overallStatus,
      version: '6.0.0 (Hardened)',
      systemMode: 'PAPER_ONLY', // New standard for execution
      uptimeSecs: process.uptime(),
      
      coreMonitor: {
        heartbeat: heartbeat?.status || 'UNKNOWN',
        watchdog: watchdog.status,
        killSwitch: killSwitch.engaged ? `LOCKED: ${killSwitch.reason}` : 'SAFE',
      },

      trading: {
        autoSelectEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
        totalSignalsReady: agg.total,
        decisionsToday: todayDecisions,
        paperFillsToday: executedToday,
        openPositions: agg.pendingCount,
      },

      api: {
        binance: { ok: binanceOk, mode: binanceMode, latencyMs: binanceLatency },
        dexScreener: heartbeat?.providers['dexscreener'] || { ok: false },
        coinGecko: heartbeat?.providers['coingecko'] || { ok: false }, // implicitly part of engine fallback
      },

      memoryTracker: heartbeat?.memory || {},
      
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'ERROR', error: (err as Error).message }, { status: 500 });
  }
}
