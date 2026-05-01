/**
 * /polymarket/audit/brain-history — Brain Status history log UI viewer.
 *
 * Post-blueprint §7.1 gap closure. Consumes the drill-down reader
 * endpoint (Batch 3.18b) on behalf of the operator, rendering the
 * snapshot timeline written by brainStatusLog.logBrainStatusSnapshot
 * (Batch 3.18).
 *
 * Server component. Reads Supabase directly (same shape as the reader
 * endpoint) — avoids SSRF-on-self for the Bearer-gated API. Soft-fail
 * contract mirrors route.ts: when migration not applied OR writer
 * gated off, page renders an explicit empty state with flip
 * instructions instead of 5xx.
 *
 * Layer: L4 AUDIT · grain=snapshot-per-cache-miss.
 */
import { supabase as supa, SUPABASE_CONFIGURED } from '@/lib/store/db';
import Link from 'next/link';
import { ExplainCard } from '@/components/explain/ExplainCard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// FAZA FE-4 batch 3 (2026-04-26): C constant maps semantic roles to CSS vars
// from globals.css. Both Dragon and Institutional themes inherit automatically.
// Asumptie: --text-primary, --text-secondary, --text-muted, --accent-{blue,green,red,amber},
// --border, --bg-card-hover all defined in globals.css FE-1 commit 6c03e93.
const C = {
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  mutedLight: 'var(--text-secondary)',
  blue: 'var(--accent-blue)',
  green: 'var(--accent-green)',
  red: 'var(--accent-red)',
  orange: 'var(--accent-amber)',
  border: 'var(--border)',
  headerBg: 'var(--bg-card-hover)',
};

const VERDICT_COLOR: Record<string, string> = {
  GREEN: C.green,
  AMBER: C.orange,
  RED: C.red,
  UNKNOWN: C.mutedLight,
  green: C.green,
  amber: C.orange,
  red: C.red,
  unknown: C.mutedLight,
};

const ALLOWED_VERDICTS = new Set(['GREEN', 'AMBER', 'RED', 'UNKNOWN']);
const ALLOWED_LIMITS = [25, 50, 100, 250, 500, 1000] as const;

// Supabase client — shared singleton from db.ts

const PG_UNDEFINED_TABLE = '42P01';
const POSTGREST_TABLE_MISSING = 'PGRST205';

function isTableMissing(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  if (err.code === PG_UNDEFINED_TABLE) return true;
  if (err.code === POSTGREST_TABLE_MISSING) return true;
  const m = (err.message || '').toLowerCase();
  return m.includes('could not find the table') || m.includes('does not exist');
}

function writerEnabled(): boolean {
  return (process.env.BRAIN_STATUS_LOG_ENABLED ?? '0') !== '0';
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
  cache_hit: boolean;
  created_at?: string;
};

type LoadState =
  | { kind: 'supabase-unconfigured'; rows: [] }
  | { kind: 'table-missing'; rows: [] }
  | { kind: 'writer-disabled'; rows: Row[] }
  | { kind: 'enabled'; rows: Row[] }
  | { kind: 'error'; rows: []; error: string };

async function load(verdict: string | null, limit: number): Promise<LoadState> {
  if (!SUPABASE_CONFIGURED) return { kind: 'supabase-unconfigured', rows: [] };

  let q = supa
    .from('polymarket_brain_status_log')
    .select(
      'id,ts,verdict,edge_verdict,settlement_verdict,feed_verdict,ops_verdict,top_reasons,cache_hit,created_at',
    )
    .order('ts', { ascending: false })
    .limit(limit);

  if (verdict) q = q.eq('verdict', verdict);

  const res = (await q) as {
    data: Row[] | null;
    error: { message: string; code?: string } | null;
  };

  if (res.error) {
    if (isTableMissing(res.error)) return { kind: 'table-missing', rows: [] };
    return { kind: 'error', rows: [], error: res.error.message };
  }

  const rows = res.data ?? [];
  return { kind: writerEnabled() ? 'enabled' : 'writer-disabled', rows };
}

