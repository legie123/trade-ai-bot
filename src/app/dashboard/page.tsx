'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { LiveIndicator } from '@/components/LiveIndicator';
import BottomNav from '@/components/BottomNav';
import EquityCurve from '@/components/EquityCurve';
import { SyndicateFeed } from '@/components/SyndicateFeed';
import styles from './styles.module.css';

interface ArenaData {
  activeFighters: number;
  superAiOmega?: { rank: string; trainingProgress: number; winRate: string; status: string };
  leaderboard: Array<{ id: string; name: string; isLive: boolean; winRate: string; totalTrades: number }>;
}

export default function DashboardPage() {
  const { dashboard: data, bot, connectionStatus, lastUpdate, updateCount, reconnect, forceRefresh } = useRealtimeData();
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [ksLoading, setKsLoading] = useState(false);

  const [arenaData, setArenaData] = useState<ArenaData | null>(null);

  // Kick cron and arena states on mount
  useEffect(() => {
    fetch('/api/cron').catch(() => {});
    
    const fetchArena = () => {
      fetch('/api/v2/arena')
        .then(res => res.json())
        .then(data => setArenaData(data))
        .catch(() => {});
    };
    fetchArena();
    const t = setInterval(fetchArena, 15000);
    return () => clearInterval(t);
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
        setToast({ msg: engage ? '🔴 Kill Switch ENGAGED' : '✅ Autonomy RESTORED', type: 'ok' });
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

  if (loading) return <div className={styles.container}><div style={{textAlign:'center', marginTop:'20vh', color:'#a78bfa', fontFamily: 'monospace'}}>Initializing Agentic Core...</div></div>;
  if (!data) return null;

  const isRed = data.system.status === 'RED' || data.killSwitch.engaged;
  const sysClass = isRed ? styles.statusRed : data.system.status === 'YELLOW' ? styles.statusYellow : styles.statusGreen;

  // Deriving some "Agentic" mock stats from real data
  const baseConfidence = Math.min(100, Math.max(10, 50 + (data.trading.dailyPnlPercent * 10) - (data.trading.pendingDecisions * 2)));
  const agentState = data.killSwitch.engaged ? 'HALTED (OVERRIDE)' 
                     : data.trading.pendingDecisions > 0 ? 'SYNTHESIZING MARKET DATA...'
                     : data.trading.openPositions > 0 ? 'MONITORING EXECUTIONS' 
                     : 'SCANNING FREQUENCIES';

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
          <div className={styles.brainCore}></div>
          Trade AI <span className={styles.paperTag}>PHOENIX V2 ACTIVE</span>
        </h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {bot?.config?.haltedUntil && new Date(bot.config.haltedUntil) > new Date() && (
            <div className={styles.haltBadge}>
              🛡️ HALTED (COOLDOWN UNTIL {new Date(bot.config.haltedUntil).toLocaleTimeString()})
            </div>
          )}
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
              {ksLoading ? '⏳ ...' : '🔓 RESTORE AUTONOMY'}
            </button>
          ) : (
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => handleKillSwitch(true)}
              disabled={ksLoading}
              style={{ opacity: ksLoading ? 0.6 : 1, cursor: ksLoading ? 'wait' : 'pointer' }}
            >
              {ksLoading ? '⏳ ...' : '🛑 OVERRIDE (KILL SWITCH)'}
            </button>
          )}
        </div>
      </header>

      <div className={styles.cockpitGrid}>
        
        {/* LEFT COLUMN: Pulse & Swarm Connectivity */}
        <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
          
          <div className={styles.glassPanel} style={{'--panel-accent': '#22d3ee'} as React.CSSProperties}>
            <h2 className={styles.panelTitle}><span>🧠</span> Core Logic State</h2>
            <div className={styles.statRow}>
              <span>Status</span>
              <span className={styles.statusCyan}>{agentState}</span>
            </div>
            <div className={styles.statRow}>
              <span>Memory Cortex</span>
              <span className={styles.statValue}>{data.system.memoryUsageRssMB} MB</span>
            </div>
            <div className={styles.statRow}>
              <span>Uptime</span>
              <span className={styles.statValue}>{(data.system.uptime / 3600).toFixed(1)}h</span>
            </div>
            <div className={styles.statRow}>
              <span>Neural Watchdog</span>
              <span className={data.watchdog.status === 'HEALTHY' ? styles.statusGreen : styles.statusRed}>
                {data.watchdog.status}
              </span>
            </div>
          </div>

          <div className={styles.glassPanel} style={{'--panel-accent': '#f59e0b'} as React.CSSProperties}>
            <h2 className={styles.panelTitle}><span>⚔️</span> The Arena (Gladiator Forge)</h2>
            <div className={styles.statRow}>
              <span>Active Strategies</span>
              <span className={styles.statusGreen}>{arenaData?.activeFighters || 0} LIVE</span>
            </div>
            
            {arenaData?.leaderboard?.map((g, idx) => (
                <div key={idx} style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '0.5rem', background: 'rgba(0,0,0,0.4)', marginBottom: '0.3rem', borderRadius: '4px', borderLeft: g.isLive ? '2px solid #ef4444' : '2px solid #a78bfa'}}>
                   <span style={{color: '#fff'}}>{g.name.slice(0, 15)}... {g.isLive && <span style={{color: '#ef4444', fontSize:'0.7rem'}}>[LIVE]</span>}</span>
                   <span style={{color: '#10b981', fontWeight: 600}}>{g.winRate}% W ({g.totalTrades} fights)</span>
                </div>
            ))}

            <div style={{fontSize: '0.85rem', color: '#9ca3af', lineHeight: 1.5, marginTop: '1rem', fontStyle: 'italic', background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderLeft: '3px solid #f59e0b', borderRadius: '4px'}}>
              &quot;The Arena generates over 50 simulated conflicts daily. DNA patterns are continuously extracted for the Super AI.&quot;
            </div>
          </div>

          <div className={styles.glassPanel} style={{'--panel-accent': '#a855f7', overflow: 'hidden'} as React.CSSProperties}>
            <h2 className={styles.panelTitle}><span>⚖️</span> Syndicate Master Arguments</h2>
            <div style={{maxHeight: '400px', overflowY: 'auto', margin: '0 -1.5rem'}}>
               <SyndicateFeed audits={bot?.syndicateAudits || []} />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Autonomous Decision Matrix & Logs */}
        <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
          
          <div className={styles.glassPanel} style={{'--panel-accent': '#10b981', padding: '1rem'} as React.CSSProperties}>
            <h2 className={styles.panelTitle} style={{marginBottom: '0.5rem'}}><span>📈</span> Equity Trajectory (Live)</h2>
            {bot?.equityCurve && bot?.config ? (
              <EquityCurve data={bot.equityCurve} initialBalance={bot.config.paperBalance} />
            ) : (
              <div style={{color:'#6b7280', fontSize:'0.85rem', padding:'1rem 0'}}>Preparing neural equity chart...</div>
            )}
          </div>

          <div className={styles.glassPanel} style={{'--panel-accent': '#d4af37'} as React.CSSProperties}>
            <h2 className={styles.panelTitle}><span>⚖️</span> Dual Master Consciousness</h2>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                 <div style={{color: '#9ca3af', fontSize:'0.85rem'}}>Open Positions</div>
                 <div style={{fontSize: '1.8rem', fontWeight: 700, color: '#fff'}}>{data.trading.openPositions}</div>
              </div>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                 <div style={{color: '#9ca3af', fontSize:'0.85rem'}}>Neural PnL (Daily)</div>
                 <div className={data.trading.dailyPnlPercent >= 0 ? styles.statusGreen : styles.statusRed} style={{fontSize: '1.8rem', fontWeight: 700}}>
                   {data.trading.dailyPnlPercent > 0 ? '+' : ''}{data.trading.dailyPnlPercent.toFixed(2)}%
                 </div>
              </div>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                 <div style={{color: '#9ca3af', fontSize:'0.85rem'}}>Super AI (Omega)</div>
                 <div style={{fontSize: '1.4rem', fontWeight: 700, color: '#fff'}}>{arenaData?.superAiOmega?.trainingProgress || 0}% Trained</div>
                 <div style={{color: '#a78bfa', fontSize:'0.75rem', marginTop: '0.3rem'}}>[{arenaData?.superAiOmega?.status || 'IN_TRAINING'}]</div>
              </div>
            </div>

            <div style={{marginTop: '1rem'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.4rem'}}>
                <span>Dual AI Arbitration Agreement</span>
                <span style={{color: '#fff', fontWeight: 600}}>{baseConfidence.toFixed(1)}%</span>
              </div>
              <div className={styles.confidenceBarBg}>
                <div className={styles.confidenceBarFill} style={{ width: `${baseConfidence}%` }}></div>
              </div>
            </div>
          </div>

          <div className={styles.glassPanel} style={{'--panel-accent': '#ef4444', padding: 0, flexGrow: 1, display: 'flex', flexDirection: 'column'} as React.CSSProperties}>
            <h2 className={styles.panelTitle} style={{padding: '1.2rem 1.5rem 0', marginBottom: '0.8rem'}}><span>💻</span> Neural Execution Log</h2>
            <div className={styles.terminalWrapper} style={{border: 'none', borderRadius: '0 0 16px 16px', flexGrow: 1}}>
              {data.logs.recent.length === 0 ? (
                <div style={{color: '#6b7280'}}>Agent is idle. Waiting for market stimulus...</div>
              ) : (
                data.logs.recent.map((log, i) => {
                  let levelClass = styles.logInfo;
                  if (log.msg.includes('AI') || log.msg.includes('Swarm') || log.msg.includes('Sentiment')) levelClass = styles.logNeural;
                  else if (log.level === 'WARN') levelClass = styles.logWarn;
                  else if (log.level === 'ERROR') levelClass = styles.logError;
                  else if (log.level === 'FATAL') levelClass = styles.logFatal;

                  return (
                    <div key={i} className={styles.logEntry}>
                      <span className={styles.logTime}>[{new Date(log.ts).toLocaleTimeString()}]</span>
                      <span className={levelClass}>&gt; {log.msg}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

      </div>

      <BottomNav />
    </div>
  );
}
