'use client';
import { useEffect, useState } from 'react';
import styles from './styles.module.css';

interface DashboardState {
  system: { status: string; uptime: number; memoryUsageRssMB: number };
  watchdog: { status: string; crashCount: number };
  heartbeat: {
    status: string;
    providers: Record<string, { ok: boolean; lastLatencyMs: number | null }>;
  };
  killSwitch: { engaged: boolean; reason: string | null };
  trading: { totalSignals: number; pendingDecisions: number; executionsToday: number; dailyPnlPercent: number; openPositions: number };
  logs: { recent: { ts: string; level: string; msg: string }[]; errorCount1h: number };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('Failed to fetch dashboard data');
      const json = await res.json();
      setData(json);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    const inv = setInterval(fetchDashboard, 5000); // 5s refresh
    return () => clearInterval(inv);
  }, []);

  const toggleKillSwitch = async (engage: boolean) => {
    // Basic API implementation to trigger kill switch endpoints
    // For now we just mock the payload fetch since the API endpoints are in API logic
    await fetch('/api/bot', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'killswitch', engage }) 
    });
    fetchDashboard();
  };

  if (loading && !data) return <div className={styles.container}>Loading dashboard...</div>;
  if (error) return <div className={styles.container}>Error: {error}</div>;
  if (!data) return null;

  const isRed = data.system.status === 'RED' || data.killSwitch.engaged;
  const sysClass = isRed ? styles.statusRed : data.system.status === 'YELLOW' ? styles.statusYellow : styles.statusGreen;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          Trading AI <span className={styles.paperTag}>PAPER ONLY</span>
        </h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span className={sysClass} style={{ fontWeight: 'bold' }}>
            System: {data.system.status}
          </span>
          {data.killSwitch.engaged ? (
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => toggleKillSwitch(false)}>
              DISENGAGE KILL SWITCH
            </button>
          ) : (
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => toggleKillSwitch(true)}>
              ENGAGE KILL SWITCH
            </button>
          )}
        </div>
      </header>

      <div className={styles.grid}>
        {/* Core Metrics */}
        <div className={styles.card}>
          <h2>Core Monitor</h2>
          <div className={styles.statRow}>
            <span>Watchdog</span>
            <span className={data.watchdog.status === 'HEALTHY' ? styles.statusGreen : styles.statusRed}>
              {data.watchdog.status} (Crashes: {data.watchdog.crashCount})
            </span>
          </div>
          <div className={styles.statRow}>
            <span>Kill Switch</span>
            <span className={data.killSwitch.engaged ? styles.statusRed : styles.statusGreen}>
              {data.killSwitch.engaged ? `ENGAGED: ${data.killSwitch.reason}` : 'SAFE'}
            </span>
          </div>
          <div className={styles.statRow}>
            <span>Memory (RSS)</span>
            <span className={styles.statValue}>{data.system.memoryUsageRssMB} MB</span>
          </div>
          <div className={styles.statRow}>
            <span>Uptime</span>
            <span className={styles.statValue}>{(data.system.uptime / 3600).toFixed(1)}h</span>
          </div>
        </div>

        {/* Actionable Trading Stats */}
        <div className={styles.card}>
          <h2>Trading Pipeline</h2>
          <div className={styles.statRow}>
            <span>Total Signals Evaluated</span>
            <span className={styles.statValue}>{data.trading.totalSignals}</span>
          </div>
          <div className={styles.statRow}>
            <span>Open (Pending) Positions</span>
            <span className={styles.statValue}>{data.trading.openPositions} / {data.trading.pendingDecisions} waiting</span>
          </div>
          <div className={styles.statRow}>
            <span>Paper Fills Today</span>
            <span className={styles.statValue}>{data.trading.executionsToday}</span>
          </div>
          <div className={styles.statRow}>
            <span>Daily PnL (Estimated)</span>
            <span className={data.trading.dailyPnlPercent >= 0 ? styles.statusGreen : styles.statusRed}>
              {data.trading.dailyPnlPercent > 0 ? '+' : ''}{data.trading.dailyPnlPercent.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Provider Health */}
        <div className={styles.card}>
          <h2>Provider Health Integrations</h2>
          {Object.entries(data.heartbeat?.providers || {}).length === 0 ? (
            <div className={styles.statRow}><span style={{color: '#8b949e'}}>Awaiting heartbeat...</span></div>
          ) : (
            Object.entries(data.heartbeat.providers).map(([name, p]) => (
              <div key={name} className={styles.statRow}>
                <span style={{ textTransform: 'capitalize' }}>{name}</span>
                <span className={p.ok ? styles.statusGreen : styles.statusRed}>
                  {p.ok ? 'UP' : 'DOWN'} {p.lastLatencyMs && `(${p.lastLatencyMs}ms)`}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Structured Logs */}
      <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: '#c9d1d9' }}>
        System Execution Logs <span style={{fontSize:'0.9rem', color:'#8b949e', marginLeft:'1rem'}}>Auto-refreshing (Errors 1h: {data.logs.errorCount1h})</span>
      </h2>
      <div className={styles.logBox}>
        {data.logs.recent.length === 0 ? (
          <div style={{color: '#8b949e'}}>No logs yet. Waiting for cycle...</div>
        ) : (
          data.logs.recent.map((log, i) => {
            const levelClass =
              log.level === 'DEBUG' || log.level === 'INFO'
                ? styles.logInfo
                : log.level === 'WARN'
                ? styles.logWarn
                : log.level === 'ERROR'
                ? styles.logError
                : styles.logFatal;
            return (
              <div key={i} className={styles.logEntry}>
                <span className={styles.logTime}>{new Date(log.ts).toLocaleTimeString()}</span>
                <span className={levelClass}>[{log.level}]</span>{' '}
                <span style={{ color: '#fff' }}>{log.msg}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
