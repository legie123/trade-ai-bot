/**
 * Arena 4 — Execution
 * POST /api/a2a/execution
 *
 * Places orders on MEXC (live) or logs phantom trades (paper).
 * Delegates to the existing phantom/live trade execution pipeline.
 */
import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/core/logger';
import { addPhantomTrade } from '@/lib/store/db';

export const dynamic = 'force-dynamic';

const log = createLogger('Arena:Execution');

interface ExecutionRequest {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  positionSize: number;         // USD
  entry?: number;               // Price (optional, uses market if omitted)
  stopLoss?: number;            // Price
  takeProfit?: number;          // Price
  confidence: number;           // 0–1
  mode?: 'LIVE' | 'PHANTOM';   // Default: PHANTOM unless confidence > 0.80 and isLive
  gladiatorId?: string;         // Which gladiator triggered this
}

interface ExecutionResult {
  arena: 'execution';
  orderId: string;
  symbol: string;
  direction: string;
  mode: 'LIVE' | 'PHANTOM';
  status: 'FILLED' | 'PENDING' | 'REJECTED';
  executedAt: number;
  positionSize: number;
  message: string;
}

function verifyToken(request: Request): boolean {
  const token = process.env.SWARM_TOKEN;
  if (!token) return true;
  return request.headers.get('x-swarm-token') === token;
}

export async function POST(request: Request): Promise<NextResponse<ExecutionResult | { error: string }>> {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ExecutionRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    symbol,
    direction,
    positionSize,
    confidence,
    stopLoss,
    takeProfit,
    mode,
    gladiatorId,
  } = body;

  if (!symbol || !direction || positionSize == null || confidence == null) {
    return NextResponse.json(
      { error: 'symbol, direction, positionSize, confidence required' },
      { status: 400 }
    );
  }

  log.info(`[Execution] ${mode ?? 'AUTO'} ${direction} ${symbol} size=${positionSize} conf=${confidence}`);

  try {
    // Determine execution mode:
    // LIVE if explicitly requested AND confidence is high enough
    // Otherwise PHANTOM (safe default)
    const isLiveMode = mode === 'LIVE' && confidence >= 0.75;
    const effectiveMode: 'LIVE' | 'PHANTOM' = isLiveMode ? 'LIVE' : 'PHANTOM';

    if (effectiveMode === 'PHANTOM') {
      const tradeId = `a2a-${gladiatorId ?? 'ext'}-${symbol}-${Date.now()}`;

      addPhantomTrade({
        id: tradeId,
        gladiatorId: gladiatorId ?? 'a2a-external',
        symbol,
        signal: direction,
        entryPrice: body.entry ?? 0,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        arena: 'execution',
        orderId: tradeId,
        symbol,
        direction,
        mode: 'PHANTOM',
        status: 'FILLED',
        executedAt: Date.now(),
        positionSize,
        message: `Phantom trade registered. Evaluates on next price tick.`,
      });
    }

    // LIVE execution — uses MEXC API
    // Delegate to existing live trade execution (POST /api/v2/trade)
    const origin = process.env.SERVICE_URL ?? 'http://localhost:3000';
    const tradeRes = await fetch(`${origin}/api/v2/trade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': process.env.INTERNAL_TOKEN ?? '',
      },
      body: JSON.stringify({
        symbol,
        direction,
        confidence,
        positionSize,
        stopLoss,
        takeProfit,
        source: 'a2a-execution-arena',
        gladiatorId: gladiatorId ?? 'a2a-external',
      }),
    });

    if (!tradeRes.ok) {
      const err = await tradeRes.text();
      log.error(`[Execution] Live trade failed: ${err}`);
      return NextResponse.json({ error: `Live execution failed: ${err}` }, { status: 502 });
    }

    const tradeData = await tradeRes.json() as { orderId?: string; status?: string };

    return NextResponse.json({
      arena: 'execution',
      orderId: tradeData.orderId ?? `live-${Date.now()}`,
      symbol,
      direction,
      mode: 'LIVE',
      status: 'FILLED',
      executedAt: Date.now(),
      positionSize,
      message: `Live order placed on MEXC.`,
    });

  } catch (err) {
    log.error('[Execution] Error', { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    arena: 'execution',
    status: 'ready',
    description: 'Order placement and management arena (MEXC live + phantom)',
    accepts: 'POST { symbol, direction, positionSize, confidence, entry?, stopLoss?, takeProfit?, mode?, gladiatorId? }',
  });
}
