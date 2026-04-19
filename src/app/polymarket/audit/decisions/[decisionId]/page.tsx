/**
 * /polymarket/audit/decisions/[decisionId] — single decision inspector.
 *
 * FAZA 3.5. Maieutic drill-down: pentru o decizie data, arata factorii
 * (edge × goldsky × moltbook × liquidity), rationale[] complet, market
 * context, raw_opportunity snapshot si linkback la scan parent prin run_id.
 *
 * Server component. Cookie-gated via parent layout. Reads directly din
 * Supabase (bypass HTTP /api/v2/polymarket/explain — mai putine hops pe SSR).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supa = (SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('placeholder'))
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

interface RationaleEntry {
  factor: string;
  value: number;
  note: string;
}

interface DecisionRow {
  decision_id: string;
  gladiator_id: string;
  division: string;
  market_id: string;
  condition_id: string | null;
  direction: string;
  confidence: number | null;
  edge_score: number | null;
  goldsky_confirm: number | null;
  moltbook_karma: number | null;
  liquidity_sanity: number | null;
  final_score: number | null;
  acted: boolean;
  skip_reason: string | null;
  rationale: RationaleEntry[] | null;
  raw_opportunity: Record<string, unknown> | null;
  run_id: string | null;
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

async function fetchDecision(decisionId: string): Promise<DecisionRow | null> {
  if (!supa) return null;
  try {
    const { data, error } = await supa
      .from('polymarket_decisions')
      .select('*')
      .eq('decision_id', decisionId)
      .maybeSingle();
    if (error || !data) return null;
    return data as DecisionRow;
  } catch {
    return null;
  }
}

export default async function DecisionInspectorPage({ params }: { params: Promise<{ decisionId: string }> }) {
  const { decisionId } = await params;
  const d = await fetchDecision(decisionId);
  if (!d) notFound();

  const edge = d.edge_score ?? 0;
  const gs = d.goldsky_confirm ?? 1;
  const km = d.moltbook_karma ?? 1;
  const liq = d.liquidity_sanity ?? 0;
  const finalScore = d.final_score ?? 0;

  const market = (d.raw_opportunity && typeof d.raw_opportunity === 'object')
    ? (d.raw_opportunity as Record<string, unknown>)
    : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 4, flexWrap: 'wrap' }}>
        <Link href="/polymarket/audit" style={{ color: C.muted, fontSize: 11, textDecoration: 'none' }}>← scans</Link>
        {d.run_id && (
          <Link href={`/polymarket/audit/scans/${d.run_id}`} style={{ color: C.muted, fontSize: 11, textDecoration: 'none' }}>
            ← scan {d.run_id.slice(0, 8)}
          </Link>
        )}
        <h1 style={{ fontSize: 16, letterSpacing: '0.1em', fontWeight: 800, color: C.text }}>
          DECISION · <span style={{ fontFamily: 'monospace', color: C.blue }}>{d.decision_id.slice(0, 8)}</span>
        </h1>
      </div>
      <div style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', marginBottom: 24 }}>
        {d.decided_at} · division={d.division} · gladiator=<span title={d.gladiator_id}>{d.gladiator_id.slice(0, 12)}</span>
      </div>

      {/* Headline: direction + acted + finalScore */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        <Kpi
          label="DIRECTION"
          value={d.direction}
          color={d.direction === 'BUY_YES' ? C.green : d.direction === 'BUY_NO' ? C.red : C.muted}
        />
        <Kpi
          label="ACTED"
          value={d.acted ? 'YES' : 'NO'}
          color={d.acted ? C.green : C.muted}
        />
        <Kpi
          label="FINAL SCORE"
          value={fmtNum(finalScore, 1)}
          color={finalScore >= 45 ? C.green : C.orange}
        />
        <Kpi
          label="CONFIDENCE"
          value={fmtNum(d.confidence, 0)}
        />
      </div>

      {/* Factor breakdown — the math */}
      <Section title="FACTOR BREAKDOWN · edge × goldsky × moltbook × liquidity">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <FactorCell label="EDGE" value={fmtNum(edge, 1)} scale="0-100" color={edge >= 40 ? C.green : C.orange} />
          <FactorCell
            label="GOLDSKY"
            value={fmtNum(gs, 2)}
            scale="multiplier"
            color={gs > 1 ? C.green : gs < 1 ? C.orange : C.text}
          />
          <FactorCell
            label="MOLTBOOK KARMA"
            value={fmtNum(km, 2)}
            scale="multiplier"
            color={km > 1 ? C.green : km < 1 ? C.orange : C.text}
          />
          <FactorCell
            label="LIQUIDITY"
            value={fmtNum(liq, 2)}
            scale="0-1 hard-zero"
            color={liq === 0 ? C.red : liq >= 0.8 ? C.green : C.orange}
          />
        </div>
        <div style={{
          marginTop: 14,
          padding: '10px 14px',
          background: 'rgba(255,255,255,0.02)',
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          fontFamily: 'monospace',
          fontSize: 12,
          color: C.mutedLight,
        }}>
          {fmtNum(edge, 1)} × {fmtNum(gs, 2)} × {fmtNum(km, 2)} × {fmtNum(liq, 2)} ={' '}
          <span style={{ color: finalScore >= 45 ? C.green : C.orange, fontWeight: 700 }}>{fmtNum(finalScore, 2)}</span>
        </div>
      </Section>

      {/* Skip reason (if any) */}
      {!d.acted && d.skip_reason && (
        <Section title="SKIP REASON">
          <div style={{
            padding: 14,
            background: 'rgba(239,68,68,0.05)',
            border: `1px solid rgba(239,68,68,0.2)`,
            borderRadius: 6,
            color: C.orange,
            fontSize: 12,
            fontFamily: 'monospace',
          }}>
            {d.skip_reason}
          </div>
        </Section>
      )}

      {/* Rationale trail */}
      <Section title={`RATIONALE · ${d.rationale?.length ?? 0} entries`}>
        {!d.rationale || d.rationale.length === 0 ? (
          <div style={{ padding: 18, color: C.muted, fontSize: 12, fontStyle: 'italic' }}>No rationale recorded.</div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
              <thead style={{ background: C.headerBg }}>
                <tr>
                  <Th>FACTOR</Th>
                  <Th align="right">VALUE</Th>
                  <Th>NOTE</Th>
                </tr>
              </thead>
              <tbody>
                {d.rationale.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <Td>{r.factor}</Td>
                    <Td align="right" style={{ color: r.value >= 1 ? C.green : r.value > 0 ? C.orange : C.red }}>
                      {fmtNum(r.value, 2)}
                    </Td>
                    <Td style={{ color: C.mutedLight }}>{r.note}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Market context */}
      <Section title="MARKET">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <ConfigCell k="Market ID" v={d.market_id} />
          <ConfigCell k="Condition ID" v={d.condition_id ?? '—'} />
        </div>
      </Section>

      {/* Raw opportunity snapshot */}
      {market && (
        <Section title="RAW OPPORTUNITY SNAPSHOT">
          <pre style={{
            padding: 14,
            background: 'rgba(255,255,255,0.02)',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            fontSize: 11,
            color: C.mutedLight,
            overflowX: 'auto',
            maxHeight: 420,
          }}>
            {JSON.stringify(market, null, 2)}
          </pre>
        </Section>
      )}

      <p style={{ marginTop: 16, fontSize: 10, color: C.muted, fontFamily: 'monospace', textAlign: 'right' }}>
        polymarket_decisions · append-only · {new Date().toISOString()}
      </p>
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
      <div style={{ fontSize: 20, fontFamily: 'monospace', fontWeight: 800, color: color || C.text, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function FactorCell({
  label,
  value,
  scale,
  color,
}: { label: string; value: string; scale: string; color?: string }) {
  return (
    <div style={{ padding: 12, border: `1px solid ${C.border}`, borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: 9, color: C.mutedLight, letterSpacing: '0.15em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 800, color: color || C.text, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>{scale}</div>
    </div>
  );
}

function ConfigCell({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ padding: 12, border: `1px solid ${C.border}`, borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: 10, color: C.mutedLight, letterSpacing: '0.1em', marginBottom: 4 }}>{k}</div>
      <div style={{ fontSize: 12, fontFamily: 'monospace', color: C.text, wordBreak: 'break-all' }}>{v}</div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align,
      padding: '10px 12px',
      fontSize: 9,
      letterSpacing: '0.15em',
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
      padding: '10px 12px',
      color: C.text,
      verticalAlign: 'middle',
      ...style,
    }}>
      {children}
    </td>
  );
}
