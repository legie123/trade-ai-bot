/**
 * /polymarket/audit — scan history index + brain scorecard (server component).
 *
 * FAZA 3.5 (scan table) + FAZA 3.11 (L5 brain scorecard) + FAZA 3.13 (edge watchdog).
 * Tabular view of recent cron scan runs. Clickable rows drill into
 * /polymarket/audit/scans/[runId]. BrainScorecard above the table
 * surfaces realized WR / PF / PnL from settlementHook writes. WatchdogBadge
 * on top classifies realized-edge health (UNKNOWN/HEALTHY/DEGRADED/UNHEALTHY).
 */
import Link from 'next/link';
import { listRecentScans } from '@/lib/polymarket/scanHistory';
import { ExplainCard } from '@/components/explain/ExplainCard';
import { BrainScorecard } from '@/components/polymarket/BrainScorecard';
import { WatchdogBadge } from '@/components/polymarket/WatchdogBadge';

export const dynamic = 'force-dynamic';

interface ScanRow {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  divisions_scanned: string[] | null;
  opportunities_found: number;
  bets_placed: number;
  decisions_logged: number;
  correlation_disabled: boolean;
}

const C = {
  text: '#f3f0e8',
  muted: '#6a5f52',
  mutedLight: '#a89a8a',
  blue: '#DAA520',
  green: '#4ade80',
  red: '#ef4444',
  border: 'rgba(218,165,32,0.15)',
  headerBg: 'rgba(218,165,32,0.05)',
};

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtAge(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export default async function AuditIndexPage() {
  const scans = (await listRecentScans(100)) as ScanRow[];

  // Aggregate quick stats over the listed window
  const totalOpps = scans.reduce((a, s) => a + (s.opportunities_found || 0), 0);
  const totalBets = scans.reduce((a, s) => a + (s.bets_placed || 0), 0);
  const totalDecisions = scans.reduce((a, s) => a + (s.decisions_logged || 0), 0);
  const activeCorrelation = scans.filter(s => !s.correlation_disabled).length;
  const hitRate = totalOpps > 0 ? ((totalBets / totalOpps) * 100).toFixed(1) : '—';

  return (
    <div>
      {/* FAZA 3.13 — Edge Watchdog (realized-edge verdict, shadow by default) */}
      <WatchdogBadge />

      {/* FAZA 3.11 — Brain scorecard (L5 LEARN, settled PnL) */}
      <BrainScorecard />

      <h1 style={{ fontSize: 20, letterSpacing: '0.1em', fontWeight: 800, marginBottom: 24, color: C.text }}>
        SCAN HISTORY · LAST {scans.length}
      </h1>

      {/* KPI strip — maieutic explain layer (L4 audit) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
        <ExplainCard
          label="RUNS"
          value={String(scans.length)}
          layer="L4"
          source={{ label: 'supabase', query: 'polymarket_scan_history' }}
          rationale="Cron scan-run count in current window. Gap = cron down or supabase migration missing."
        />
        <ExplainCard
          label="OPPORTUNITIES"
          value={String(totalOpps)}
          layer="L4"
          source={{ label: 'supabase', query: 'polymarket_scan_history.opportunities_found' }}
          rationale="Raw opps surfaced by scanner (pre-karma/pre-sentinel). Upstream signal volume."
          confidence={{
            level: scans.length >= 30 ? 'HIGH' : scans.length >= 10 ? 'MED' : 'LOW',
            sampleSize: scans.length,
            reason: 'Wilson heuristic on scan count',
          }}
        />
        <ExplainCard
          label="DECISIONS"
          value={String(totalDecisions)}
          layer="L4"
          source={{ label: 'supabase', query: 'polymarket_decisions' }}
          rationale="Decisions persisted post-gates. decisions<opps = selection working; decisions=0 = all gates closed."
          drillDownHref="/polymarket/audit/decisions"
          drillDownLabel="BY DECISION ↗"
        />
        <ExplainCard
          label="BETS PLACED"
          value={String(totalBets)}
          color={totalBets > 0 ? C.green : C.text}
          layer="L4"
          source={{ label: 'supabase', query: 'polymarket_scan_history.bets_placed' }}
          rationale={totalBets === 0 ? 'Zero bets — either phantom-mode or all decisions skipped.' : 'Live/phantom bets executed post-decision.'}
        />
        <ExplainCard
          label="HIT RATE"
          value={`${hitRate}%`}
          sub={`${activeCorrelation}/${scans.length} w/ correlation`}
          layer="L4"
          source={{ label: 'derived', query: 'bets_placed / opportunities_found' }}
          rationale="Selection efficiency: how much of surfaced signal converts to action."
          confidence={{
            level: totalOpps >= 100 ? 'HIGH' : totalOpps >= 30 ? 'MED' : 'LOW',
            sampleSize: totalOpps,
            reason: 'Sample = total opportunities in window',
          }}
        />
      </div>

      {/* Table */}
      {scans.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: C.muted, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
          No scan runs yet. Wait for next cron tick (every 15m) or check supabase migrations are applied.
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
            <thead style={{ background: C.headerBg }}>
              <tr>
                <Th>STARTED</Th>
                <Th>DUR</Th>
                <Th>DIVISIONS</Th>
                <Th align="right">OPPS</Th>
                <Th align="right">DECISIONS</Th>
                <Th align="right">BETS</Th>
                <Th>CORR</Th>
                <Th>RUN ID</Th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.run_id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <Td><span title={s.started_at}>{fmtAge(s.started_at)}</span></Td>
                  <Td>{fmtDuration(s.duration_ms)}</Td>
                  <Td>{(s.divisions_scanned || []).join(', ') || '—'}</Td>
                  <Td align="right">{s.opportunities_found}</Td>
                  <Td align="right">{s.decisions_logged}</Td>
                  <Td align="right" style={{ color: s.bets_placed > 0 ? C.green : C.muted }}>{s.bets_placed}</Td>
                  <Td style={{ color: s.correlation_disabled ? C.red : C.green }}>
                    {s.correlation_disabled ? 'OFF' : 'ON'}
                  </Td>
                  <Td>
                    <Link href={`/polymarket/audit/scans/${s.run_id}`} style={{ color: C.blue, textDecoration: 'none', fontWeight: 600 }}>
                      {s.run_id.slice(0, 8)}↗
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 10, color: C.muted, fontFamily: 'monospace', textAlign: 'right' }}>
        polymarket_scan_history · append-only · {new Date().toISOString()}
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
