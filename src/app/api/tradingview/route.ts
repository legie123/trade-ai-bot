// POST /api/tradingview — receive TradingView alerts → Signal Router
import { NextRequest, NextResponse } from 'next/server';
import { signalStore } from '@/lib/store/signalStore';
import { Signal, TradingViewWebhook } from '@/lib/types/radar';
import { routeSignal, normalizeSignalType } from '@/lib/router/signalRouter';
import { createLogger } from '@/lib/core/logger';
import { ManagerVizionar } from '@/lib/v2/manager/managerVizionar';
import { gladiatorStore } from '@/lib/store/gladiatorStore';

const log = createLogger('TradingViewRoute');
const manager = ManagerVizionar.getInstance();

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body: TradingViewWebhook = await request.json();

    // Secure webhook secret auth (OMNI-Audit Protocol)
    const expectedSecret = process.env.TV_SECRET_TOKEN;
    if (!expectedSecret) {
      log.error('TV_SECRET_TOKEN not configured — webhook endpoint disabled for safety');
      return NextResponse.json({ error: 'Webhook not configured. Set TV_SECRET_TOKEN env var.' }, { status: 503 });
    }
    const authHeader = request.headers.get('authorization') || request.headers.get('x-tv-secret');
    if (authHeader !== expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
      log.warn('Unauthorized TradingView Webhook access attempt thwarted');
      return NextResponse.json({ error: 'Unauthorized. TV_SECRET_TOKEN invalid.' }, { status: 401 });
    }

    // Validate required fields
    if (!body.symbol) {
      log.warn('Rejected: missing symbol');
      return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
    }

    // Build raw signal
    const rawSignalText = body.signal || body.message || 'ALERT';
    const normalized = normalizeSignalType(rawSignalText);

    const signal: Signal = {
      id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      symbol: body.symbol.toUpperCase().trim(),
      timeframe: body.timeframe || '—',
      signal: normalized,
      price: body.price || 0,
      timestamp: body.timestamp || new Date().toISOString(),
      source: 'TradingView',
      message: body.message,
    };

    // Route through Signal Router
    const routed = routeSignal(signal);

    // Store the routed signal
    const result = signalStore.addSignal(routed);

    if (!result.added) {
      log.info(`Skipped duplicate: ${routed.symbol} ${routed.signal}`);
      return NextResponse.json({ status: 'skipped', reason: result.reason }, { status: 200 });
    }

    log.info(`Routed: ${routed.direction} ${routed.action} | ${routed.symbol} ${routed.signal} @ ${routed.price} | conf:${routed.confidence}%`);

    // ==========================================
    // PHOENIX V2 ACTIVATION (The Oracle Ritual)
    // ==========================================
    const gladiator = gladiatorStore.findBestGladiator(routed.symbol);
    if (gladiator) {
      log.info(`[V2 TRIGGER] Processing signal with Gladiator: ${gladiator.name} (${gladiator.arena})`);
      // Run asynchrously to avoid blocking the webhook response
      manager.processSignal(gladiator, routed).catch((err: unknown) => {
        log.error('[V2 CRITICAL] Phoenix Process Error', { error: (err as Error).message });
      });
    }

    return NextResponse.json({
      status: 'received',
      signal: {
        id: routed.id,
        symbol: routed.symbol,
        signal: routed.signal,
        direction: routed.direction,
        action: routed.action,
        confidence: routed.confidence,
        price: routed.price,
      },
    });
  } catch (err) {
    log.error('Webhook processing error', { error: (err as Error).message });
    return NextResponse.json(
      { error: 'Invalid webhook payload', detail: (err as Error).message },
      { status: 400 }
    );
  }
}

// GET — return recent signals with routing data
export async function GET() {
  const signals = signalStore.getSignals(50);
  const stats = signalStore.getStats();
  return NextResponse.json({ signals, stats, timestamp: new Date().toISOString() });
}
