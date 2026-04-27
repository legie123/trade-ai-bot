/**
 * GET /api/v2/polymarket/brain-status-history
 *
 * Batch 3.18b — drill-down reader over the Brain Status snapshot log
 * (`polymarket_brain_status_log`, populated by src/lib/polymarket/brainStatusLog.ts).
 *
 * Soft-fail contract:
 *  - If `BRAIN_STATUS_LOG_ENABLED` is off, OR the table does not exist yet
 *    (operator hasn't applied migration 20260420_polymarket_brain_status_log.sql),
 *    OR Supabase is not configured, we return a 200 with
 *    `{ ok: true, enabled: false, rows: [] }` and an `X-Brain-Log-Status`
 *    header describing why. A reader must NEVER 5xx just because the
 *    writer is gated off — that would mask an operational state as a bug.
 *  - Any real DB error returns 500 (with no row leakage).
 *
 * Query parameters:
 *   limit           — row cap (default 100, max 1000, min 1)
 *   verdict         — optional composite filter: GREEN | AMBER | RED | UNKNOWN
 *   since_ts        — optional epoch-ms lower bound (inclusive)
 *   until_ts        — optional epoch-ms upper bound (inclusive)
 *   source_verdict  — optional per-signal filter, e.g. `source_verdict=edge:red`
 *                     — matches rows where that column = that value
 *                     — multiple allowed: `?source_verdict=edge:red&source_verdict=feed:amber`
 *   include_signals — '1' to include the full signals JSONB payload (bloats response)
 *
 * Auth: CRON_SECRET Bearer / x-cron-secret header (same as settlement-health).
 * Not publicly indexable because per-signal timeline could leak strategy
 * dynamics.
 */
import { NextResponse } from 'next/server';
import { supabase as supa, SUPABASE_CONFIGURED } from '@/lib/store/db';
import { requireCronAuth } from '@/lib/core/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_VERDICTS = new Set(['GREEN', 'AMBER', 'RED', 'UNKNOWN']);
const ALLOWED_SIGNAL_VERDICTS = new Set(['green', 'amber', 'red', 'unknown']);
const ALLOWED_SOURCES = new Set(['edge', 'settlement', 'feed', 'ops']);

// Table-missing detection. Raw Postgres returns code '42P01' ("relation does
// not exist"), but the Supabase PostgREST proxy wraps that and surfaces its
// own error code 'PGRST205' with a human-readable message. Match both, and
// fall back to a message substring for safety.
const PG_UNDEFINED_TABLE = '42P01';
const POSTGREST_TABLE_MISSING = 'PGRST205';
function isTableMissing(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  if (err.code === PG_UNDEFINED_TABLE) return true;
  if (err.code === POSTGREST_TABLE_MISSING) return true;
  const m = (err.message || '').toLowerCase();
  return m.includes('could not find the table') || m.includes('does not exist');
}

type Row = {
  id: string;
  ts: number;
  verdict: string;
  edge_verdict: string;
  settlement_verdict: string;
  feed_verdict: string;
  ops_verdict: string;
  top_reasons: string[] | null;
  signals?: unknown;
  cache_hit: boolean;
  created_at?: string;
};

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseInt64(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function envEnabled(): boolean {
  return (process.env.BRAIN_STATUS_LOG_ENABLED ?? '0') !== '0';
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 1000);
  const verdictRaw = url.searchParams.get('verdict');
  const verdict = verdictRaw && ALLOWED_VERDICTS.has(verdictRaw) ? verdictRaw : null;
  const sinceTs = parseInt64(url.searchParams.get('since_ts'));
  const untilTs = parseInt64(url.searchParams.get('until_ts'));
  const includeSignals = url.searchParams.get('include_signals') === '1';

  // Parse `source_verdict=edge:red` filters (possibly multiple).
  const sourceFilters: Array<{ column: string; value: string }> = [];
  for (const sv of url.searchParams.getAll('source_verdict')) {
    const [source, sigVerdict] = sv.split(':');
    if (
      source &&
      sigVerdict &&
      ALLOWED_SOURCES.has(source) &&
      ALLOWED_SIGNAL_VERDICTS.has(sigVerdict)
    ) {
      sourceFilters.push({ column: `${source}_verdict`, value: sigVerdict });
    }
  }

  const enabled = envEnabled();

  // Gated off or Supabase not configured — return empty, 200 OK.
  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json(
      {
        ok: true,
        enabled,
        count: 0,
        window: null,
        rows: [],
        filter: { limit, verdict, sinceTs, untilTs, sourceFilters, includeSignals },
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Brain-Log-Status': 'supabase-unconfigured',
        },
      },
    );
  }

  // Select the columns we always want; add signals only on demand.
  const baseCols =
    'id,ts,verdict,edge_verdict,settlement_verdict,feed_verdict,ops_verdict,top_reasons,cache_hit,created_at';
  const selectCols = includeSignals ? `${baseCols},signals` : baseCols;

  let q = supa
    .from('polymarket_brain_status_log')
    .select(selectCols)
    .order('ts', { ascending: false })
    .limit(limit);

  if (verdict) q = q.eq('verdict', verdict);
  if (sinceTs != null) q = q.gte('ts', sinceTs);
  if (untilTs != null) q = q.lte('ts', untilTs);
  for (const f of sourceFilters) q = q.eq(f.column, f.value);

  try {
    const res = (await q) as {
      data: Row[] | null;
      error: { message: string; code?: string } | null;
    };

    if (res.error) {
      // Migration not applied yet — soft-fail to empty instead of 500.
      if (isTableMissing(res.error)) {
        return NextResponse.json(
          {
            ok: true,
            enabled,
            count: 0,
            window: null,
            rows: [],
            filter: { limit, verdict, sinceTs, untilTs, sourceFilters, includeSignals },
          },
          {
            headers: {
              'Cache-Control': 'no-store, max-age=0',
              'X-Brain-Log-Status': 'table-missing',
            },
          },
        );
      }
      return NextResponse.json(
        { ok: false, error: res.error.message, code: res.error.code ?? null },
        { status: 500 },
      );
    }

    const rows: Row[] = res.data ?? [];
    const window =
      rows.length > 0
        ? { newestTs: rows[0].ts, oldestTs: rows[rows.length - 1].ts }
        : null;

    return NextResponse.json(
      {
        ok: true,
        enabled,
        count: rows.length,
        window,
        rows,
        filter: { limit, verdict, sinceTs, untilTs, sourceFilters, includeSignals },
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Brain-Log-Status': enabled ? 'enabled' : 'writer-disabled',
          'X-Brain-Log-Rows': String(rows.length),
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
