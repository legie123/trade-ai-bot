// GET /api/btc-signals — run BTC engine, auto-evaluate, return analysis + signals
import { NextResponse } from 'next/server';
import { generateBTCSignals } from '@/lib/engine/btcEngine';
import { evaluatePendingDecisions } from '@/lib/engine/tradeEvaluator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Run BTC engine (generates signals + saves decisions)
    const analysis = await generateBTCSignals();

    // Auto-evaluate pending decisions in background (non-blocking)
    evaluatePendingDecisions()
      .then((res) => {
        if (res.evaluated > 0) {
          console.log(`[Auto-Eval] Evaluated ${res.evaluated}: ${res.wins}W / ${res.losses}L`);
        }
      })
      .catch((err) => console.warn('[Auto-Eval] Error:', err));

    return NextResponse.json({
      status: 'ok',
      btc: {
        price: analysis.price,
        ema50: analysis.ema50,
        ema200: analysis.ema200,
        ema800: analysis.ema800,
        dailyOpen: analysis.dailyOpen,
        psychHigh: analysis.psychHigh,
        psychLow: analysis.psychLow,
        prevHigh: analysis.prevHigh,
        prevLow: analysis.prevLow,
      },
      signals: analysis.signals,
      timestamp: analysis.timestamp,
    });
  } catch (err) {
    console.error('[BTC Engine] Error:', err);
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 }
    );
  }
}

