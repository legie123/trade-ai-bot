import { NextResponse } from 'next/server';
import { getWatchdogState } from '@/lib/core/watchdog';
import { getHealthSnapshot, getSnapshotHistory } from '@/lib/core/heartbeat';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { getRecentLogs, getLogsByLevel } from '@/lib/core/logger';
import { getExecutionLog } from '@/lib/engine/executor';
import { getDecisions, getPerformance } from '@/lib/store/db';
import { getAggregatorStats } from '@/lib/engine/signalAggregator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const watchdog = getWatchdogState();
    const heartbeat = getHealthSnapshot();
    const killSwitch = getKillSwitchState();
    
    // Aggregator Stats
    const aggregator = getAggregatorStats();
    
    // Execution and Decision stats
    const executions = getExecutionLog();
    const decisions = getDecisions();
    const perf = getPerformance();

    // PnL today
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayPerf = perf.filter(p => p.lastUpdated?.startsWith(todayStr));
    const dailyPnl = todayPerf.reduce((s: number, p: { avgPnlPercent?: number }) => s + (p.avgPnlPercent || 0), 0);
    
    // Errors the last hour
    const recentErrors = getLogsByLevel('ERROR', 50).filter(e => {
      const ageMs = Date.now() - new Date(e.ts).getTime();
      return ageMs < 60 * 60_000; 
    });

    const body = {
      system: {
        status: heartbeat?.status || 'UNKNOWN',
        uptime: heartbeat?.uptime || 0,
        memoryUsageRssMB: heartbeat?.memory.rss || 0,
      },
      watchdog,
      heartbeat,
      killSwitch,
      trading: {
        totalSignals: aggregator.total,
        pendingDecisions: aggregator.pendingCount,
        executionsToday: executions.filter(e => e.timestamp.startsWith(todayStr)).length,
        dailyPnlPercent: dailyPnl,
        openPositions: decisions.filter(d => d.outcome === 'PENDING').length,
      },
      logs: {
        recent: getRecentLogs(20),
        errorCount1h: recentErrors.length,
      },
      // Give a tiny trend history to draw a memory/time chart if wanted
      history: getSnapshotHistory(30).map(s => ({ 
        ts: s.timestamp, 
        mem: s.memory.rss, 
        errors: s.errors 
      })),
    };

    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
