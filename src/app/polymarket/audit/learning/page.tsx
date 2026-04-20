/**
 * /polymarket/audit/learning — weekly learning-loop report (FAZA 3.6).
 *
 * Server component. Reads the report directly via buildWeeklyReport()
 * (bypass HTTP — this runs on the same Next.js process). Renders:
 *   - Headline KPIs (decisions, acted rate, dormant gladiators, warnings)
 *   - Per-division activity + selection lift + top skip reasons
 *   - Factor distributions + week-over-week drift table
 *   - Gladiator activity table (highlight dormant in red)
 *   - Warnings panel
 *
 * Cookie-gated by parent /polymarket/audit/layout.tsx.
 */
import { buildWeeklyReport, getLearningConfig } from '@/lib/polymarket/learningLoop';
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

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export default async function LearningReportPage() {
  const cfg = getLearningConfig();
  const report = await buildWeeklyReport();

  const actedRate = report.totalDecisions > 0 ? report.totalActed / report.totalDecisions : 0;

  return (
    <div>
      <h1 style={{ fontSize: 20, letterSpacing: '0.1em', fontWeight: 800, marginBottom: 4, color: C.text }}>
        LEARNING · WEEKLY
      </h1>
      <div style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', marginBottom: 24 }}>
        window={cfg.windowDays}d · embargo={cfg.embargoHours}h · dormant_threshold={cfg.dormantDays}d · {report.generatedAt}
      </div>

      {!report.enabled && (
        <div style={{
          padding: 24,
          background: 'rgba(239,68,68,0.05)',
          border: `1px solid rgba(239,68,68,0.2)`,
          borderRadius: 8,
          color: C.orange,
          fontSize: 13,
          marginBottom: 24,
        }}>
          Learning loop disabled (POLY_LEARNING_ENABLED=0). Report skeleton only.
        </div>
      )}

      {/* KPIs — L5 LEARN layer (drift / regime / retrospective) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
        <ExplainCard
          label="DECISIONS"
          value={String(report.totalDecisions)}
          layer="L5"
          source={{ label: 'supabase', query: `polymarket_decisions (last ${cfg.windowDays}d)` }}
          rationale={`Decisions logged in learning window. Need N≥30 for statistical lift interpretation.`}
          confidence={{
            level: report.totalDecisions >= 100 ? 'HIGH' : report.totalDecisions >= 30 ? 'MED' : 'LOW',
            sampleSize: report.totalDecisions,
            reason: 'Wilson heuristic — small-N lift is noise',
          }}
        />
        <ExplainCard
          label="ACTED"
          value={String(report.totalActed)}
          color={report.totalActed > 0 ? C.green : C.text}
          layer="L5"
          source={{ label: 'derived', query: 'decisions.acted=true' }}
          rationale="Bets actually placed. Zero = all gates closed in window; investigate skip reasons."
        />
        <ExplainCard
          label="ACTED RATE"
          value={fmtPct(actedRate)}
          layer="L5"
          source={{ label: 'derived', query: 'acted / decisions' }}
          rationale="Selection tightness. <5% = extremely selective · >50% = gates too loose."
        />
        <ExplainCard
          label="DORMANT GLADS"
          value={String(report.dormantGladiators.length)}
          color={report.dormantGladiators.length > 0 ? C.orange : C.green}
          layer="L5"
          source={{ label: 'derived', query: `max(last_decision_at) > ${cfg.dormantDays}d` }}
          rationale={`Gladiators with no decision in ${cfg.dormantDays}d. Candidates for retire or retune.`}
        />
        <ExplainCard
          label="WARNINGS"
          value={String(report.warnings.length)}
          color={report.warnings.length > 0 ? C.orange : C.green}
          layer="L5"
          source={{ label: 'derived', query: 'learningLoop.detectWarnings()' }}
          rationale={report.warnings.length > 0
            ? 'Attention required: drift/coverage/ratio anomalies detected — see panel below.'
            : 'All heuristic gates clean.'}
        />
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <Section title="WARNINGS">
          <ul style={{
            fontSize: 12,
            color: C.orange,
            fontFamily: 'monospace',
            paddingLeft: 18,
            margin: 0,
            background: 'rgba(251,146,60,0.05)',
            border: `1px solid rgba(251,146,60,0.2)`,
            borderRadius: 6,
            padding: '12px 18px 12px 32px',
          }}>
            {report.warnings.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
          </ul>
        </Section>
      )}

      {/* Per-division */}
      <Section title={`PER DIVISION · ${report.divisionSummaries.length}`}>
        {report.divisionSummaries.length === 0 ? (
          <div style={{ padding: 24, color: C.muted, fontSize: 12, textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No decisions in window.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
              <thead style={{ background: C.headerBg }}>
                <tr>
                  <Th>DIVISION</Th>
                  <Th align="right">DECISIONS</Th>
                  <Th align="right">ACTED</Th>
                  <Th align="right">RATE</Th>
                  <Th align="right">EDGE ACTED</Th>
                  <Th align="right">EDGE SKIPPED</Th>
                  <Th align="right">SEL LIFT</Th>
                  <Th>TOP SKIP REASONS</Th>
                </tr>
              </thead>
              <tbody>
                {report.divisionSummaries.map(d => (
                  <tr key={d.division} style={{ borderTop: `1px solid ${C.border}` }}>
                    <Td>{d.division}</Td>
                    <Td align="right">{d.decisions}</Td>
                    <Td align="right" style={{ color: d.acted > 0 ? C.green : C.muted }}>{d.acted}</Td>
                    <Td align="right">{fmtPct(d.actedRate)}</Td>
                    <Td align="right">{fmtNum(d.avgEdgeActed, 1)}</Td>
                    <Td align="right" style={{ color: C.mutedLight }}>{fmtNum(d.avgEdgeSkipped, 1)}</Td>
                    <Td align="right" style={{
                      color: d.edgeSelectionLift == null ? C.muted
                        : d.edgeSelectionLift > 0 ? C.green
                        : C.red,
                      fontWeight: 700,
                    }}>
                      {d.edgeSelectionLift == null ? '—' : (d.edgeSelectionLift > 0 ? '+' : '') + d.edgeSelectionLift.toFixed(1)}
                    </Td>
                    <Td style={{ color: C.mutedLight, fontSize: 10 }}>
                      {d.topSkipReasons.length === 0 ? '—' : d.topSkipReasons.map(r => `${r.reason}(${r.count})`).join(' · ')}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Factor distributions */}
      <Section title="FACTOR DISTRIBUTIONS · current window">
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
            <thead style={{ background: C.headerBg }}>
              <tr>
                <Th>FACTOR</Th>
                <Th align="right">N</Th>
                <Th align="right">MEAN</Th>
                <Th align="right">P25</Th>
                <Th align="right">P50</Th>
                <Th align="right">P75</Th>
              </tr>
            </thead>
            <tbody>
              {report.factorDistributions.map(d => (
                <tr key={d.factor} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td>{d.factor}</Td>
                  <Td align="right">{d.n}</Td>
                  <Td align="right">{fmtNum(d.mean)}</Td>
                  <Td align="right" style={{ color: C.mutedLight }}>{fmtNum(d.p25)}</Td>
                  <Td align="right">{fmtNum(d.p50)}</Td>
                  <Td align="right" style={{ color: C.mutedLight }}>{fmtNum(d.p75)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Drift */}
      <Section title="FACTOR DRIFT · current vs prior 7d">
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
            <thead style={{ background: C.headerBg }}>
              <tr>
                <Th>FACTOR</Th>
                <Th align="right">PRIOR MEAN (n)</Th>
                <Th align="right">CURRENT MEAN (n)</Th>
                <Th align="right">Δ</Th>
                <Th align="right">REL Δ</Th>
              </tr>
            </thead>
            <tbody>
              {report.factorDrift.map(f => {
                const flagged = f.meanRelDelta != null && Math.abs(f.meanRelDelta) > 0.20;
                return (
                  <tr key={f.factor} style={{ borderTop: `1px solid ${C.border}` }}>
                    <Td>{f.factor}</Td>
                    <Td align="right" style={{ color: C.mutedLight }}>
                      {fmtNum(f.prior.mean)} <span style={{ color: C.muted }}>({f.prior.n})</span>
                    </Td>
                    <Td align="right">
                      {fmtNum(f.current.mean)} <span style={{ color: C.muted }}>({f.current.n})</span>
                    </Td>
                    <Td align="right">{f.meanDelta == null ? '—' : (f.meanDelta > 0 ? '+' : '') + f.meanDelta.toFixed(2)}</Td>
                    <Td align="right" style={{ color: flagged ? C.orange : C.text, fontWeight: flagged ? 700 : 400 }}>
                      {f.meanRelDelta == null ? '—' : (f.meanRelDelta > 0 ? '+' : '') + (f.meanRelDelta * 100).toFixed(1) + '%'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Gladiator activity */}
      <Section title={`GLADIATOR ACTIVITY · ${report.gladiatorActivity.length}`}>
        {report.gladiatorActivity.length === 0 ? (
          <div style={{ padding: 24, color: C.muted, fontSize: 12, textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No gladiators logged decisions in window.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'auto', maxHeight: 480 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
              <thead style={{ background: C.headerBg, position: 'sticky', top: 0 }}>
                <tr>
                  <Th>GLADIATOR</Th>
                  <Th>DIV</Th>
                  <Th align="right">DECISIONS 7D</Th>
                  <Th align="right">ACTED 7D</Th>
                  <Th>LAST DECISION</Th>
                  <Th align="right">DAYS SINCE</Th>
                  <Th>STATUS</Th>
                </tr>
              </thead>
              <tbody>
                {report.gladiatorActivity.map(g => (
                  <tr key={g.gladiatorId} style={{ borderTop: `1px solid ${C.border}` }}>
                    <Td><span title={g.gladiatorId}>{g.gladiatorId.slice(0, 16)}</span></Td>
                    <Td>{g.division}</Td>
                    <Td align="right">{g.decisions7d}</Td>
                    <Td align="right" style={{ color: g.acted7d > 0 ? C.green : C.muted }}>{g.acted7d}</Td>
                    <Td style={{ color: C.mutedLight }}>{g.lastDecisionAt ?? '—'}</Td>
                    <Td align="right">{g.daysSinceLastDecision == null ? '—' : g.daysSinceLastDecision.toFixed(1)}</Td>
                    <Td style={{ color: g.dormant ? C.red : C.green, fontWeight: 700 }}>
                      {g.dormant ? 'DORMANT' : 'active'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p style={{ marginTop: 16, fontSize: 10, color: C.muted, fontFamily: 'monospace', textAlign: 'right' }}>
        polymarket_decisions · learning_loop · {new Date().toISOString()}
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
