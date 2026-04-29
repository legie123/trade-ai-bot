/**
 * GET /api/v2/polymarket/budget-status — FAZA 3.16 Decision Budget Gate probe.
 *
 * Reports rolling 24h LLM spend vs configured cap + verdict. Headers surface
 * the verdict for cheap cron/Grafana probes without JSON parse.
 *
 * Soft-fail: never returns 5xx. On error the classifier returns verdict='unknown'
 * with error context in payload.
 */
import { NextResponse } from 'next/server';
import { getDecisionBudgetState } from '@/lib/polymarket/decisionBudget';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const state = await getDecisionBudgetState();
    return NextResponse.json(state, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Budget-Verdict': state.verdict,
        'X-Budget-Enabled': state.enabled ? '1' : '0',
        'X-Budget-Used-Usd': state.usedUsd.toFixed(4),
        'X-Budget-Cap-Usd': state.capUsd.toFixed(4),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'budget_status_failed', message: (err as Error).message },
      { status: 500 }
    );
  }
}
