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

      interval = setInterval(() => {
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
        } catch {
          // mute
        }
      }, 2000);

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
