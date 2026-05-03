// Phase 5 Monitoring Page — Server Component, polls /api/v2/polymarket/phase5/dashboard
import { headers } from 'next/headers';
import type { Phase5DashboardResponse } from '@/app/api/v2/polymarket/phase5/dashboard/route';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

async function fetchDashboard(): Promise<Phase5DashboardResponse | null> {
  try {
    const h = await headers();
    const host = h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const url = `${proto}://${host}/api/v2/polymarket/phase5/dashboard`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as Phase5DashboardResponse;
  } catch {
    return null;
  }
}

function verdictColor(v: string | null | undefined): string {
  if (v === 'GREEN') return 'rgb(34 197 94)'; // emerald-500
  if (v === 'AMBER') return 'rgb(245 158 11)'; // amber-500
  if (v === 'RED') return 'rgb(239 68 68)'; // red-500
  return 'rgb(100 116 139)'; // slate-500
}

function fmtUsd(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

export default async function Phase5MonitoringPage() {
  const data = await fetchDashboard();

  if (!data || data.status !== 'ok') {
    return (
      <main style={{ padding: '24px', color: 'var(--fg, #e2e8f0)' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>Phase 5 Monitoring</h1>
        <p style={{ marginTop: '12px', color: 'rgb(248 113 113)' }}>
          Failed to load dashboard. Check Supabase connectivity or auth.
        </p>
      </main>
    );
  }

  const snap = (data.latestSnapshot ?? {}) as Record<string, unknown>;
  const weekly = (data.latestWeeklyReport ?? {}) as Record<string, unknown>;
  const verdict = (weekly.verdict as string | null) ?? null;

  return (
    <main style={{ padding: '24px', color: 'var(--fg, #e2e8f0)', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '20px', paddingBottom: '12px',
        borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
      }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>
            Phase 5 — Paper Forward 30 zile
          </h1>
          <p style={{ marginTop: '4px', color: 'rgb(148 163 184)', fontSize: '13px' }}>
            {new Date(data.phaseStart).toISOString().slice(0, 10)} →{' '}
            {new Date(data.phaseEnd).toISOString().slice(0, 10)}
            {' · '}Day {data.daysElapsed + 1} / 30 · {data.daysRemaining}d remaining
          </p>
        </div>
        <div style={{
          padding: '8px 16px', borderRadius: '6px',
          background: verdictColor(verdict),
          color: '#0f172a', fontWeight: 700, fontSize: '14px',
          letterSpacing: '0.05em',
        }}>
          {verdict ?? 'PENDING'}
        </div>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '16px',
      }}>
        {/* Wallet panel */}
        <Panel title="Wallet">
          <KV label="Balance" value={`$${fmtUsd(snap.wallet_balance_usdc)}`} />
          <KV label="Invested" value={`$${fmtUsd(snap.wallet_invested_usdc)}`} />
          <KV label="Unrealized PnL" value={`$${fmtUsd(snap.wallet_unrealized_pnl_usdc)}`} />
          <KV
            label="Realized PnL"
            value={`$${fmtUsd(snap.wallet_realized_pnl_usdc)}`}
            highlight={Number(snap.wallet_realized_pnl_usdc ?? 0) >= 0 ? 'pos' : 'neg'}
          />
          <KV label="Open positions" value={String(snap.open_positions_count ?? 0)} />
        </Panel>

        {/* Activity 24h */}
        <Panel title="Activity (last 24h)">
          <KV label="Acted" value={String(snap.decisions_acted_24h ?? 0)} />
          <KV label="Settled" value={String(snap.decisions_settled_24h ?? 0)} />
          <KV label="Wins" value={String(snap.wins_24h ?? 0)} />
          <KV label="Losses" value={String(snap.losses_24h ?? 0)} />
          <KV label="Win rate" value={fmtPct(snap.win_rate_24h)} />
        </Panel>

        {/* Risk */}
        <Panel title="Risk">
          <KV
            label="Max DD %"
            value={`${Number(snap.max_dd_pct ?? 0).toFixed(2)}%`}
            highlight={snap.dd_alarm_triggered ? 'neg' : 'pos'}
          />
          <KV
            label="DD alarm"
            value={snap.dd_alarm_triggered ? 'TRIGGERED' : 'OK'}
            highlight={snap.dd_alarm_triggered ? 'neg' : 'pos'}
          />
          <KV
            label="Settlement backlog"
            value={String(snap.settlement_backlog_count ?? 0)}
          />
        </Panel>

        {/* Live activity 7d */}
        <Panel title="Live (last 7d)">
          <KV label="Decisions" value={String(data.liveActivityLast7d.decisions)} />
          <KV label="Acted" value={String(data.liveActivityLast7d.acted)} />
          <KV label="Settled" value={String(data.liveActivityLast7d.settled)} />
          <KV label="Wins" value={String(data.liveActivityLast7d.wins)} />
          <KV label="Losses" value={String(data.liveActivityLast7d.losses)} />
          <KV label="WR" value={fmtPct(data.liveActivityLast7d.winRate)} />
        </Panel>

        {/* Shadow strategies */}
        <Panel title="Shadow strategies (last 7d)">
          {Object.keys(data.shadowStats).length === 0 ? (
            <p style={{ color: 'rgb(148 163 184)', fontSize: '13px', margin: 0 }}>
              No shadow proposals. Set POLY_SHADOW_SYNDICATE_ENABLED=1 to activate.
            </p>
          ) : (
            Object.entries(data.shadowStats).map(([sid, s]) => (
              <div key={sid} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{sid}</div>
                <div style={{ fontSize: '12px', color: 'rgb(148 163 184)' }}>
                  proposed={s.proposed} settled={s.settled} wins={s.wins}
                  {s.settled > 0 && ` (WR=${((s.wins / s.settled) * 100).toFixed(1)}%)`}
                </div>
              </div>
            ))
          )}
        </Panel>

        {/* Sparkline */}
        <Panel title="Realized PnL trend (last 30 snapshots)">
          <Sparkline
            values={data.recentSnapshots.map((s) => Number(s.wallet_realized_pnl_usdc ?? 0))}
          />
          <p style={{ fontSize: '11px', color: 'rgb(148 163 184)', marginTop: '8px' }}>
            {data.recentSnapshots.length} snapshots · daily 06:00 UTC
          </p>
        </Panel>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: '24px', padding: '12px 16px',
        background: 'rgba(148, 163, 184, 0.05)', borderRadius: '6px',
        fontSize: '12px', color: 'rgb(148 163 184)',
      }}>
        Day-30 verdict fires automatically on 2026-06-02 08:00 UTC via Cloud Scheduler.
        Verdict logic: WR≥55% + PF≥1.2 → PROMOTE_TO_PILOT · MaxDD&gt;30% → KILL_AND_RESEARCH ·
        sample&lt;100 settled → EXTEND_PAPER.
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      padding: '16px',
      border: '1px solid rgba(148, 163, 184, 0.15)',
      borderRadius: '8px',
      background: 'rgba(15, 23, 42, 0.4)',
    }}>
      <h2 style={{
        fontSize: '12px', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'rgb(148 163 184)', margin: '0 0 12px 0',
      }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function KV({
  label, value, highlight,
}: {
  label: string;
  value: string;
  highlight?: 'pos' | 'neg';
}) {
  const color = highlight === 'pos' ? 'rgb(74 222 128)' :
                highlight === 'neg' ? 'rgb(248 113 113)' : 'inherit';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '4px 0', fontSize: '13px',
    }}>
      <span style={{ color: 'rgb(148 163 184)' }}>{label}</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <p style={{ color: 'rgb(148 163 184)', fontSize: '12px', margin: 0 }}>
        Need ≥2 snapshots for trend.
      </p>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 280;
  const height = 60;
  const stepX = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
  const lastPositive = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={lastPositive ? 'rgb(74 222 128)' : 'rgb(248 113 113)'}
        strokeWidth={2}
      />
    </svg>
  );
}
