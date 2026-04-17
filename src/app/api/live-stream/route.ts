// ============================================================
// /api/live-stream — Server-Sent Events for dashboard realtime
//
// ADDITIVE. Fulfills the contract of useRealtimeData.ts which subscribes
// here for named events "connected" and "update".
//
// Emits periodic health snapshots composed from existing sources:
//   - getFreshHealthSnapshot()   → provider / error state
//   - getTradingModeSummary()    → PAPER vs LIVE + killSwitch
//   - best-effort dashboard + bot fetched inline (optional, best-effort)
//
// This route does NOT introduce new external calls. It only surfaces
// state already tracked by existing modules.
// ============================================================
import { getFreshHealthSnapshot } from '@/lib/core/heartbeat';
import { getTradingModeSummary } from '@/lib/core/tradingMode';
import { createLogger } from '@/lib/core/logger';
import { polyWsClient } from '@/lib/polymarket/polyWsClient';
import { WsStreamManager } from '@/lib/providers/wsStreams';

const log = createLogger('LiveStream');

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TICK_MS = 5000;
const MAX_DURATION_MS = 5 * 60 * 1000; // 5 min per connection; browser reconnects

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  // AUDIT FIX T4: Lift cleanup state to outer scope so cancel() can access it
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
        })
      );

      const tick = async () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_DURATION_MS) {
          safeEnqueue(sseEvent('bye', { reason: 'max_duration' }));
          closed = true;
          try { controller.close(); } catch { /* noop */ }
          return;
        }

        const health = getFreshHealthSnapshot();
        const mode = getTradingModeSummary();
        const feeds = {
          polymarketWs: polyWsClient.getFeedHealth(),
          mexcWs: WsStreamManager.getInstance().getFeedHealth(),
        };

        // Compose payload shape loosely matching RealtimePayload (hook tolerates partial)
        const payload = {
          dashboard: {
            lastHealth: health,
            tradingMode: mode,
            feeds,
            timestamp: Date.now(),
          },
          bot: {
            // bot stats intentionally omitted here; the hook merges partial updates
            timestamp: Date.now(),
          },
          signals: [],
          meta: {
            source: 'live-stream',
            tickMs: TICK_MS,
            age: Date.now() - startedAt,
          },
        };

        safeEnqueue(sseEvent('update', payload));
      };

      // Fire first update immediately for snappy UI
      await tick();

      interval = setInterval(tick, TICK_MS);
      // Heartbeat comment every 15s to keep intermediaries happy
      heartbeat = setInterval(() => safeEnqueue(':hb\n\n'), 15000);

      // Max duration safety net
      shutdownTimer = setTimeout(() => {
        cleanup();
        try { controller.close(); } catch { /* noop */ }
      }, MAX_DURATION_MS + 1000);
    },
    cancel() {
      // AUDIT FIX T4: Properly clean up all intervals on client disconnect
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
