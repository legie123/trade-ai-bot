'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { LiveIndicator } from '@/components/LiveIndicator';
import BottomNav from '@/components/BottomNav';
import styles from './styles.module.css';

export default function DashboardPage() {
  const { dashboard: data, connectionStatus, lastUpdate, updateCount, reconnect, forceRefresh } = useRealtimeData();
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [ksLoading, setKsLoading] = useState(false);

  // Kick cron on mount
  useEffect(() => {
    fetch('/api/cron').catch(() => {});
  }, []);

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleKillSwitch = useCallback(async (engage: boolean) => {
    setKsLoading(true);
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'killswitch', engage }),
      });
      const json = await res.json();
      if (json.status === 'ok') {
        setToast({ msg: engage ? '🔴 Kill Switch ENGAGED' : '✅ Kill Switch DISENGAGED', type: 'ok' });
        await forceRefresh();
      } else {
        setToast({ msg: `❌ Error: ${json.error}`, type: 'err' });
      }
    } catch {
      setToast({ msg: '❌ Network error', type: 'err' });
    } finally {
      setKsLoading(false);
    }
  }, [forceRefresh]);

  const loading = !data;

  if (loading) return <div className={styles.container}>Loading dashboard...</div>;
  if (!data) return null;

  const isRed = data.system.status === 'RED' || data.killSwitch.engaged;
  const sysClass = isRed ? styles.statusRed : data.system.status === 'YELLOW' ? styles.statusYellow : styles.statusGreen;

  return (
    <div className={styles.container}>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'ok' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${toast.type === 'ok' ? '#10b981' : '#ef4444'}`,
          color: '#fff', fontSize: 13, fontWeight: 600,
          backdropFilter: 'blur(12px)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: 'slideInRight 0.3s ease-out',
        }}>
          {toast.msg}
        </div>
      )}
      <style>{`@keyframes slideInRight { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }`}</style>

      <header className={styles.header}>
        <h1 className={styles.title}>
          <img src="/dragon-logo.png" alt="Dragon AI" className={styles.dragonLogo} />
          Trading AI <span className={styles.paperTag}>PAPER ONLY</span>
        </h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <LiveIndicator
            status={connectionStatus}
            lastUpdate={lastUpdate}
            updateCount={updateCount}
            onReconnect={reconnect}
          />
          <span className={sysClass} style={{ fontWeight: 'bold' }}>
            System: {data.system.status}
          </span>
          {data.killSwitch.engaged ? (
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => handleKillSwitch(false)}
              disabled={ksLoading}
              style={{ opacity: ksLoading ? 0.6 : 1, cursor: ksLoading ? 'wait' : 'pointer' }}
            >
              {ksLoading ? '⏳ ...' : 'DISENGAGE KILL SWITCH'}
            </button>
          ) : (
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => handleKillSwitch(true)}
              disabled={ksLoading}
              style={{ opacity: ksLoading ? 0.6 : 1, cursor: ksLoading ? 'wait' : 'pointer' }}
            >
              {ksLoading ? '⏳ ...' : 'ENGAGE KILL SWITCH'}
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
            Object.entries(data.heartbeat?.providers || {}).map(([name, p]) => (
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
      <BottomNav />
    </div>
  );
}
