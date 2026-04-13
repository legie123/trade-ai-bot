/**
 * GET /api/v2/backtest?gladiatorId=X&simulations=1000
 *
 * Monte Carlo backtesting for a specific gladiator.
 * Resamples historical battle outcomes to produce
 * confidence intervals for equity, drawdown, win rate, ruin probability.
 */
import { NextResponse } from 'next/server';
import { MonteCarloEngine } from '@/lib/v2/superai/monteCarloEngine';
import { createLogger } from '@/lib/core/logger';

export const dynamic = 'force-dynamic';

const log = createLogger('API:Backtest');

export async function GET(request: Request) {
  const url = new URL(request.url);
  const gladiatorId = url.searchParams.get('gladiatorId');
  const simulations = parseInt(url.searchParams.get('simulations') ?? '1000', 10);

  if (!gladiatorId) {
    return NextResponse.json(
      { error: 'gladiatorId query param required' },
      { status: 400 },
    );
  }

  if (simulations < 100 || simulations > 10000) {
    return NextResponse.json(
      { error: 'simulations must be 100–10000' },
      { status: 400 },
    );
  }

  log.info(`[Backtest] Monte Carlo for ${gladiatorId} x${simulations}`);

  try {
    const result = await MonteCarloEngine.run(gladiatorId, simulations);

    return NextResponse.json({
      status: 'ok',
      ...result,
      interpretation: {
        ruinRisk: result.ruinProbability > 15
          ? 'HIGH — this gladiator has significant ruin risk'
          : result.ruinProbability > 5
            ? 'MODERATE — monitor closely'
            : 'LOW — acceptable for live trading',
        medianOutcome: result.equityPaths.p50 > 100
          ? `PROFITABLE — median outcome +${(result.equityPaths.p50 - 100).toFixed(1)}%`
          : `LOSING — median outcome ${(result.equityPaths.p50 - 100).toFixed(1)}%`,
        readyForLive:
          result.ruinProbability < 10 &&
          result.winRateDistribution.mean >= 45 &&
          result.equityPaths.p50 > 100 &&
          result.sampleSize >= 20,
      },
    });
  } catch (err) {
    log.error('[Backtest] Error', { error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
