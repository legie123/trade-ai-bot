/**
 * /desk-preview — FAZA FE-3 (2026-04-26)
 *
 * Storybook-style showcase for desk components. Gated by env so it does NOT
 * leak into prod by default. Useful for visual QA pre-rollout and as living
 * docs for the FE-3 primitives.
 *
 * Activation:
 *   Cloud Run env NEXT_PUBLIC_DESK_PREVIEW_ENABLED=1 + redeploy.
 *
 * Kill: unset env -> page returns notFound() (404).
 *
 * No data fetching, no auth surface. Pure component showcase with mock data.
 */

import { notFound } from 'next/navigation';
import SectionHeader from '@/components/desk/SectionHeader';
import StatusChip from '@/components/desk/StatusChip';
import NumericCell from '@/components/desk/NumericCell';
import DenseTable, { type Column } from '@/components/desk/DenseTable';
import GrafanaPanel from '@/components/desk/GrafanaPanel';

type GladiatorRow = {
  id: string;
  name: string;
  tt: number;
  wr: number;
  pf: number;
  pnl: number;
  status: 'LIVE' | 'CONFIGURED' | 'KILLED';
};

const MOCK_ROWS: GladiatorRow[] = [
  { id: 'gw-btc-swing', name: 'BTC Swing Macro', tt: 64, wr: 56.3, pf: 1.46, pnl: 12.4, status: 'LIVE' },
  { id: 'gw-eth-defi',  name: 'ETH Swing DeFi',  tt: 51, wr: 58.8, pf: 1.38, pnl: 8.7,  status: 'LIVE' },
  { id: 'gw-sol-mom',   name: 'SOL Momentum',    tt: 33, wr: 42.4, pf: 0.96, pnl: -3.2, status: 'CONFIGURED' },
  { id: 'gw-arb-mr',    name: 'ARB Mean-Revert', tt: 28, wr: 39.3, pf: 0.84, pnl: -5.1, status: 'CONFIGURED' },
  { id: 'gw-avax-bo',   name: 'AVAX Breakout',   tt: 18, wr: 27.7, pf: 0.62, pnl: -8.9, status: 'KILLED' },
];

const COLUMNS: Column<GladiatorRow>[] = [
  { key: 'name', label: 'Gladiator', sortable: true, width: 220 },
  {
    key: 'status', label: 'Status', sortable: true, width: 130,
    render: (r) => (
      <StatusChip
        variant={r.status === 'LIVE' ? 'success' : r.status === 'KILLED' ? 'danger' : 'neutral'}
        label={r.status}
      />
    ),
  },
  {
    key: 'tt', label: 'TT', sortable: true, align: 'right', width: 70,
    render: (r) => <NumericCell value={r.tt} format="integer" showSign={false} />,
  },
  {
    key: 'wr', label: 'WR%', sortable: true, align: 'right', width: 90,
    render: (r) => (
      <NumericCell value={r.wr} format="percent" decimals={1}
        thresholds={{ strongUp: 55, strongDown: 45, flat: 0.5 }} showSign={false} />
    ),
  },
  {
    key: 'pf', label: 'PF', sortable: true, align: 'right', width: 80,
    render: (r) => (
      <NumericCell value={r.pf - 1} format="number" decimals={2}
        thresholds={{ strongUp: 0.3, strongDown: 0.2, flat: 0.05 }} showSign={false}
        suffix="x" />
    ),
  },
  {
    key: 'pnl', label: 'PnL%', sortable: true, align: 'right', width: 100,
    render: (r) => (
      <NumericCell value={r.pnl} format="pnl" decimals={1}
        thresholds={{ strongUp: 5, strongDown: 5, flat: 0.5 }} />
    ),
  },
];

export default function DeskPreviewPage() {
  if (process.env.NEXT_PUBLIC_DESK_PREVIEW_ENABLED !== '1') {
    notFound();
  }

  return (
    <div className="page-container">
      <SectionHeader trailing={<span style={{ fontSize: 11 }}>FAZA FE-3 · component showcase</span>}>
        Desk Components Preview
      </SectionHeader>

      <div style={{ marginTop: 24 }}>
        <SectionHeader>Status Chips</SectionHeader>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <StatusChip variant="success" label="LIVE" />
          <StatusChip variant="info" label="CONFIGURED" />
          <StatusChip variant="warn" label="DEGRADED" />
          <StatusChip variant="danger" label="KILLED" />
          <StatusChip variant="neutral" label="UNKNOWN" />
          <StatusChip variant="success" label="GREEN" dot={false} />
          <StatusChip variant="warn" label="AMBER" dot={false} />
          <StatusChip variant="danger" label="RED" dot={false} />
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionHeader>Numeric Cells (graded color)</SectionHeader>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8, fontSize: 14 }}>
          <span><span className="text-muted">PnL+5.2: </span><NumericCell value={5.2} format="pnl" /></span>
          <span><span className="text-muted">PnL+0.3: </span><NumericCell value={0.3} format="pnl" /></span>
          <span><span className="text-muted">PnL 0.0: </span><NumericCell value={0.0} format="pnl" /></span>
          <span><span className="text-muted">PnL-0.4: </span><NumericCell value={-0.4} format="pnl" /></span>
          <span><span className="text-muted">PnL-3.1: </span><NumericCell value={-3.1} format="pnl" /></span>
          <span><span className="text-muted">WR 62.3%: </span><NumericCell value={62.3} format="percent" decimals={1} thresholds={{ strongUp: 55, strongDown: 45, flat: 0.5 }} showSign={false} /></span>
          <span><span className="text-muted">null: </span><NumericCell value={null} format="pnl" /></span>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionHeader trailing={<span>{MOCK_ROWS.length} rows</span>}>Dense Table (sortable)</SectionHeader>
        <div style={{ marginTop: 8 }}>
          <DenseTable<GladiatorRow>
            columns={COLUMNS}
            rows={MOCK_ROWS}
            density="normal"
            rowKey={(r) => r.id}
            emptyLabel="No gladiators"
            maxHeight={360}
          />
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionHeader>Grafana Panel Wrapper</SectionHeader>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <GrafanaPanel
            uid="tradeai-premium"
            panelId={1}
            height={220}
            title="Tradeai Brain Status"
            refreshSec={30}
          />
          <GrafanaPanel
            uid="tradeai-premium"
            panelId={2}
            height={220}
            title="Arena Pool Snapshot"
            refreshSec={30}
          />
        </div>
      </div>

      <div style={{ marginTop: 32, padding: 12, border: '1px dashed var(--border)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--text-muted)' }}>
        Page gated by NEXT_PUBLIC_DESK_PREVIEW_ENABLED=1. Toggle off via Cloud Run env.
        Components imported from <code>src/components/desk/*</code>. Theme follows{' '}
        <code>&lt;html data-ui&gt;</code> attr (FE-1 wired).
      </div>
    </div>
  );
}
