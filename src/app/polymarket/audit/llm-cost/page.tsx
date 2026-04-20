/**
 * /polymarket/audit/llm-cost — per-market LLM attribution drill-down.
 *
 * FAZA 3.3. Server component reads the in-memory tracker directly
 * (same process, zero RTT). Shows totals, provider mix, top-spender
 * table. Answers "which markets are expensive to analyze?"
 *
 * Layer: L4 AUDIT (process-local trace) + L1 METRICS.
 *
 * Caveat: tracker is process-local. Multi-instance deployments will
 * show per-instance view. Prom-exported llmCostDollars (by provider+model,
 * NOT by market) gives cluster-wide totals.
 */
import { getLlmCostSnapshot } from '@/lib/polymarket/llmCostTracker';
import { ExplainCard } from '@/components/explain/ExplainCard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default async function LlmCostPage() {
  const snap = getLlmCostSnapshot(100);

  const providerRows = Object.entries(snap.byProvider).sort(
    (a, b) => b[1].costUsd - a[1].costUsd,
  );
  const roleRows = Object.entries(snap.byRole).sort(
    (a, b) => b[1].costUsd - a[1].costUsd,
  );

  return (
    <div>
      <h1 style={{ fontSize: 20, letterSpacing: '0.1em', fontWeight: 800, marginBottom: 8, color: C.text }}>
        LLM COST · ATTRIBUTION
      </h1>
      <p style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', marginBottom: 24 }}>
        Per-market LLM spend across DeepSeek / OpenAI / Gemini. Process-local view;
        multi-instance deployments will differ per pod. Kill: LLM_COST_TRACKER_ENABLED=0.
      </p>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        <ExplainCard
          label="TRACKED MARKETS"
          value={fmtNum(snap.totalMarkets)}
          layer="L4"
          source={{ label: 'memory', query: 'llmCostTracker.store' }}
          rationale="Unique markets that triggered >=1 live LLM call (cache hits not counted)."
          timestamp={snap.generatedAt}
        />
        <ExplainCard
          label="TOTAL CALLS"
          value={fmtNum(snap.totalCalls)}
          layer="L1"
          source={{ label: 'memory', query: 'sum(markets[].totalCalls)' }}
          rationale="Successful live LLM calls. Failures / timeouts are logged via Prom but not billed here."
        />
        <ExplainCard
          label="TOTAL TOKENS"
          value={fmtNum(snap.totalTokens)}
          layer="L1"
          source={{ label: 'memory', query: 'sum(markets[].totalTokens)' }}
          rationale="Aggregate token spend (prompt + completion). 1M tokens ~= $0.15–$30 depending on model."
        />
        <ExplainCard
          label="TOTAL COST"
          value={fmtUsd(snap.totalCostUsd)}
          color={snap.totalCostUsd > 1 ? C.orange : C.green}
          layer="L1"
          source={{ label: 'derived', query: 'tokens × priceFor(model)' }}
          rationale="Blended USD spend this rolling 24h. Compare vs trading realized-pnl: LLM should be <5% of edge."
        />
      </div>

      {/* Tracking disabled warning */}
      {!snap.tracking && (
        <div style={{
          padding: 14,
          border: `1px solid ${C.orange}`,
          borderRadius: 6,
          color: C.orange,
          fontSize: 12,
          marginBottom: 24,
          background: `${C.orange}11`,
        }}>
          Tracker disabled via LLM_COST_TRACKER_ENABLED=0 — showing stale snapshot only.
        </div>
      )}

      {/* Provider + Role breakdown side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
        <Section title="BY PROVIDER">
          <BreakdownTable rows={providerRows} />
        </Section>
        <Section title="BY ROLE">
          <BreakdownTable rows={roleRows} />
        </Section>
      </div>

      {/* Top spenders table */}
      <Section title={`TOP SPENDERS · ${snap.topSpenders.length}`}>
        {snap.topSpenders.length === 0 ? (
          <div style={{ padding: 24, color: C.muted, fontSize: 12, textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No LLM calls recorded yet. Trigger a polymarket scan to populate — or confirm tracker is enabled.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
              <thead style={{ background: C.headerBg }}>
                <tr>
                  <Th>MARKET</Th>
                  <Th>DIV</Th>
                  <Th align="right">CALLS</Th>
                  <Th align="right">TOKENS</Th>
                  <Th align="right">COST</Th>
                  <Th align="right">LAST</Th>
                </tr>
              </thead>
              <tbody>
                {snap.topSpenders.map((m) => (
                  <tr key={m.marketId} style={{ borderTop: `1px solid ${C.border}` }}>
                    <Td>
                      <div style={{ color: C.text, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.titleHint ?? <span style={{ color: C.muted }}>—</span>}
                      </div>
                      <div style={{ color: C.muted, fontSize: 10 }} title={m.marketId}>
                        {m.marketId.slice(0, 24)}{m.marketId.length > 24 ? '…' : ''}
                      </div>
                    </Td>
                    <Td>{m.division ?? '—'}</Td>
                    <Td align="right">{fmtNum(m.totalCalls)}</Td>
                    <Td align="right">{fmtNum(m.totalTokens)}</Td>
                    <Td align="right" style={{ color: m.totalCostUsd > 0.10 ? C.orange : C.text, fontWeight: 700 }}>
                      {fmtUsd(m.totalCostUsd)}
                    </Td>
                    <Td align="right" style={{ color: C.mutedLight }}>{fmtAgo(m.lastCall)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p style={{ marginTop: 16, fontSize: 10, color: C.muted, fontFamily: 'monospace', textAlign: 'right' }}>
        llmCostTracker (memory · 24h TTL · cap 5000 markets) · {new Date(snap.generatedAt).toISOString()}
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

interface BreakdownRow { calls: number; tokens: number; costUsd: number }

function BreakdownTable({ rows }: { rows: Array<[string, BreakdownRow]> }) {
  if (rows.length === 0) {
    return <div style={{ padding: 14, color: C.muted, fontSize: 11, fontFamily: 'monospace' }}>No data.</div>;
  }
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
        <thead style={{ background: C.headerBg }}>
          <tr>
            <Th>KEY</Th>
            <Th align="right">CALLS</Th>
            <Th align="right">TOKENS</Th>
            <Th align="right">COST</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderTop: `1px solid ${C.border}` }}>
              <Td>{k}</Td>
              <Td align="right">{fmtNum(v.calls)}</Td>
              <Td align="right">{fmtNum(v.tokens)}</Td>
              <Td align="right" style={{ fontWeight: 700 }}>{fmtUsd(v.costUsd)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
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
      verticalAlign: 'top',
      ...style,
    }}>
      {children}
    </td>
  );
}
