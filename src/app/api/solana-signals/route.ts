// GET /api/solana-signals — run Solana multi-coin engine
import { NextResponse } from 'next/server';
import { analyzeMultiCoin } from '@/lib/engine/solanaEngine';
import { evaluatePendingDecisions } from '@/lib/engine/tradeEvaluator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await analyzeMultiCoin();

    // Auto-evaluate pending decisions (non-blocking)
    evaluatePendingDecisions()
      .then((res) => {
        if (res.evaluated > 0) {
          console.log(`[Auto-Eval] Evaluated ${res.evaluated}: ${res.wins}W / ${res.losses}L`);
        }
      })
      .catch((err) => console.warn('[Auto-Eval] Error:', err));

    return NextResponse.json({
      status: 'ok',
      coins: result.coins,
      totalSignals: result.totalSignals,
      timestamp: result.timestamp,
    });
  } catch (err) {
    console.error('[Solana Engine] Error:', err);
    return NextResponse.json(
      { status: 'error', error: (err as Error).message },
      { status: 500 }
    );
  }
}
