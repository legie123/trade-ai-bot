/**
 * /polymarket/audit/flags — Ops Flags Panel.
 *
 * FAZA 3.9. Single-glance view of every kill-switch + operational env flag
 * grouped by domain. Answers "what's gated off RIGHT NOW?" in one glance.
 *
 * Server component reads env directly via getOpsFlagsSnapshot(). Kill-switches
 * are classified manually in lib/polymarket/opsFlags.ts — mirror that contract
 * whenever a new flag is added to the codebase.
 *
 * Layer: L4 AUDIT.
 */
import {
  DOMAIN_LABEL,
  DOMAIN_ORDER,
  FlagReading,
  getOpsFlagsSnapshot,
} from '@/lib/polymarket/opsFlags';
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
  purple: '#c084fc',
  border: 'rgba(218,165,32,0.15)',
  headerBg: 'rgba(218,165,32,0.05)',
};

const STATE_COLOR: Record<FlagReading['state'], string> = {
  on: C.green,
  off: C.red,
  shadow: C.purple,
  default: C.mutedLight,
  custom: C.orange,
};

const RISK_COLOR: Record<FlagReading['risk'], string> = {
  critical: C.red,
  high: C.orange,
  medium: C.blue,
  low: C.mutedLight,
};

export default async function OpsFlagsPage() {
  const snap = getOpsFlagsSnapshot();

  return (
    <div>
      <h1 style={{ fontSize: 20, letterSpacing: '0.1em', fontWeight: 800, marginBottom: 8, color: C.text }}>
        OPS FLAGS · KILL-SWITCHES
      </h1>
      <p style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', marginBottom: 24 }}>
        Every kill-switch + operational env flag, classified by domain. Read from process.env at request time —
        new revision ⇒ fresh snapshot. Secrets redacted.
      </p>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        <ExplainCard
          label="TOTAL FLAGS"
          value={String(snap.totalFlags)}
          layer="L4"
          source={{ label: 'catalog', query: 'opsFlags.CATALOG' }}
          rationale="Flags enumerated in the canonical catalog. Add here when a new kill-switch lands in code."
          timestamp={snap.generatedAt}
        />
        <ExplainCard
          label="OVERRIDDEN"
          value={String(snap.overriddenCount)}
          color={snap.overriddenCount > 0 ? C.orange : C.text}
          layer="L4"
          source={{ label: 'env', query: 'process.env' }}
          rationale="Flags where operator has pinned an explicit value via Cloud Run env. Non-zero = deliberate override."
        />
        <ExplainCard
          label="OFF"
          value={String(snap.offCount)}
          color={snap.offCount > 0 ? C.red : C.green}
          layer="L4"
          source={{ label: 'env', query: 'classified=off' }}
          rationale="Flags classified as OFF (0/off/false/disabled). High count is suspicious — cross-check with recent audits."
        />
        <ExplainCard
          label="DOMAINS"
          value={String(DOMAIN_ORDER.length)}
          layer="L4"
          source={{ label: 'catalog', query: 'DOMAIN_ORDER' }}
          rationale="Operational domains currently modeled. Add a new domain when a new subsystem gains kill-switches."
        />
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginBottom: 24,
        fontSize: 10,
        fontFamily: 'monospace',
        color: C.mutedLight,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <LegendItem color={C.green} label="ON" />
        <LegendItem color={C.red} label="OFF" />
        <LegendItem color={C.purple} label="SHADOW" />
        <LegendItem color={C.orange} label="CUSTOM" />
        <LegendItem color={C.mutedLight} label="DEFAULT (unset)" />
        <div style={{ flex: 1 }} />
        <span>RISK:</span>
        <LegendItem color={C.red} label="CRITICAL" />
        <LegendItem color={C.orange} label="HIGH" />
        <LegendItem color={C.blue} label="MED" />
        <LegendItem color={C.mutedLight} label="LOW" />
      </div>

      {/* Per-domain tables */}
      {DOMAIN_ORDER.map((domain) => {
        const rows = snap.byDomain[domain];
        if (!rows || rows.length === 0) return null;
        return (
          <section key={domain} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.2em', color: C.mutedLight, fontWeight: 700, marginBottom: 10 }}>
              {DOMAIN_LABEL[domain]} · {rows.length}
            </h2>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
                <thead style={{ background: C.headerBg }}>
                  <tr>
                    <Th>FLAG</Th>
                    <Th>STATE</Th>
                    <Th>VALUE</Th>
                    <Th>RISK</Th>
                    <Th>WHAT IT DOES</Th>
                    <Th>IF OFF</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.name} style={{ borderTop: `1px solid ${C.border}` }}>
                      <Td style={{ minWidth: 240 }}>
                        <div style={{ color: C.text, fontWeight: 700 }}>{f.name}</div>
                        <div style={{ color: C.muted, fontSize: 9 }}>
                          default: {f.defaultBehavior}{f.publicClient ? ' · client-visible' : ''}
                        </div>
                      </Td>
                      <Td>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: `${STATE_COLOR[f.state]}22`,
                          color: STATE_COLOR[f.state],
                          fontWeight: 700,
                          letterSpacing: '0.1em',
                          fontSize: 10,
                        }}>
                          {f.state.toUpperCase()}
                        </span>
                        {f.overridden && (
                          <span style={{ marginLeft: 6, color: C.orange, fontSize: 9 }}>●</span>
                        )}
                      </Td>
                      <Td>
                        <span style={{ color: f.overridden ? C.text : C.muted }}>
                          {f.rawValue ?? <em style={{ color: C.muted }}>unset</em>}
                        </span>
                      </Td>
                      <Td>
                        <span style={{
                          color: RISK_COLOR[f.risk],
                          fontWeight: 700,
                          fontSize: 10,
                          letterSpacing: '0.1em',
                        }}>
                          {f.risk.toUpperCase()}
                        </span>
                      </Td>
                      <Td style={{ maxWidth: 360, color: C.text, whiteSpace: 'normal', lineHeight: 1.5 }}>
                        {f.description}
                      </Td>
                      <Td style={{ maxWidth: 280, color: C.mutedLight, whiteSpace: 'normal', lineHeight: 1.5 }}>
                        {f.riskIfOff}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <p style={{ marginTop: 16, fontSize: 10, color: C.muted, fontFamily: 'monospace', textAlign: 'right' }}>
        opsFlags (process.env · read-at-request) · {new Date(snap.generatedAt).toISOString()}
      </p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
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
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {children}
    </td>
  );
}
