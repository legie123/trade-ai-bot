// POST /api/v2/polymarket/backtest/run — Trigger backtest replay
// Phase 4 — reads settled polymarket_decisions in window, computes
// per-strategy WR/PF/Sharpe, persists to poly_backtest_runs.
//
// Auth: requireCronAuth (CRON_SECRET) so only operators can trigger.
// Body: { strategy_id?: string, sample_start_iso?: string, sample_end_iso?: string, notes?: string }
import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { replayDecisionsForBaseline } from '@/lib/polymarket/backtest/runner';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('BacktestRunRoute');

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      strategy_id?: string;
      sample_start_iso?: string;
      sample_end_iso?: string;
      notes?: string;
    };

    // Default window: last 30 days.
    const end = body.sample_end_iso ?? new Date().toISOString();
    const start =
      body.sample_start_iso ??
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const strategyId = body.strategy_id ?? null;
    const notes = body.notes ?? '';

    log.info('Backtest run requested', { strategyId, start, end, notes });

    const result = await replayDecisionsForBaseline(strategyId, start, end, notes);

    return NextResponse.json({
      status: 'ok',
      result,
      timestamp: Date.now(),
    });
  } catch (e) {
    log.error('Backtest run error', { error: String(e) });
    return NextResponse.json(
      { status: 'error', error: String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    info: 'POST with optional body { strategy_id, sample_start_iso, sample_end_iso, notes }',
    defaultWindow: 'last 30 days',
  });
}
