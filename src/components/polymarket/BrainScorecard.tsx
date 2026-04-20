/**
 * BrainScorecard — L5 LEARN scorecard strip for /polymarket/audit.
 *
 * FAZA 3.11. Surfaces the OVERALL SettlementStats row from
 * learningLoop.buildWeeklyReport(). Answers "is the brain making money?"
 * at a glance without drilling into /polymarket/audit/learning.
 *
 * CONTRACT:
 *   - Server component (zero-JS, SSR-rendered).
 *   - Soft-fail on learningLoop error — renders a dimmed "unavailable"
 *     state rather than throwing (no 500s on audit index).
 *   - Honors POLY_LEARNING_ENABLED=0 → shows "tracker disabled" banner.
 *
 * SAMPLE-SIZE GATES:
 *   - nDecisive < 10 → WR/PF rendered dim + LOW confidence (noise regime).
 *   - nDecisive < 30 → MED confidence.
 *   - nDecisive >= 30 → HIGH confidence.
 */
import { buildWeeklyReport, SettlementStats } from '@/lib/polymarket/learningLoop';
import { ExplainCard } from '@/components/explain/ExplainCard';

const C = {
  text: '#f3f0e8',
  muted: '#6a5f52',
  mutedLight: '#a89a8a',
  green: '#4ade80',
  red: '#ef4444',
  orange: '#fb923c',
  blue: '#DAA520',
  border: 'rgba(218,165,32,0.15)',
};

