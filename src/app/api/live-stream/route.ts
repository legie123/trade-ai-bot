// ============================================================
// GET /api/live-stream — Unified Real-Time SSE Stream
// Pushes dashboard, bot stats, signals, health, and alerts
// every 3 seconds to all connected clients.
// ============================================================
import { NextResponse } from 'next/server';
import { getWatchdogState } from '@/lib/core/watchdog';
import { getHealthSnapshot, getSnapshotHistory } from '@/lib/core/heartbeat';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { getRecentLogs, getLogsByLevel } from '@/lib/core/logger';
import { getExecutionLog } from '@/lib/engine/executor';
import { getDecisions, getBotConfig, getEquityCurve, getPerformance, getOptimizerState } from '@/lib/store/db';
import { getAggregatorStats } from '@/lib/engine/signalAggregator';
import { signalStore } from '@/lib/store/signalStore';

export const dynamic = 'force-dynamic';

const PUSH_INTERVAL_MS = 3_000; // push every 3 seconds

function buildPayload() {
  try {
    const watchdog = getWatchdogState();
    const heartbeat = getHealthSnapshot();
    const killSwitch = getKillSwitchState();
    const aggregator = getAggregatorStats();
    const executions = getExecutionLog();
    const decisions = getDecisions();
    const perf = getPerformance();
    const config = getBotConfig();
    const equityCurve = getEquityCurve();
    const optimizerState = getOptimizerState();

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayPerf = perf.filter((p: { lastUpdated?: string }) => p.lastUpdated?.startsWith(todayStr));
    const dailyPnl = todayPerf.reduce((s: number, p: { avgPnlPercent?: number }) => s + (p.avgPnlPercent || 0), 0);

    const recentErrors = getLogsByLevel('ERROR', 50).filter((e: { ts: string }) => {
      const ageMs = Date.now() - new Date(e.ts).getTime();
      return ageMs < 60 * 60_000;
    });

    const evaluated = decisions.filter((d: { outcome: string }) => d.outcome !== 'PENDING');
    const totalPnl = evaluated.reduce((s: number, d: { pnlPercent: number | null }) => s + (d.pnlPercent || 0), 0);
    const winRate = evaluated.length > 0
      ? Math.round((evaluated.filter((d: { outcome: string }) => d.outcome === 'WIN').length / evaluated.length) * 100)
      : 0;

    const lastBalance = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].balance : config.paperBalance;

    // Today's decisions
    const todayDecisions = decisions.filter((d: { timestamp: string }) => d.timestamp.startsWith(todayStr));
    const todayWins = todayDecisions.filter((d: { outcome: string }) => d.outcome === 'WIN').length;
    const todayEval = todayDecisions.filter((d: { outcome: string }) => d.outcome !== 'PENDING');
    const todayWinRate = todayEval.length > 0
      ? Math.round((todayWins / todayEval.length) * 100)
      : 0;
    const todayPnlPercent = todayDecisions.reduce((s: number, d: { pnlPercent: number | null }) => s + (d.pnlPercent || 0), 0);

    // Streak calculation
    let currentStreak = 0;
    let streakType = 'NONE';
    if (evaluated.length > 0) {
      const sorted = [...evaluated].sort((a: { timestamp: string }, b: { timestamp: string }) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      streakType = sorted[0].outcome === 'WIN' ? 'WIN' : 'LOSS';
      for (const d of sorted) {
        if (d.outcome === streakType) currentStreak++;
        else break;
      }
    }

    // Strategy health
    let strategyHealth = 'GOOD';
    if (winRate >= 60) strategyHealth = 'EXCELLENT';
    else if (winRate >= 45) strategyHealth = 'GOOD';
    else if (winRate >= 30) strategyHealth = 'CAUTION';
    else if (evaluated.length > 5) strategyHealth = 'CRITICAL';

    // Max drawdown from equity curve
    let maxDrawdown = 0;
    let peak = config.paperBalance;
    for (const pt of equityCurve) {
      if (pt.balance > peak) peak = pt.balance;
      const dd = ((peak - pt.balance) / peak) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const signals = signalStore.getSignals(20);

    return {
      // Dashboard section
      dashboard: {
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
          executionsToday: executions.filter((e: { timestamp: string }) => e.timestamp.startsWith(todayStr)).length,
          dailyPnlPercent: Math.round(dailyPnl * 100) / 100,
          openPositions: decisions.filter((d: { outcome: string }) => d.outcome === 'PENDING').length,
        },
        logs: {
          recent: getRecentLogs(20),
          errorCount1h: recentErrors.length,
        },
        history: getSnapshotHistory(30).map((s: { timestamp: string; memory: { rss: number }; errors: number }) => ({
          ts: s.timestamp,
          mem: s.memory.rss,
          errors: s.errors,
        })),
      },

      // Bot stats section
      bot: {
        stats: {
          mode: config.mode || 'PAPER',
          totalDecisions: decisions.length,
          todayDecisions: todayDecisions.length,
          overallWinRate: winRate,
          todayWinRate,
          totalPnlPercent: Math.round(Number(totalPnl) * 100) / 100,
          todayPnlPercent: Math.round(Number(todayPnlPercent) * 100) / 100,
          maxDrawdown: Math.round(maxDrawdown * 100) / 100,
          currentStreak,
          streakType,
          strategyHealth,
          optimizerVersion: optimizerState.version || 0,
          lastOptimized: optimizerState.lastOptimizedAt || null,
        },
        decisions: decisions.slice(0, 20),
        performance: perf,
        config: {
          mode: config.mode,
          autoOptimize: config.autoOptimize,
          paperBalance: config.paperBalance,
          riskPerTrade: config.riskPerTrade,
          maxOpenPositions: config.maxOpenPositions,
        },
        equityCurve,
        balance: Math.round(lastBalance * 100) / 100,
      },

      // Signals section
      signals: signals.slice(0, 10),

      // Meta
      _meta: {
        timestamp: new Date().toISOString(),
        streamVersion: '1.0',
        nextPushMs: PUSH_INTERVAL_MS,
      },
    };
  } catch (err) {
    return { error: (err as Error).message, _meta: { timestamp: new Date().toISOString() } };
  }
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      controller.enqueue(encoder.encode('event: connected\ndata: {"status":"connected","interval":' + PUSH_INTERVAL_MS + '}\n\n'));

      // Immediately push first payload
      try {
        const payload = buildPayload();
        controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(payload)}\n\n`));
      } catch { /* initial push failed, will retry */ }

      // Push updates at interval
      interval = setInterval(() => {
        try {
          const payload = buildPayload();
          controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // silent — skip this push
        }
      }, PUSH_INTERVAL_MS);

      // Heartbeat keep-alive every 15s
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch { /* */ }
      }, 15_000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clearInterval(heartbeatInterval);
      });
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