function fmtAgo(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

function fmtIsoShort(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').replace(/\..*$/, 'Z');
}

function VerdictPill({ v, size = 11 }: { v: string; size?: number }) {
  const up = v.toUpperCase();
  const color = VERDICT_COLOR[up] || C.mutedLight;
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}`,
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: size,
        fontWeight: 700,
        fontFamily: 'monospace',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
      }}
    >
      {up}
    </span>
  );
}

function SignalPill({ label, v }: { label: string; v: string }) {
  const color = VERDICT_COLOR[v.toLowerCase()] || C.mutedLight;
  return (
    <span
      style={{
        color,
        fontSize: 10,
        fontFamily: 'monospace',
        fontWeight: 600,
        marginRight: 8,
      }}
      title={`${label} = ${v}`}
    >
      {label}:{v.toLowerCase()}
    </span>
  );
}

export default async function BrainHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ verdict?: string; limit?: string }>;
}) {
  const sp = await searchParams;
  const verdictRaw = (sp.verdict || '').toUpperCase();
  const verdict = ALLOWED_VERDICTS.has(verdictRaw) ? verdictRaw : null;
  const limitRaw = parseInt(sp.limit || '100', 10);
  const limit = (ALLOWED_LIMITS as readonly number[]).includes(limitRaw) ? limitRaw : 100;

  const state = await load(verdict, limit);

  // Summary aggregates (safe even on empty)
  const rows = state.rows as Row[];
  const counts = rows.reduce(
    (acc, r) => {
      const up = (r.verdict || 'UNKNOWN').toUpperCase();
      acc[up] = (acc[up] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const newest = rows.length > 0 ? rows[0].ts : null;
  const oldest = rows.length > 0 ? rows[rows.length - 1].ts : null;

  return (
    <div>
      <h1 style={{ fontSize: 20, letterSpacing: '0.1em', fontWeight: 800, marginBottom: 8, color: C.text }}>
        BRAIN STATUS · HISTORY LOG
      </h1>
      <p style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', marginBottom: 24 }}>
        Per-snapshot composite verdict + per-signal breakdown, persisted on every cache-miss
        getBrainStatus() rollup. Kill: BRAIN_STATUS_LOG_ENABLED=0.
      </p>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
        <ExplainCard
          label="ROWS"
          value={String(rows.length)}
          layer="L4"
          source={{ label: 'supabase', query: 'polymarket_brain_status_log' }}
          rationale="Snapshots returned for the current filter window. Cache-hit rollups are NOT logged — only cache-miss computes."
          timestamp={newest ?? undefined}
        />
        <ExplainCard
          label="NEWEST"
          value={newest ? fmtAgo(newest) + ' ago' : '—'}
          layer="L4"
          source={{ label: 'supabase', query: 'max(ts)' }}
          rationale="Age of the most-recent snapshot. Should advance by BRAIN_STATUS_CACHE_MS (≈30s) while probes are live."
        />
        <ExplainCard
          label="OLDEST"
          value={oldest ? fmtAgo(oldest) + ' ago' : '—'}
          layer="L4"
          source={{ label: 'supabase', query: 'min(ts)' }}
          rationale="Age of the oldest snapshot in the current window. Expands as you raise `limit`."
        />
        <ExplainCard
          label="GREEN / AMBER"
          value={`${counts.GREEN || 0} / ${counts.AMBER || 0}`}
          color={C.green}
          layer="L4"
          source={{ label: 'window', query: 'count(verdict)' }}
          rationale="Composite verdict distribution in the current window. High AMBER vs GREEN ratio means we're spending time near the guard rails."
        />
        <ExplainCard
          label="RED / UNKNOWN"
          value={`${counts.RED || 0} / ${counts.UNKNOWN || 0}`}
          color={(counts.RED || 0) > 0 ? C.red : C.mutedLight}
          layer="L4"
          source={{ label: 'window', query: 'count(verdict)' }}
          rationale="RED=strictest-wins trip. UNKNOWN=insufficient signals / probes absent. Non-zero RED deserves drill-down."
        />
      </div>

      {/* Filters */}
      <form
        method="GET"
        action="/polymarket/audit/brain-history"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 20,
          padding: 12,
          border: `1px solid ${C.border}`,
          background: C.headerBg,
          fontFamily: 'monospace',
          fontSize: 11,
        }}
      >
        <span style={{ color: C.muted, letterSpacing: '0.15em' }}>FILTER</span>
        <label style={{ color: C.mutedLight }}>
          verdict:{' '}
          <select
            name="verdict"
            defaultValue={verdict || ''}
            style={{
              background: 'var(--bg-input)',
              color: C.text,
              border: `1px solid ${C.border}`,
              padding: '4px 8px',
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            <option value="">(all)</option>
            <option value="GREEN">GREEN</option>
            <option value="AMBER">AMBER</option>
            <option value="RED">RED</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
        </label>
        <label style={{ color: C.mutedLight }}>
          limit:{' '}
          <select
            name="limit"
            defaultValue={String(limit)}
            style={{
              background: 'var(--bg-input)',
              color: C.text,
              border: `1px solid ${C.border}`,
              padding: '4px 8px',
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            {ALLOWED_LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          style={{
            background: C.blue,
            color: 'var(--bg-primary)',
            border: 'none',
            padding: '4px 12px',
            fontWeight: 700,
            fontSize: 11,
            cursor: 'pointer',
            letterSpacing: '0.1em',
          }}
        >
          APPLY
        </button>
        {(verdict || limit !== 100) && (
          <Link href="/polymarket/audit/brain-history" style={{ color: C.muted, fontSize: 11 }}>
            reset
          </Link>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ color: C.muted }}>
          status:{' '}
          <span
            style={{
              color:
                state.kind === 'enabled'
                  ? C.green
                  : state.kind === 'writer-disabled'
                    ? C.orange
                    : state.kind === 'error'
                      ? C.red
                      : C.mutedLight,
              fontWeight: 700,
            }}
          >
            {state.kind}
          </span>
        </span>
      </form>

      {/* Empty states */}
      {state.kind === 'table-missing' && (
        <EmptyState
          title="Migration not applied"
          body={
            <>
              Apply <code style={{ color: C.blue }}>supabase/migrations/20260420_polymarket_brain_status_log.sql</code> on Supabase,
              then flip <code style={{ color: C.blue }}>BRAIN_STATUS_LOG_ENABLED=1</code> in Cloud Run. Reader stays 200-OK
              with empty rows until both steps complete.
            </>
          }
        />
      )}
      {state.kind === 'supabase-unconfigured' && (
        <EmptyState
          title="Supabase unconfigured"
          body={
            <>
              <code style={{ color: C.blue }}>NEXT_PUBLIC_SUPABASE_URL</code> or the service-role key is missing
              from this environment. Usually harmless on preview builds — contact ops if this is prod.
            </>
          }
        />
      )}
      {state.kind === 'writer-disabled' && rows.length === 0 && (
        <EmptyState
          title="Writer gated off"
          body={
            <>
              Table exists but no snapshots yet. Flip{' '}
              <code style={{ color: C.blue }}>BRAIN_STATUS_LOG_ENABLED=1</code> in Cloud Run and wait one cache cycle
              (~30s). Reader stays green in the meantime.
            </>
          }
        />
      )}
      {state.kind === 'error' && (
        <EmptyState
          title="Query error"
          body={<span style={{ color: C.red }}>{(state as { error: string }).error}</span>}
        />
      )}

      {/* Rows */}
      {rows.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, background: 'var(--bg-primary)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 11 }}>
            <thead>
              <tr style={{ background: C.headerBg, color: C.muted, letterSpacing: '0.1em' }}>
                <Th>TS (UTC)</Th>
                <Th>AGE</Th>
                <Th>VERDICT</Th>
                <Th>SIGNALS</Th>
                <Th>TOP REASONS</Th>
                <Th align="right">CACHE</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td mono>{fmtIsoShort(r.ts)}</Td>
                  <Td mono>{fmtAgo(r.ts)}</Td>
                  <Td>
                    <VerdictPill v={r.verdict} />
                  </Td>
                  <Td>
                    <SignalPill label="edge" v={r.edge_verdict} />
                    <SignalPill label="settlement" v={r.settlement_verdict} />
                    <SignalPill label="feed" v={r.feed_verdict} />
                    <SignalPill label="ops" v={r.ops_verdict} />
                  </Td>
                  <Td>
                    {Array.isArray(r.top_reasons) && r.top_reasons.length > 0 ? (
                      <span style={{ color: C.mutedLight }}>{r.top_reasons.join(' · ')}</span>
                    ) : (
                      <span style={{ color: C.muted }}>—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span style={{ color: r.cache_hit ? C.mutedLight : C.green }}>
                      {r.cache_hit ? 'hit' : 'miss'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ color: C.muted, fontSize: 10, fontFamily: 'monospace', marginTop: 16 }}>
        Source: <code>polymarket_brain_status_log</code> (Batch 3.18 writer, Batch 3.18b reader).
        Composite verdict = strictest-wins over edge/settlement/feed/ops. Cache-hit rollups are not persisted.
      </p>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{ padding: '10px 12px', textAlign: align, fontSize: 10, fontWeight: 700 }}>
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  align = 'left',
}: {
  children: React.ReactNode;
  mono?: boolean;
  align?: 'left' | 'right';
}) {
  return (
    <td
      style={{
        padding: '8px 12px',
        textAlign: align,
        fontFamily: mono ? 'monospace' : 'system-ui',
        color: C.text,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}

function EmptyState({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.border}`,
        padding: 24,
        background: C.headerBg,
        color: C.mutedLight,
        fontSize: 12,
        fontFamily: 'monospace',
        marginBottom: 24,
      }}
    >
      <div style={{ color: C.blue, fontWeight: 700, fontSize: 12, letterSpacing: '0.15em', marginBottom: 8 }}>
        {title.toUpperCase()}
      </div>
      <div>{body}</div>
    </div>
  );
}