function fmtPct(n: number | null, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs < 1000) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${(abs / 1000).toFixed(1)}k`;
}

function fmtNum(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

function confidenceLevel(n: number): 'LOW' | 'MED' | 'HIGH' {
  if (n >= 30) return 'HIGH';
  if (n >= 10) return 'MED';
  return 'LOW';
}

export async function BrainScorecard() {
  let report;
  try {
    report = await buildWeeklyReport();
  } catch (err) {
    return (
      <Section title="BRAIN SCORECARD · L5 LEARN">
        <div style={{
          padding: 14,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          color: C.muted,
          fontSize: 12,
          fontFamily: 'monospace',
          background: 'rgba(106, 95, 82, 0.05)',
        }}>
          Learning loop unavailable · {err instanceof Error ? err.message : 'unknown'}. Audit index continues
          without the scorecard — check /polymarket/audit/learning for detail.
        </div>
      </Section>
    );
  }

  if (!report.enabled) {
    return (
      <Section title="BRAIN SCORECARD · L5 LEARN">
        <div style={{
          padding: 14,
          border: `1px solid ${C.orange}`,
          borderRadius: 6,
          color: C.orange,
          fontSize: 12,
          fontFamily: 'monospace',
          background: `${C.orange}11`,
        }}>
          POLY_LEARNING_ENABLED=0 — scorecard disabled by operator. Flip back on or visit
          /polymarket/audit/flags to confirm.
        </div>
      </Section>
    );
  }

  const overall: SettlementStats | undefined = report.settlementStats.find((s) => s.scope === 'OVERALL');

  // No OVERALL row = settlement hook has not yet written settled_* rows.
  if (!overall || overall.nSettled === 0) {
    return (
      <Section title="BRAIN SCORECARD · L5 LEARN">
        <div style={{
          padding: 14,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          color: C.mutedLight,
          fontSize: 12,
          fontFamily: 'monospace',
          background: 'rgba(168, 154, 138, 0.05)',
        }}>
          No settled rows yet in {report.windowDays}d window. Either (a) markets haven&apos;t closed,
          (b) FAZA 3.7 settlement hook hasn&apos;t written back, or (c) migration
          20260420_polymarket_decision_settlement.sql not applied.
        </div>
      </Section>
    );
  }

  const netEdgeColor = overall.totalPnlUsd > 0 ? C.green : overall.totalPnlUsd < 0 ? C.red : C.text;
  const wrColor =
    overall.winRate == null
      ? C.mutedLight
      : overall.winRate >= 0.55
      ? C.green
      : overall.winRate >= 0.45
      ? C.text
      : C.red;
  const pfColor =
    overall.profitFactor == null
      ? C.mutedLight
      : overall.profitFactor >= 1.3
      ? C.green
      : overall.profitFactor >= 1.0
      ? C.text
      : C.red;

  const conf = confidenceLevel(overall.nDecisive);

  return (
    <Section title={`BRAIN SCORECARD · L5 LEARN · ${report.windowDays}D WINDOW`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 8 }}>
        <ExplainCard
          label="SETTLED"
          value={fmtNum(overall.nSettled)}
          sub={`${fmtNum(overall.nDecisive)} decisive · ${fmtNum(overall.cancelCount)} cancel`}
          layer="L5"
          source={{ label: 'supabase', query: 'polymarket_decisions.settled_at NOT NULL' }}
          rationale="Rows with settlement payout booked. nDecisive excludes CANCEL (refund, not W/L)."
          confidence={{ level: conf, sampleSize: overall.nDecisive, reason: 'nDecisive gates statistical trust' }}
        />
        <ExplainCard
          label="WIN RATE"
          value={fmtPct(overall.winRate)}
          color={wrColor}
          sub={`${fmtNum(overall.wins)}W · ${fmtNum(overall.losses)}L`}
          layer="L5"
          source={{ label: 'derived', query: 'wins / nDecisive' }}
          rationale="Excludes CANCEL. <45% suspicious; >55% healthy. Under n=10 treat as noise."
          confidence={{ level: conf, sampleSize: overall.nDecisive, reason: 'Below 10 decisive = unreliable' }}
        />
        <ExplainCard
          label="PROFIT FACTOR"
          value={overall.profitFactor == null ? '—' : overall.profitFactor.toFixed(2)}
          color={pfColor}
          layer="L5"
          source={{ label: 'derived', query: 'sum(wins%) / |sum(losses%)|' }}
          rationale="Edge quality: >1.3 institutional, 1.0-1.3 marginal, <1.0 losing. null = no losses yet."
          confidence={{ level: conf, sampleSize: overall.nDecisive, reason: 'Stabilizes above n=30' }}
        />
        <ExplainCard
          label="TOTAL PNL"
          value={fmtUsd(overall.totalPnlUsd)}
          color={netEdgeColor}
          sub={overall.avgPnlPct == null ? undefined : `avg ${fmtPct(overall.avgPnlPct, 2)} per bet`}
          layer="L5"
          source={{ label: 'supabase', query: 'sum(settled_pnl_usd)' }}
          rationale="Cumulative realized P&L across decisive settlements in the window. Net of fees (if settlementHook wrote net)."
        />
        <ExplainCard
          label="HORIZON"
          value={overall.medianHorizonHours == null ? '—' : `${overall.medianHorizonHours.toFixed(1)}h`}
          sub={overall.cancelRate > 0 ? `cancel ${fmtPct(overall.cancelRate, 0)}` : undefined}
          layer="L5"
          source={{ label: 'derived', query: 'median(settled_at - entered_at)' }}
          rationale="Median bet-to-settlement duration. Long horizons = capital locked longer."
        />
      </div>

      {/* Warnings */}
      {report.warnings && report.warnings.length > 0 && (
        <div style={{
          marginTop: 10,
          padding: '8px 12px',
          border: `1px solid ${C.orange}`,
          borderRadius: 6,
          background: `${C.orange}11`,
          color: C.orange,
          fontSize: 11,
          fontFamily: 'monospace',
        }}>
          <strong style={{ letterSpacing: '0.1em' }}>WARNINGS · {report.warnings.length}</strong>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {report.warnings.slice(0, 5).map((w, i) => (
              <li key={i} style={{ lineHeight: 1.5 }}>{w}</li>
            ))}
            {report.warnings.length > 5 && (
              <li style={{ color: C.muted }}>…+{report.warnings.length - 5} more — see /polymarket/audit/learning</li>
            )}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '0.2em', color: C.mutedLight, fontWeight: 700, marginBottom: 10 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}
