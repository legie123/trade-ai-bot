// ============================================================
// /api/live-stream — Server-Sent Events for dashboard realtime
//
// CONTRACT WITH useRealtimeData.ts:
//   event: 'connected' — initial handshake
//   event: 'update'    — payload matches RealtimePayload:
//     {
//       dashboard: {
//         system: { status, uptime, memoryUsageRssMB, ... },
//         watchdog: { status, crashCount, alive },
//         heartbeat: { status, providers } | null,
//         killSwitch: { engaged, reason },
//         trading: { totalSignals, pendingDecisions, executionsToday, dailyPnlPercent, openPositions },
//         logs: { recent: [...], errorCount1h },
//         history: [...]
//       },
//       bot: {...},
//       signals: [...],
//       _meta: { timestamp, streamVersion, nextPushMs }
//     }
//
// 2026-04-19 fix: previous implementation emitted `{dashboard: {lastHealth, tradingMode, feeds}}`
// which did NOT match the hook contract → dashboard showed UNKNOWN for every status field
// because `dash.heartbeat`, `dash.watchdog`, `dash.killSwitch`, `dash.logs` were all undefined.
// ============================================================
import { getFreshHealthSnapshot, startHeartbeat } from '@/lib/core/heartbeat';
import { getTradingModeSummary } from '@/lib/core/tradingMode';
import { getWatchdogState, watchdogPing } from '@/lib/core/watchdog';
import { getKillSwitchState } from '@/lib/core/killSwitch';
import { getRecentLogs } from '@/lib/core/logger';
import {
  getDecisions, getLivePositions, getEquityCurve, getBotConfig, getSyncQueueStats, initDB,
} from '@/lib/store/db';
import { createLogger } from '@/lib/core/logger';
import { polyWsClient } from '@/lib/polymarket/polyWsClient';
import { WsStreamManager } from '@/lib/providers/wsStreams';

const log = createLogger('LiveStream');

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TICK_MS = 3000;
const MAX_DURATION_MS = 5 * 60 * 1000; // 5 min per connection; browser reconnects

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Build the full RealtimePayload the UI expects. Mirrors /api/dashboard shape 1:1
// so the top status bar (STREAM / HEARTBEAT / WATCHDOG / KILL SW / SUPABASE) reads
// real runtime values instead of falling back to "UNKNOWN".
function buildPayload() {
  // Self-heal per tick: keep watchdog alive + heartbeat instantiated.
  // Cheap on warm instances; safe on cold ones (idempotent).
  try { startHeartbeat(); } catch { /* noop */ }
  try { watchdogPing(); } catch { /* noop */ }

  const watchdog = getWatchdogState();
  const heartbeat = getFreshHealthSnapshot();
  const killSwitch = getKillSwitchState();
  const mode = getTradingModeSummary();
  const recentLogs = getRecentLogs(40);

  const decisions = getDecisions();
  const today = new Date().toISOString().slice(0, 10);
  // C15-style guard: never trust that d.timestamp is a string.
  const todayDecisions = decisions.filter(d =>
    typeof d.timestamp === 'string' &&
    d.timestamp.startsWith(today) &&
    d.outcome !== 'PENDING'
  );
  const dailyPnlPercent = todayDecisions.reduce((acc, d) => acc + (d.pnlPercent || 0), 0);
  const pendingDecisions = decisions.filter(d => d.outcome === 'PENDING').length;
  const openPositions = getLivePositions().filter(p => p.status === 'OPEN').length;

  const memUsageMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  // V2 Genesis Timestamp used throughout the app — keep parity with /api/dashboard.
  const GENESIS_TIMESTAMP = 1775260800000;
  const uptimeSeconds = (Date.now() - GENESIS_TIMESTAMP) / 1000;

  const heartbeatStatus = heartbeat?.status || 'YELLOW';
  const botConfig = getBotConfig();
  const isHalted = botConfig.haltedUntil && new Date(botConfig.haltedUntil) > new Date();
  const isSystemHealthy =
    watchdog.status === 'HEALTHY' && !killSwitch.engaged && heartbeatStatus !== 'RED';
  const systemStatus = killSwitch.engaged ? 'HALTED (KILL SWITCH)'
    : isHalted ? `HALTED — Cooldown until ${new Date(botConfig.haltedUntil!).toLocaleTimeString()}`
    : watchdog.status === 'DEAD' ? 'CRITICAL — Watchdog Dead'
    : heartbeatStatus === 'RED' ? 'DEGRADED — Heartbeat Red'
    : botConfig.mode === 'OBSERVATION' ? 'OBSERVATION — No Execution'
    : isSystemHealthy ? 'LIVE - SUPER AI OMEGA'
    : 'WARNING';

  const feeds = {
    polymarketWs: polyWsClient.getFeedHealth(),
    mexcWs: WsStreamManager.getInstance().getFeedHealth(),
  };

  return {
    dashboard: {
      system: {
        status: systemStatus,
        uptime: uptimeSeconds,
        memoryUsageRssMB: memUsageMB,
        syncQueue: getSyncQueueStats(),
        feedsLive: heartbeat?.providers
          ? Object.values(heartbeat.providers).filter((p: { ok: boolean }) => p.ok).length
          : 0,
        streamStatus: heartbeat?.scanLoop?.running ? 'STREAMING' : 'IDLE',
        runtimeHealth: heartbeatStatus,
        lastSync: heartbeat?.timestamp || new Date().toISOString(),
      },
      watchdog: {
        status: watchdog.status,
        crashCount: watchdog.crashCount,
        alive: watchdog.alive,
        lastPing: watchdog.lastPing,
      },
      heartbeat: heartbeat ? {
        status: heartbeat.status,
        providers: heartbeat.providers,
        scanLoop: heartbeat.scanLoop,
        memory: heartbeat.memory,
      } : null,
      killSwitch: {
        engaged: killSwitch.engaged,
        reason: killSwitch.reason,
      },
      trading: {
        totalSignals: decisions.length,
        pendingDecisions,
        executionsToday: todayDecisions.length,
        dailyPnlPercent: Math.round(dailyPnlPercent * 100) / 100,
        openPositions,
      },
      logs: {
        recent: recentLogs.map(l => ({
          ts: l.ts || new Date().toISOString(),
          level: l.level || 'INFO',
          msg: `[${l.module}] ${l.msg}`,
        })),
        errorCount1h: recentLogs.filter(l => l.level === 'ERROR' || l.level === 'FATAL').length,
      },
      history: getEquityCurve(),
      tradingMode: mode,
      feeds,
    },
    bot: {
      timestamp: Date.now(),
    },
    signals: [],
    _meta: {
      timestamp: new Date().toISOString(),
      streamVersion: '2',
      nextPushMs: TICK_MS,
    },
  };
}

