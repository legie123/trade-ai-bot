/**
 * GET /api/v2/polymarket/markets/[marketId]/decisions?limit=100
 * Returns decision history for a single Polymarket market.
 *
 * FAZA 3.4 drill-down for market-level replay. Useful to see how the
 * correlation verdict evolved as liquidity / whale flows shifted.
 * Cron-auth only.
 */
import { NextResponse } from 'next/server';
import { supabase as supa, SUPABASE_CONFIGURED } from '@/lib/store/db';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyMarketDecisions');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ marketId: string }> },
) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const { marketId } = await ctx.params;
  if (!marketId) {
    return NextResponse.json({ ok: false, error: 'missing marketId' }, { status: 400 });
  }

  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json({ ok: false, error: 'supabase_unconfigured' }, { status: 503 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 500);
  const sinceIso = url.searchParams.get('since');

  try {
    let q = supa
      .from('polymarket_decisions')
      .select('decision_id, gladiator_id, division, direction, confidence, edge_score, goldsky_confirm, moltbook_karma, liquidity_sanity, final_score, acted, skip_reason, run_id, decided_at')
      .eq('market_id', marketId)
      .order('decided_at', { ascending: false })
      .limit(limit);
    if (sinceIso) q = q.gte('decided_at', sinceIso);

    const { data, error } = await q;
    if (error) {
      log.warn('select failed', { error: error.message, marketId });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      marketId,
      count: data?.length ?? 0,
      decisions: data ?? [],
    });
  } catch (err) {
    log.warn('threw', { error: String(err), marketId });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
