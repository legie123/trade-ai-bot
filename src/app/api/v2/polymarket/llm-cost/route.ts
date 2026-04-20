/**
 * /api/v2/polymarket/llm-cost — per-market LLM attribution snapshot.
 *
 * FAZA 3.3. Thin GET wrapper around getLlmCostSnapshot(). Process-local
 * view — each Cloud Run instance has its own window. For cluster-wide
 * aggregate use Prom `llmCostDollars` summed across instances.
 *
 * Query params:
 *   ?top=N  — limit topSpenders list (default 50, max 200)
 *
 * Response:
 *   - totals: calls, tokens, dollars
 *   - byProvider / byRole breakdowns
 *   - topSpenders ranked by dollars
 *   - markets[] full list (capped by tracker MAX_MARKETS = 5000)
 *
 * Cache-Control: no-store. Never throws — error path returns 200 with
 * tracking:false when tracker disabled.
 */
import { NextResponse } from 'next/server';
import { getLlmCostSnapshot } from '@/lib/polymarket/llmCostTracker';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const topParam = Number(url.searchParams.get('top') ?? '50');
    const top = Number.isFinite(topParam) ? Math.max(1, Math.min(200, topParam)) : 50;

    const snap = getLlmCostSnapshot(top);
    return NextResponse.json(snap, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Llm-Cost-Tracking': String(snap.tracking),
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        generatedAt: Date.now(),
        tracking: false,
        totalMarkets: 0,
        totalCalls: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        byProvider: {},
        byRole: {},
        markets: [],
        topSpenders: [],
        error: (e as Error).message,
      },
      { status: 500 }
    );
  }
}
