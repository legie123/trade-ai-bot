// ============================================================
// Push Notifications — Server-Sent Events (SSE) stream
// Instantly pushes high-confidence signals to connected clients
// ============================================================
import { NextResponse } from 'next/server';
import { signalStore } from '@/lib/store/signalStore';
import { RoutedSignal } from '@/lib/router/signalRouter';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  let interval: NodeJS.Timeout;
  
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue('event: connected\ndata: ok\n\n');

      let lastChecked = Date.now();
      let lastDecisionCheck = Date.now();

      interval = setInterval(async () => {
        try {
          // Check signal store for new signals > 85%
          const signals = signalStore.getSignals(20);
          const newSignals = signals.filter(s => {
            const time = new Date(s.timestamp).getTime();
            return time > lastChecked && (s as RoutedSignal).confidence >= 85; 
          });

          if (newSignals.length > 0) {
            lastChecked = Date.now();
            controller.enqueue(`event: signal\ndata: ${JSON.stringify({ alerts: newSignals })}\n\n`);
          }

          // Calibration #18: Push trade outcomes (WIN/LOSS)
          const { getDecisions } = await import('@/lib/store/db');
          const recentDecisions = getDecisions()
            .filter((d) => 
              d.evaluatedAt && d.outcome !== 'PENDING' &&
              new Date(d.evaluatedAt).getTime() > lastDecisionCheck
            );

          if (recentDecisions.length > 0) {
            lastDecisionCheck = Date.now();
            const outcomes = recentDecisions.map((d) => ({
              symbol: d.symbol,
              signal: d.signal,
              outcome: d.outcome,
              pnlPercent: d.pnlPercent,
            }));
            controller.enqueue(`event: outcome\ndata: ${JSON.stringify({ trades: outcomes })}\n\n`);
          }
        } catch {
          // mute
        }
      }, 3000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
      });
    },
    cancel() {
      if (interval) clearInterval(interval);
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
