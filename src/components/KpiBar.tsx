'use client';

interface KpiBarProps {
  equity: number;
  pnl24h: number;
  maxDrawdown: number;
  riskMode: string;
  lastSync: string | null;
  systemHealth: string;
  winRate?: number;
  totalDecisions?: number;
  todayDecisions?: number;
}

export default function KpiBar({
  equity, pnl24h, maxDrawdown, riskMode, lastSync, systemHealth,
  winRate, totalDecisions, todayDecisions,
}: KpiBarProps) {
  const pnlColor = pnl24h >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  const healthColor = systemHealth === 'EXCELLENT' ? 'var(--accent-green)'
    : systemHealth === 'GOOD' ? 'var(--accent-cyan)'
    : systemHealth === 'SYNCING' ? 'var(--accent-amber)'
    : systemHealth === 'CAUTION' ? 'var(--accent-amber)'
    : 'var(--accent-red)';

  const wrColor = (winRate ?? 0) >= 55 ? 'var(--accent-green)'
    : (winRate ?? 0) >= 40 ? 'var(--accent-cyan)'
    : (winRate ?? 0) > 0 ? 'var(--accent-red)'
    : 'var(--text-muted)';

  return (
    <div className="kpi-bar" role="status" aria-label="Trading performance metrics">
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
        <span className="kpi-value" style={{ color: maxDrawdown > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
          -{maxDrawdown.toFixed(1)}%
        </span>
      </div>
      <div className="kpi-divider" />
      {winRate !== undefined && (
        <>
          <div className="kpi-item">
            <span className="kpi-label">WIN RATE</span>
            <span className="kpi-value" style={{ color: wrColor }}>
              {winRate}%
            </span>
          </div>
          <div className="kpi-divider" />
        </>
      )}
      {totalDecisions !== undefined && (
        <>
          <div className="kpi-item">
            <span className="kpi-label">TRADES</span>
            <span className="kpi-value" style={{ fontSize: 12 }}>
              {todayDecisions ?? 0}<span style={{ color: 'var(--text-muted)', fontSize: 10 }}>/{totalDecisions}</span>
            </span>
          </div>
          <div className="kpi-divider" />
        </>
      )}
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
