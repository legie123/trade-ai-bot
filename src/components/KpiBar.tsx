'use client';

interface KpiBarProps {
  equity: number;
  pnl24h: number;
  maxDrawdown: number;
  riskMode: string;
  lastSync: string | null;
  systemHealth: string;
}

export default function KpiBar({ equity, pnl24h, maxDrawdown, riskMode, lastSync, systemHealth }: KpiBarProps) {
  const pnlColor = pnl24h >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  const healthColor = systemHealth === 'EXCELLENT' ? 'var(--accent-green)'
    : systemHealth === 'GOOD' ? 'var(--accent-cyan)'
    : systemHealth === 'CAUTION' ? 'var(--accent-amber)'
    : 'var(--accent-red)';

  return (
    <div className="kpi-bar">
      <div className="kpi-item">
        <span className="kpi-label">EQUITY</span>
        <span className="kpi-value">${equity.toLocaleString()}</span>
      </div>
      <div className="kpi-divider" />
      <div className="kpi-item">
        <span className="kpi-label">24H P&L</span>
        <span className="kpi-value" style={{ color: pnlColor }}>
          {pnl24h >= 0 ? '+' : ''}{pnl24h.toFixed(2)}%
        </span>
      </div>
      <div className="kpi-divider" />
      <div className="kpi-item">
        <span className="kpi-label">MAX DD</span>
        <span className="kpi-value" style={{ color: 'var(--accent-red)' }}>
          -{maxDrawdown.toFixed(1)}%
        </span>
      </div>
      <div className="kpi-divider" />
      <div className="kpi-item">
        <span className="kpi-label">RISK</span>
        <span className="kpi-value kpi-risk" style={{
          color: riskMode === 'LIVE' ? 'var(--accent-green)' : 'var(--accent-amber)'
        }}>
          {riskMode === 'LIVE' ? '🟢' : '🟡'} {riskMode}
        </span>
      </div>
      <div className="kpi-divider" />
      <div className="kpi-item">
        <span className="kpi-label">HEALTH</span>
        <span className="kpi-value" style={{ color: healthColor, fontSize: 12 }}>
          {systemHealth}
        </span>
      </div>
      {lastSync && (
        <>
          <div className="kpi-divider" />
          <div className="kpi-item">
            <span className="kpi-label">SYNC</span>
            <span className="kpi-value" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {lastSync}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
