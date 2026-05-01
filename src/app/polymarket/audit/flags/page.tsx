/**
 * /polymarket/audit/flags — Ops Flags Panel.
 *
 * FAZA 3.9 + FAZA FE-4 (2026-04-26).
 * Single-glance view of every kill-switch + operational env flag grouped by
 * domain. Answers "what's gated off RIGHT NOW?" in one glance.
 *
 * Server component reads env directly via getOpsFlagsSnapshot(). Kill-switches
 * are classified manually in lib/polymarket/opsFlags.ts — mirror that contract
 * whenever a new flag is added to the codebase.
 *
 * FE-4 changes:
 * - All hex literals replaced with CSS vars from globals.css (Dragon + Institutional themes)
 * - State pill → <StatusChip> primitive
 * - Risk indicator → <StatusChip> primitive
 * - Section headers → <SectionHeader> primitive
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
import StatusChip, { type ChipVariant } from '@/components/desk/StatusChip';
import SectionHeader from '@/components/desk/SectionHeader';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─── FE-4 (2026-04-26) ────────────────────────────────────────────────────
// State / Risk → ChipVariant mapping. Both Dragon and Institutional themes
// inherit the variant colors via .pill.pill-{variant} classes (globals.css).
// ───────────────────────────────────────────────────────────────────────
const STATE_VARIANT: Record<FlagReading['state'], ChipVariant> = {
  on: 'success',
  off: 'danger',
  shadow: 'info',
  default: 'neutral',
  custom: 'warn',
};

const RISK_VARIANT: Record<FlagReading['risk'], ChipVariant> = {
  critical: 'danger',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
};

export default async function OpsFlagsPage() {
  const snap = getOpsFlagsSnapshot();

  return (
    <div>
      <h1 style={{
        fontSize: 20,
        letterSpacing: '0.1em',
        fontWeight: 800,
        marginBottom: 8,
        color: 'var(--text-primary)',
      }}>
        OPS FLAGS · KILL-SWITCHES
      </h1>
      <p style={{
        color: 'var(--text-muted)',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        marginBottom: 24,
      }}>
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
          color={snap.overriddenCount > 0 ? 'var(--accent-amber)' : 'var(--text-primary)'}
          layer="L4"
          source={{ label: 'env', query: 'process.env' }}
          rationale="Flags where operator has pinned an explicit value via Cloud Run env. Non-zero = deliberate override."
        />
        <ExplainCard
          label="OFF"
          value={String(snap.offCount)}
          color={snap.offCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}
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

      {/* Legend — uses StatusChip primitive for visual parity with table cells */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 24,
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <span style={{ marginRight: 4 }}>STATE:</span>
        <StatusChip variant="success" label="ON" dot={false} />
        <StatusChip variant="danger"  label="OFF" dot={false} />
        <StatusChip variant="info"    label="SHADOW" dot={false} />
        <StatusChip variant="warn"    label="CUSTOM" dot={false} />
        <StatusChip variant="neutral" label="DEFAULT" dot={false} />
        <div style={{ flex: 1 }} />
        <span style={{ marginRight: 4 }}>RISK:</span>
        <StatusChip variant="danger"  label="CRITICAL" dot={false} />
        <StatusChip variant="warn"    label="HIGH" dot={false} />
        <StatusChip variant="info"    label="MED" dot={false} />
        <StatusChip variant="neutral" label="LOW" dot={false} />
      </div>

      {/* Per-domain tables */}
      {DOMAIN_ORDER.map((domain) => {
        const rows = snap.byDomain[domain];
        if (!rows || rows.length === 0) return null;
        return (
          <section key={domain} style={{ marginBottom: 28 }}>
            <SectionHeader trailing={<span style={{ fontSize: 10 }}>{rows.length}</span>}>
              {DOMAIN_LABEL[domain]}
            </SectionHeader>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              marginTop: 8,
            }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
              }}>
                <thead style={{ background: 'var(--bg-card-hover)' }}>
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
                    <tr key={f.name} style={{ borderTop: '1px solid var(--border)' }}>
                      <Td style={{ minWidth: 240 }}>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{f.name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 9 }}>
                          default: {f.defaultBehavior}{f.publicClient ? ' · client-visible' : ''}
                        </div>
                      </Td>
                      <Td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <StatusChip
                            variant={STATE_VARIANT[f.state]}
                            label={f.state.toUpperCase()}
                            dot={false}
                          />
                          {f.overridden && (
                            <span
                              title="Operator-overridden"
                              style={{ color: 'var(--accent-amber)', fontSize: 9 }}
                            >●</span>
                          )}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ color: f.overridden ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {f.rawValue ?? <em style={{ color: 'var(--text-muted)' }}>unset</em>}
                        </span>
                      </Td>
                      <Td>
                        <StatusChip
                          variant={RISK_VARIANT[f.risk]}
                          label={f.risk.toUpperCase()}
                          dot={false}
                        />
                      </Td>
                      <Td style={{
                        maxWidth: 360,
                        color: 'var(--text-primary)',
                        whiteSpace: 'normal',
                        lineHeight: 1.5,
                      }}>
                        {f.description}
                      </Td>
                      <Td style={{
                        maxWidth: 280,
                        color: 'var(--text-secondary)',
                        whiteSpace: 'normal',
                        lineHeight: 1.5,
                      }}>
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

      <p style={{
        marginTop: 16,
        fontSize: 10,
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        textAlign: 'right',
      }}>
        opsFlags (process.env · read-at-request) · {new Date(snap.generatedAt).toISOString()}
      </p>
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
      color: 'var(--text-secondary)',
      fontWeight: 700,
      borderBottom: '1px solid var(--border)',
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
      color: 'var(--text-primary)',
      verticalAlign: 'top',
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {children}
    </td>
  );
}
