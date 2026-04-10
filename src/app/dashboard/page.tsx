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

  // Defensive: ensure all nested objects exist to prevent client-side crash
  const system = data?.system || { status: 'LOADING', uptime: 0, memoryUsageRssMB: 0 };
  const trading = data?.trading || { totalSignals: 0, pendingDecisions: 0, executionsToday: 0, dailyPnlPercent: 0, openPositions: 0 };
  const killSwitchState = data?.killSwitch || { engaged: false, reason: null };
  const watchdogState = data?.watchdog || { status: 'UNKNOWN', crashCount: 0, alive: false };
  const logsData = data?.logs || { recent: [], errorCount1h: 0 };

  const sysStateStr = system.status || '';
  const isRed = sysStateStr.includes('CRITICAL') || sysStateStr.includes('DEGRADED') || sysStateStr.includes('HALTED') || killSwitchState.engaged;
  const isYellow = sysStateStr.includes('WARNING') || sysStateStr.includes('OBSERVATION') || sysStateStr.includes('LOADING');
  const sysClass = isRed ? styles.statusRed : isYellow ? styles.statusYellow : styles.statusGreen;

  // Deriving some "Agentic" stats from real data
  const baseConfidence = Math.min(100, Math.max(10, 50 + ((trading.dailyPnlPercent || 0) * 10) - ((trading.pendingDecisions || 0) * 2)));
  const agentState = killSwitchState.engaged ? 'HALTED (OVERRIDE)' 
                     : trading.pendingDecisions > 0 ? 'SYNTHESIZING MARKET DATA...'
                     : trading.openPositions > 0 ? 'MONITORING EXECUTIONS' 
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
            <div className={styles.haltBadge} suppressHydrationWarning>
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
            System: {system.status}
          </span>
          {killSwitchState.engaged ? (
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
              <span className={styles.statValue}>{system.memoryUsageRssMB} MB</span>
            </div>
            <div className={styles.statRow}>
              <span>Uptime</span>
              <span className={styles.statValue}>{((system.uptime || 0) / 3600).toFixed(1)}h</span>
            </div>
            <div className={styles.statRow}>
              <span>Neural Watchdog</span>
              <span className={watchdogState.status === 'HEALTHY' ? styles.statusGreen : styles.statusRed}>
                {watchdogState.status}
              </span>
            </div>
            {system.syncQueue && (
              <>
                <div style={{borderTop: '1px solid rgba(255,255,255,0.06)', margin: '0.6rem 0', paddingTop: '0.6rem'}}>
                  <div style={{fontSize: '0.75rem', color: '#22d3ee', fontWeight: 600, marginBottom: '0.4rem', letterSpacing: '0.05em'}}>⚡ SYNC PIPELINE</div>
                </div>
                <div className={styles.statRow}>
                  <span>Queue Pending</span>
                  <span style={{
                    color: system.syncQueue.pending > 5 ? '#ef4444' : system.syncQueue.pending > 0 ? '#f59e0b' : '#10b981',
                    fontWeight: 700,
                    fontFamily: 'monospace'
                  }}>
                    {system.syncQueue.pending} {system.syncQueue.pending === 0 ? '✓' : '⏳'}
                  </span>
                </div>
                <div className={styles.statRow}>
                  <span>Total Synced</span>
                  <span className={styles.statValue} style={{fontFamily: 'monospace'}}>
                    {system.syncQueue.totalCompleted.toLocaleString()}
                  </span>
                </div>
                <div className={styles.statRow}>
                  <span>Last Sync</span>
                  <span style={{color: '#9ca3af', fontSize: '0.75rem', fontFamily: 'monospace'}} suppressHydrationWarning>
                    {new Date(system.syncQueue.lastSyncComplete).toLocaleTimeString()}
                  </span>
                </div>
              </>
            )}
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
            
            {/* NEW WINDOW FOR LIVE EQUITY DETAILED EXPLANATION */}
            <div style={{ marginTop: '1.5rem', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '1rem', border: '1px solid rgba(16,185,129,0.15)' }}>
              <h3 style={{ fontSize: '0.85rem', color: '#10b981', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                <span className={styles.pulseGreen} style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 8px #10b981' }}></span>
                LIVE EQUITY & SYSTEM EXPLANATION
              </h3>
              <div style={{ color: '#d1d5db', fontSize: '0.75rem', lineHeight: 1.6, fontFamily: 'monospace' }}>
                {bot?.equityCurve && bot.equityCurve.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '4px', borderLeft: '2px solid var(--accent-cyan)' }}>
                      <strong>[MARKET EXPOSURE]</strong> The Vanguard core is holding <strong style={{color: '#fff'}}>{trading.openPositions}</strong> active positions. Capital at risk: <strong style={{color: '#fff'}}>{trading.openPositions > 0 ? (trading.openPositions * (bot.config?.riskPerTrade || 2)).toFixed(1) + '%' : '0%'}</strong> of portfolio balance.
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '4px', borderLeft: '2px solid var(--accent-green)' }}>
                      <strong>[LATEST ACTION]</strong> Most recent outcome was a <strong style={{color: bot.equityCurve[bot.equityCurve.length - 1].outcome === 'WIN' ? '#10b981' : bot.equityCurve[bot.equityCurve.length - 1].outcome === 'LOSS' ? '#ef4444' : '#f59e0b'}}>{bot.equityCurve[bot.equityCurve.length - 1].outcome}</strong> execution {bot.equityCurve[bot.equityCurve.length - 1].symbol ? `on ${bot.equityCurve[bot.equityCurve.length - 1].symbol}` : ''}.
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: '4px', borderLeft: '2px solid var(--accent-purple)' }}>
                      <strong>[TRAJECTORY SHIFT]</strong> Equity {bot.config && bot.equityCurve[bot.equityCurve.length - 1].balance >= bot.config.paperBalance ? 'is expanding' : 'is compressing'}. Current live reserve stands at <strong style={{color: '#fff'}}>${bot.equityCurve[bot.equityCurve.length - 1].balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>.
                    </div>
                    <div style={{ fontStyle: 'italic', color: '#6b7280', marginTop: '4px' }}>
                      &gt;_ Next recalculation depends on live order flow accumulation and multi-agent consensus validation across {arenaData?.activeFighters || 3} active sub-modules. Let the Syndicate orchestrate...
                    </div>
                  </div>
                ) : (
                  <div className="pulse" style={{ padding: '8px', textAlign: 'center', color: '#9ca3af' }}>Waiting for first trade execution to trace trajectory...</div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.glassPanel} style={{'--panel-accent': '#d4af37'} as React.CSSProperties}>
            <h2 className={styles.panelTitle}><span>⚖️</span> Dual Master Consciousness</h2>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                 <div style={{color: '#9ca3af', fontSize:'0.85rem'}}>Open Positions</div>
                 <div style={{fontSize: '1.8rem', fontWeight: 700, color: '#fff'}}>{trading.openPositions}</div>
              </div>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                 <div style={{color: '#9ca3af', fontSize:'0.85rem'}}>Neural PnL (Daily)</div>
                 <div className={(trading.dailyPnlPercent || 0) >= 0 ? styles.statusGreen : styles.statusRed} style={{fontSize: '1.8rem', fontWeight: 700}}>
                   {(trading.dailyPnlPercent || 0) > 0 ? '+' : ''}{(trading.dailyPnlPercent || 0).toFixed(2)}%
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
              {logsData.recent.length === 0 ? (
                <div style={{color: '#6b7280'}}>Agent is idle. Waiting for market stimulus...</div>
              ) : (
                logsData.recent.map((log, i) => {
                  let levelClass = styles.logInfo;
                  if (log.msg.includes('AI') || log.msg.includes('Swarm') || log.msg.includes('Sentiment')) levelClass = styles.logNeural;
                  else if (log.level === 'WARN') levelClass = styles.logWarn;
                  else if (log.level === 'ERROR') levelClass = styles.logError;
                  else if (log.level === 'FATAL') levelClass = styles.logFatal;

                  return (
                    <div key={i} className={styles.logEntry}>
                      <span className={styles.logTime} suppressHydrationWarning>[{new Date(log.ts).toLocaleTimeString()}]</span>
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
