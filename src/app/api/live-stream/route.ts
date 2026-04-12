// ============================================================
// GET /api/live-stream — Server-Sent Events (SSE) endpoint
// Pushes merged dashboard + bot data every 3 seconds
// ============================================================
import { initDB, getDecisions, getDecisionsToday, getPerformance, getOptimizerState, getBotConfig, getEquityCurve, getSyndicateAudits, getLivePositions, getSyncQueueStats } from '@/lib/store/db';
import { getWatchdogState, watchdogPing } from '@/lib/core/watchdog';
import { getFreshHealthSnapshot, startHeartbeat } from '@/lib/core/heartbeat';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { getRecentLogs } from '@/lib/core/logger';
import { gladiatorStore } from '@/lib/store/gladiatorStore';
import { getMoltbookTelemetry } from '@/lib/moltbook/moltbookClient';

export const dynamic = 'force-dynamic';

const PUSH_INTERVAL_MS = 3000;
const GENESIS_TIMESTAMP = 1775260800000;

function buildPayload() {
  startHeartbeat();
  watchdogPing();

  const watchdog = getWatchdogState();
  const heartbeat = getFreshHealthSnapshot();
  const killSwitch = getKillSwitchState();
  const decisions = getDecisions();
  const todayDecisions = getDecisionsToday();
  const config = getBotConfig();
  const performance = getPerformance();
  const optimizer = getOptimizerState();
  const recentLogs = getRecentLogs(20);
  const memUsageMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const gladiators = gladiatorStore.getGladiators();
  const activeGladiators = gladiators.filter(g => g.isLive).length;
  const uptimeSeconds = (Date.now() - GENESIS_TIMESTAMP) / 1000;
  const heartbeatStatus = heartbeat?.status || 'YELLOW';
  const isSystemHealthy = watchdog.status === 'HEALTHY' && !killSwitch.engaged && heartbeatStatus !== 'RED';

  const systemStatus = killSwitch.engaged ? 'HALTED (KILL SWITCH)'
    : watchdog.status === 'DEAD' ? 'CRITICAL — Watchdog Dead'
    : heartbeatStatus === 'RED' ? 'DEGRADED — Heartbeat Red'
    : isSystemHealthy ? 'LIVE - SUPER AI OMEGA'
    : 'WARNING';

  // Trading stats from decisions
  const todayEvaluated = todayDecisions.filter(d => d.outcome !== 'PENDING');
  const evaluated = decisions.filter(d => d.outcome !== 'PENDING');
  const wins = evaluated.filter(d => d.outcome === 'WIN').length;
  const todayWins = todayEvaluated.filter(d => d.outcome === 'WIN').length;
  const totalPnl = evaluated.reduce((s, d) => s + (d.pnlPercent || 0), 0);
  const todayPnl = todayEvaluated.reduce((s, d) => s + (d.pnlPercent || 0), 0);
  const pendingDecisions = decisions.filter(d => d.outcome === 'PENDING').length;

  // Live positions for position tracking
  const activePositions = getLivePositions().filter(p => p.status === 'OPEN');

  // Streak
  let streak = 0;
  let streakType: 'WIN' | 'LOSS' | 'NONE' = 'NONE';
  for (const d of evaluated) {
    if (d.outcome === 'WIN' || d.outcome === 'LOSS') {
      if (streak === 0) { streakType = d.outcome; streak = 1; }
      else if (d.outcome === streakType) streak++;
      else break;
    }
  }

  // Max drawdown
  let maxDrawdown = 0, currentDraw = 0;
  for (const d of evaluated) {
    if (d.outcome === 'LOSS') { currentDraw += Math.abs(d.pnlPercent || 0); maxDrawdown = Math.max(maxDrawdown, currentDraw); }
    else currentDraw = 0;
  }

  // Strategy health
  const recentWinRate = evaluated.length >= 10 ? (evaluated.slice(0, 10).filter(d => d.outcome === 'WIN').length / 10) * 100 : -1;
  let strategyHealth = 'GOOD';
  if (recentWinRate >= 60) strategyHealth = 'EXCELLENT';
  else if (recentWinRate >= 45) strategyHealth = 'GOOD';
  else if (recentWinRate >= 30) strategyHealth = 'CAUTION';
  else if (recentWinRate >= 0) strategyHealth = 'CRITICAL';

  // Floating PnL
  let floatingPnlValue = 0;
  for (const pos of activePositions) {
    if (pos.currentPrice && pos.entryPrice) {
      const rawDiff = pos.currentPrice - pos.entryPrice;
      const diffPercent = (rawDiff / pos.entryPrice) * 100;
      const pnlPercent = pos.side === 'LONG' ? diffPercent : -diffPercent;
      const currentBalance = config.paperBalance || 1000;
      floatingPnlValue += currentBalance * (20 / 100) * (pnlPercent / 100);
    }
  }

  const baseEquityCurve = getEquityCurve();

  return {
    dashboard: {
      system: {
        status: systemStatus, uptime: uptimeSeconds, memoryUsageRssMB: memUsageMB,
        syncQueue: getSyncQueueStats(),
        moltbook: getMoltbookTelemetry(),
        modulesActive: activeGladiators,
        feedsLive: heartbeat?.providers ? Object.values(heartbeat.providers).filter((p: { ok: boolean }) => p.ok).length : 0,
      },
      watchdog: { status: watchdog.status, crashCount: watchdog.crashCount, alive: watchdog.alive },
      heartbeat: heartbeat ? { status: heartbeat.status, providers: heartbeat.providers, scanLoop: heartbeat.scanLoop, memory: heartbeat.memory } : null,
      killSwitch: { engaged: killSwitch.engaged, reason: killSwitch.reason },
      trading: {
        totalSignals: decisions.length,
        pendingDecisions,
        executionsToday: todayEvaluated.length,
        dailyPnlPercent: Math.round(todayPnl * 100) / 100,
        openPositions: activePositions.length, // REAL open positions, not pending decisions
      },
      logs: {
        recent: recentLogs.map((l: { ts: string; level: string; module: string; msg: string }) => ({
          ts: l.ts || new Date().toISOString(), level: l.level || 'INFO', msg: `[${l.module}] ${l.msg}`,
        })),
        errorCount1h: recentLogs.filter((l: { level: string }) => l.level === 'ERROR' || l.level === 'FATAL').length,
      },
      history: [],
    },
    bot: {
      status: 'ok',
      version: 'Phoenix V2 (GTC)',
      stats: {
        mode: config.mode,
        totalDecisions: decisions.length,
        todayDecisions: todayDecisions.length,
        overallWinRate: evaluated.length > 0 ? Math.round((wins / evaluated.length) * 100) : 0,
        todayWinRate: todayEvaluated.length > 0 ? Math.round((todayWins / todayEvaluated.length) * 100) : 0,
        totalPnlPercent: Math.round(totalPnl * 100) / 100,
        todayPnlPercent: Math.round(todayPnl * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        currentStreak: streak,
        streakType,
        strategyHealth,
        optimizerVersion: optimizer.version,
        lastOptimized: optimizer.lastOptimizedAt,
      },
      decisions: decisions.slice(0, 50),
      performance,
      gladiators,
      syndicateAudits: getSyndicateAudits().slice(0, 50),
      v2Entities: {
        masters: [
          { id: 'master_gemini', name: 'GPT-4o (Architect)', role: 'Master Principal (Architect)', status: process.env.OPENAI_API_KEY ? 'ONLINE' : 'NO_API_KEY', power: 100 },
          { id: 'master_fallback', name: 'GPT-4o (Oracle)', role: 'Oracle (Sentiment)', status: process.env.OPENAI_API_KEY ? 'ONLINE' : 'NO_API_KEY', power: 80 },
          { id: 'master_deepseek', name: 'DeepSeek-R1', role: 'Math Logic', status: 'ACTIVE', power: 85 },
        ],
        manager: { name: 'Manager Vizionar', role: 'Gatekeeper Tehnic', status: todayDecisions.length > 0 ? 'ORCHESTRATING' : 'IDLE', description: todayDecisions.length > 0 ? `Processing ${todayDecisions.length} decisions today.` : 'Waiting for market signals.' },
        sentinels: {
          riskShield: { name: 'Risk Sentinel', limit: '15% MDD', active: true, triggered: maxDrawdown >= 15 },
          lossDaily: { name: 'Loss Sentinel', limit: '5 Pierderi/Zi', active: true, triggered: todayEvaluated.filter(d => d.outcome === 'LOSS').length >= 5 },
        },
        promoter: { name: 'Social Broadcaster', role: 'Moltbook Network Hook', status: process.env.MOLTBOOK_API_KEY ? 'READY' : 'NO_API_KEY' },
        scouts: { name: 'Alpha Scouts', role: 'OSINT Gatherer', status: 'SCANNING' },
      },
      activePositions: activePositions.map(p => ({ symbol: p.symbol, side: p.side, entryPrice: p.entryPrice, size: 0.20 })),
      optimizer,
      config,
      equityCurve: baseEquityCurve,
      floatingPnl: floatingPnlValue,
      balance: (baseEquityCurve.length > 0 ? baseEquityCurve[baseEquityCurve.length - 1].balance : config.paperBalance || 1000),
    },
    signals: [],
    _meta: {
      timestamp: new Date().toISOString(),
      streamVersion: 'sse-v1',
      nextPushMs: PUSH_INTERVAL_MS,
    },
  };
}

export async function GET() {
  await initDB();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      controller.enqueue(encoder.encode(`event: connected\ndata: {"status":"ok"}\n\n`));

      // Push data immediately then every interval
      const push = () => {
        try {
          const payload = buildPayload();
          controller.enqueue(encoder.encode(`event: update\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch (err) {
          console.error('[SSE] Push error:', err);
        }
      };

      push(); // immediate first push

      const interval = setInterval(push, PUSH_INTERVAL_MS);

      // Clean up on client disconnect (detected via closed signal)
      const cleanup = () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      };

      // Timeout after 5 minutes to prevent zombie connections on Cloud Run
      setTimeout(cleanup, 5 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