export async function GET() {
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  // Ensure Supabase cache is hydrated BEFORE first tick so stats are accurate.
  try { await initDB(); } catch (e) { log.warn('initDB failed', { error: String(e) }); }

  let closed = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    closed = true;
    if (interval) clearInterval(interval);
    if (heartbeat) clearInterval(heartbeat);
    if (shutdownTimer) clearTimeout(shutdownTimer);
    interval = null;
    heartbeat = null;
    shutdownTimer = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch (e) {
          log.warn('enqueue failed', { error: String(e) });
          closed = true;
        }
      };

      // Initial "connected" event — matches hook contract
      safeEnqueue(
        sseEvent('connected', {
          ok: true,
          startedAt,
          tickMs: TICK_MS,
          streamVersion: '2',
        })
      );

      const tick = () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_DURATION_MS) {
          safeEnqueue(sseEvent('bye', { reason: 'max_duration' }));
          closed = true;
          try { controller.close(); } catch { /* noop */ }
          return;
        }
        try {
          const payload = buildPayload();
          safeEnqueue(sseEvent('update', payload));
        } catch (err) {
          log.warn('tick build failed', { error: String(err) });
          // Emit minimal heartbeat so client doesn't see stale data & triggers reconnect.
          safeEnqueue(sseEvent('update', {
            dashboard: null,
            bot: null,
            signals: [],
            _meta: { timestamp: new Date().toISOString(), streamVersion: '2', nextPushMs: TICK_MS, error: String(err) },
          }));
        }
      };

      // Fire first update immediately for snappy UI
      tick();

      interval = setInterval(tick, TICK_MS);
      // Heartbeat comment every 15s to keep intermediaries happy (Cloud Run / nginx)
      heartbeat = setInterval(() => safeEnqueue(':hb\n\n'), 15000);

      // Max duration safety net
      shutdownTimer = setTimeout(() => {
        cleanup();
        try { controller.close(); } catch { /* noop */ }
      }, MAX_DURATION_MS + 1000);
    },
    cancel() {
      cleanup();
      log.info('live-stream client disconnected — intervals cleared');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
