/**
 * /polymarket/audit/scans/[runId] — single scan inspector (server component).
 *
 * FAZA 3.5. Shows the scan envelope (env snapshot, counts, errors) plus
 * every decision correlated during that tick — acted or skipped — with
 * factor breakdown. Maieutic view: why did the scanner act / skip?
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getScanRun } from '@/lib/polymarket/scanHistory';

export const dynamic = 'force-dynamic';

interface ScanRunData {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  divisions_scanned: string[] | null;
  opportunities_found: number;
  bets_placed: number;
  decisions_logged: number;
  correlation_disabled: boolean;
  errors: Array<{ division: string; error: string }> | null;
  env_snapshot: Record<string, unknown> | null;
}

interface DecisionRow {
  decision_id: string;
  gladiator_id: string;
  division: string;
  market_id: string;
  direction: string;
  confidence: number | null;
  edge_score: number | null;
  goldsky_confirm: number | null;
  moltbook_karma: number | null;
  liquidity_sanity: number | null;
  final_score: number | null;
  acted: boolean;
  skip_reason: string | null;
  rationale: Array<{ factor: string; value: number; note: string }> | null;
  decided_at: string;
}

const C = {
  text: '#f3f0e8',
  muted: '#6a5f52',
  mutedLight: '#a89a8a',
  blue: '#DAA520',
  green: '#4ade80',
  red: '#ef4444',
  orange: '#fb923c',
  border: 'rgba(218,165,32,0.15)',
  headerBg: 'rgba(218,165,32,0.05)',
};

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

export default async function ScanInspectorPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const result = await getScanRun(runId);
  if (!result) notFound();

  const run = result.run as ScanRunData;
  const decisions = (result.decisions || []) as DecisionRow[];

  const acted = decisions.filter(d => d.acted);
  const skipped = decisions.filter(d => !d.acted);
  const byDivision: Record<string, { acted: number; skipped: number }> = {};
  for (const d of decisions) {
    const key = d.division || 'UNKNOWN';
    if (!byDivision[key]) byDivision[key] = { acted: 0, skipped: 0 };
    if (d.acted) byDivision[key].acted += 1;
    else byDivision[key].skipped += 1;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 4 }}>
        <Link href="/polymarket/audit" style={{ color: C.muted, fontSize: 11, textDecoration: 'none' }}>← scans</Link>
        <h1 style={{ fontSize: 16, letterSpacing: '0.1em', fontWeight: 800, color: C.text }}>
          SCAN · <span style={{ fontFamily: 'monospace', color: C.blue }}>{runId.slice(0, 8)}</span>
        </h1>
      </div>
      <div style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', marginBottom: 24 }}>
        {run.started_at} → {run.finished_at ?? 'in-progress'} · {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        <Kpi label="OPPS FOUND" value={String(run.opportunities_found)} />
        <Kpi label="DECISIONS" value={String(run.decisions_logged)} />
        <Kpi label="ACTED" value={String(acted.length)} color={acted.length > 0 ? C.green : C.text} />
        <Kpi
          label="CORRELATION"
          value={run.correlation_disabled ? 'OFF' : 'ON'}
          color={run.correlation_disabled ? C.red : C.green}
        />
      </div>

      {/* Env snapshot */}
      {run.env_snapshot && (
        <Section title="ENV SNAPSHOT">
          <pre style={{ padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 6, fontSize: 11, color: C.mutedLight, overflowX: 'auto' }}>
            {JSON.stringify(run.env_snapshot, null, 2)}
          </pre>
        </Section>
      )}

      {/* Per-division */}
      {Object.keys(byDivision).length > 0 && (
        <Section title="PER DIVISION">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {Object.entries(byDivision).map(([div, { acted: a, skipped: s }]) => (
              <div key={div} style={{ padding: 12, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: C.mutedLight, letterSpacing: '0.15em' }}>{div}</div>
                <div style={{ fontSize: 14, fontFamily: 'monospace', marginTop: 4 }}>
                  <span style={{ color: C.green }}>{a} acted</span>
                  <span style={{ color: C.muted }}> · </span>
                  <span style={{ color: C.mutedLight }}>{s} skipped</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Errors */}
      {run.errors && run.errors.length > 0 && (
        <Section title="ERRORS">
          <ul style={{ fontSize: 12, color: C.red, fontFamily: 'monospace', paddingLeft: 18 }}>
            {run.errors.map((e, i) => (
              <li key={i}>[{e.division}] {e.error}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Decisions table */}
      <Section title={`DECISIONS · ${decisions.length}`}>
        {decisions.length === 0 ? (
          <div style={{ padding: 24, color: C.muted, fontSize: 12, textAlign: 'center' }}>
            No decisions logged for this run.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
              <thead style={{ background: C.headerBg }}>
                <tr>
                  <Th>GLADIATOR</Th>
                  <Th>DIV</Th>
                  <Th>DIR</Th>
                  <Th align="right">EDGE</Th>
                  <Th align="right">GS</Th>
                  <Th align="right">KM</Th>
                  <Th align="right">LIQ</Th>
                  <Th align="right">FINAL</Th>
                  <Th align="right">CONF</Th>
                  <Th>ACTED</Th>
                  <Th>SKIP REASON</Th>
                  <Th>INSPECT</Th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.decision_id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <Td><span title={d.gladiator_id}>{d.gladiator_id.slice(0, 10)}</span></Td>
                    <Td>{d.division}</Td>
                    <Td style={{ color: d.direction === 'BUY_YES' ? C.green : d.direction === 'BUY_NO' ? C.red : C.muted }}>
                      {d.direction}
                    </Td>
                    <Td align="right">{fmtNum(d.edge_score, 1)}</Td>
                    <Td align="right">{fmtNum(d.goldsky_confirm)}</Td>
                    <Td align="right">{fmtNum(d.moltbook_karma)}</Td>
                    <Td align="right" style={{ color: (d.liquidity_sanity ?? 0) === 0 ? C.red : C.text }}>
                      {fmtNum(d.liquidity_sanity)}
                    </Td>
                    <Td align="right" style={{ color: (d.final_score ?? 0) >= 45 ? C.green : C.orange, fontWeight: 700 }}>
                      {fmtNum(d.final_score, 1)}
                    </Td>
                    <Td align="right">{fmtNum(d.confidence, 0)}</Td>
                    <Td style={{ color: d.acted ? C.green : C.muted }}>{d.acted ? 'YES' : 'no'}</Td>
                    <Td style={{ color: C.orange, fontSize: 10 }}>{d.skip_reason ?? '—'}</Td>
                    <Td>
                      <Link href={`/polymarket/audit/decisions/${d.decision_id}`} style={{ color: C.blue, textDecoration: 'none' }}>
                        ↗
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '0.2em', color: C.mutedLight, fontWeight: 700, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '14px 18px', border: `1px solid ${C.border}`, borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: 9, color: C.mutedLight, letterSpacing: '0.15em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 800, color: color || C.text, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align,
      padding: '10px 10px',
      fontSize: 9,
      letterSpacing: '0.12em',
      color: C.mutedLight,
      fontWeight: 700,
      borderBottom: `1px solid ${C.border}`,
    }}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  style,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
}) {
  return (
    <td style={{
      textAlign: align,
      padding: '8px 10px',
      color: C.text,
      verticalAlign: 'middle',
      ...style,
    }}>
      {children}
    </td>
  );
}
