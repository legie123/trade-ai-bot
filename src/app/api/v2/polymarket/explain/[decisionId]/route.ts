/**
 * GET /api/v2/polymarket/explain/[decisionId]
 * Returns a single decision row with full factor breakdown + rationale
 * + raw_opportunity snapshot. Use for "Explain why we acted / skipped".
 *
 * FAZA 3.4 per-decision drill-down. Cron-auth because raw_opportunity
 * contains full market JSON including liquidity + internal edge detail.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from '@/lib/core/cronAuth';
import { createLogger } from '@/lib/core/logger';

const log = createLogger('PolyExplain');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supa = (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('placeholder'))
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ decisionId: string }> },
) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const { decisionId } = await ctx.params;
  if (!decisionId) {
    return NextResponse.json({ ok: false, error: 'missing decisionId' }, { status: 400 });
  }

  if (!supa) {
    return NextResponse.json({ ok: false, error: 'supabase_unconfigured' }, { status: 503 });
  }

  try {
    const { data, error } = await supa
      .from('polymarket_decisions')
      .select('*')
      .eq('decision_id', decisionId)
      .maybeSingle();
    if (error) {
      log.warn('select failed', { error: error.message, decisionId });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'not_found', decisionId }, { status: 404 });
    }
    return NextResponse.json({ ok: true, decision: data });
  } catch (err) {
    log.warn('threw', { error: String(err), decisionId });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
