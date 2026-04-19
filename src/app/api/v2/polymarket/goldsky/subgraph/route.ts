/**
 * GET /api/v2/polymarket/goldsky/subgraph?conditionId=0x...
 *
 * Diagnostic + drill-down: pull on-chain state + recent whale positions for
 * a single market. Used by FAZA 3.5 market drill-down UI and as smoke-test
 * for the goldskyClient pipeline.
 *
 * Auth: cron-only (raw whale wallet addresses are PII-adjacent).
 * Degradation: subgraph unconfigured or null → returns ok=true, fields=null.
 */
import { NextResponse } from 'next/server';
import {
  getMarketOnChainState,
  getRecentWhalePositions,
  getMarketResolution,
  getGoldskyStatus,
} from '@/lib/polymarket/goldskyClient';
import { requireCronAuth } from '@/lib/core/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const conditionId = url.searchParams.get('conditionId');
  const minUsdRaw = url.searchParams.get('minUsd');
  const minUsd = minUsdRaw ? Number.parseFloat(minUsdRaw) : 50_000;

  const status = getGoldskyStatus();
  if (!conditionId) {
    return NextResponse.json({ ok: true, status, note: 'pass conditionId to pull market state' });
  }

  const [state, whales, resolution] = await Promise.all([
    getMarketOnChainState(conditionId),
    getRecentWhalePositions(conditionId, minUsd, 20),
    getMarketResolution(conditionId),
  ]);

  return NextResponse.json({
    ok: true,
    status,
    conditionId,
    onChainState: state,
    whales,
    resolution,
  });
}
