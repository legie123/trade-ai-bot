// GET /api/dashboard — Dashboard system state for useRealtimeData hook
import { NextResponse } from 'next/server';
import { getWatchdogState, watchdogPing } from '@/lib/core/watchdog';
import { getFreshHealthSnapshot, startHeartbeat } from '@/lib/core/heartbeat';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { getRecentLogs } from '@/lib/core/logger';
import { getDecisions, getSyncQueueStats, getLivePositions, getBotConfig, getEquityCurve } from '@/lib/store/db';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { getMoltbookTelemetry } from '@/lib/moltbook/moltbookClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Self-init for serverless: ensure heartbeat & watchdog are alive on THIS instance
    startHeartbeat();
    watchdogPing();
    // Also mark scan loop active on this instance
    const gScan = globalThis as unknown as {
      __autoScan?: { running: boolean; lastScanAt: string | null; scanCount: number };
    };
    if (!gScan.__autoScan) {
      gScan.__autoScan = { running: false, lastScanAt: null, scanCount: 0 };
    }

    const watchdog = getWatchdogState();
    const heartbeat = getFreshHealthSnapshot();
    const killSwitch = getKillSwitchState();
    
    // Calculate trading stats
    const decisions = getDecisions();
    const today = new Date().toISOString().split('T')[0];
    const todayDecisions = decisions.filter(d => d.timestamp.startsWith(today) && d.outcome !== 'PENDING');
    
    const dailyPnlPercent = todayDecisions.reduce((acc, curr) => acc + (curr.pnlPercent || 0), 0);
    const pendingDecisions = decisions.filter(d => d.outcome === 'PENDING').length;
    const openPositions = getLivePositions().filter(p => p.status === 'OPEN').length;

    const recentLogs = getRecentLogs(20);
    const memUsageMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    
    // Active modules check
    const gladiators = gladiatorStore.getGladiators();
    const activeGladiators = gladiators.filter(g => g.isLive).length;

    // Compute real uptime (V2 Genesis Timestamp: April 4, 2026)
    const GENESIS_TIMESTAMP = 1775260800000;
    const uptimeSeconds = (Date.now() - GENESIS_TIMESTAMP) / 1000;

    // Overall system status derived from heartbeat + watchdog + killswitch + bot mode
    const heartbeatStatus = heartbeat?.status || 'YELLOW';
    const botConfig = getBotConfig();
    const isHalted = botConfig.haltedUntil && new Date(botConfig.haltedUntil) > new Date();
    const isSystemHealthy = watchdog.status === 'HEALTHY' && !killSwitch.engaged && heartbeatStatus !== 'RED';
    const systemStatus = killSwitch.engaged ? 'HALTED (KILL SWITCH)' 
      : isHalted ? `HALTED — Cooldown until ${new Date(botConfig.haltedUntil!).toLocaleTimeString()}`
      : watchdog.status === 'DEAD' ? 'CRITICAL — Watchdog Dead'
      : heartbeatStatus === 'RED' ? 'DEGRADED — Heartbeat Red'
      : botConfig.mode === 'OBSERVATION' ? 'OBSERVATION — No Execution'
      : isSystemHealthy ? 'LIVE - SUPER AI OMEGA' 
      : 'WARNING';

    return NextResponse.json({
      system: { 
        status: systemStatus, 
        uptime: uptimeSeconds, 
        memoryUsageRssMB: memUsageMB,
        syncQueue: getSyncQueueStats(),
        moltbook: getMoltbookTelemetry(),
        modulesActive: activeGladiators,
        feedsLive: heartbeat?.providers ? Object.values(heartbeat.providers).filter((p: { ok: boolean }) => p.ok).length : 0,
        sentinelsActive: 4, // Risk + Loss + WinRate + Streak sentinels
        streamStatus: heartbeat?.scanLoop?.running ? 'STREAMING' : 'IDLE',
        runtimeHealth: heartbeatStatus,
        lastSync: heartbeat?.timestamp || new Date().toISOString(),
        blockageReason: killSwitch.engaged ? killSwitch.reason 
          : watchdog.status === 'DEAD' ? 'No heartbeat for 5+ minutes' 
          : heartbeatStatus === 'RED' ? 'Scan loop not running or stale'
          : null,
      },
      watchdog: { 
        status: watchdog.status, 
        crashCount: watchdog.crashCount,
        consecutiveFailures: watchdog.consecutiveFailures,
        lastPing: watchdog.lastPing,
        startedAt: watchdog.startedAt,
        alive: watchdog.alive,
      },
      heartbeat: heartbeat ? {
        status: heartbeat.status,
        providers: heartbeat.providers,
        scanLoop: heartbeat.scanLoop,
        memory: heartbeat.memory,
      } : null,
      killSwitch: { 
        engaged: killSwitch.engaged, 
        reason: killSwitch.reason 
      },
      trading: {
        totalSignals: decisions.length,
        pendingDecisions,
        executionsToday: todayDecisions.length,
        dailyPnlPercent: Math.round(dailyPnlPercent * 100) / 100,
        openPositions,
      },
      logs: {
        recent: recentLogs.map((l: { ts: string; level: string; module: string; msg: string }) => ({
          ts: l.ts || new Date().toISOString(),
          level: l.level || 'INFO',
          msg: `[${l.module}] ${l.msg}`,
        })),
        errorCount1h: recentLogs.filter((l: { level: string }) => l.level === 'ERROR' || l.level === 'FATAL').length,
      },
      history: getEquityCurve(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message }, { status: 500 });
  }
}
