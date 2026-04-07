'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { TradingViewPanel } from '@/components/TradingViewChart';
import KpiBar from '@/components/KpiBar';
import PipelineStatus from '@/components/PipelineStatus';
import InstallPwaButton from '@/components/InstallPwaButton';
import { LiveIndicator } from '@/components/LiveIndicator';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import EquityCurve from '@/components/EquityCurve';

// ============================================================
// Bot Command Center — Intelligence Dashboard
// ============================================================

interface BotData {
  stats: {
    mode: string;
    totalDecisions: number;
    todayDecisions: number;
    overallWinRate: number;
    todayWinRate: number;
    totalPnlPercent: number;
    todayPnlPercent: number;
    maxDrawdown: number;
    currentStreak: number;
    streakType: string;
    strategyHealth: string;
    optimizerVersion: number;
    lastOptimized: string | null;
  };
  decisions: Array<{
    id: string;
    symbol: string;
    signal: string;
    direction: string;
    confidence: number;
    price: number;
    timestamp: string;
    outcome: string;
    pnlPercent: number | null;
    ema50: number;
    ema200: number;
    ema800: number;
  }>;
  performance: Array<{
    signalType: string;
    source: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnlPercent: number;
    bestTrade: number;
    worstTrade: number;
  }>;
  optimizer: {
    version: number;
    weights: Record<string, number>;
    lastOptimizedAt: string;
    history: Array<{
      date: string;
      weightChanges: Record<string, { from: number; to: number }>;
      winRateBefore: number;
      winRateAfter: number;
    }>;
  };
  config: {
    mode: string;
    autoOptimize: boolean;
    paperBalance: number;
    riskPerTrade: number;
    maxOpenPositions: number;
    aiStatus?: 'OK' | 'NO_CREDIT';
  };
  equityCurve: Array<{
    timestamp: string;
    pnl: number;
    balance: number;
    outcome: string;
    signal: string;
    symbol: string;
  }>;
  balance?: number;
  strategies: Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    targetAssets: string[];
    risk: { stopLossPercent: number; takeProfitPercent: number; trailingStopEnabled: boolean };
  }>;
  gladiators: Array<{
    id: string;
    status: string;
    arena: string;
    winRate: number;
    trainingProgress: number;
    isOmega?: boolean;
    genes: Record<string, unknown>;
  }>;
  v2Entities: {
    masters: Array<{ id: string; name: string; role: string; status: string; power: number }>;
    manager: { name: string; role: string; status: string; description: string };
    sentinels: { 
      riskShield: { name: string; limit: string; active: boolean; triggered: boolean }; 
      lossDaily: { name: string; limit: string; active: boolean; triggered: boolean };
      watchdog?: { name: string; limit: string; active: boolean; triggered: boolean };
      killSwitch?: { name: string; limit: string; active: boolean; triggered: boolean; reason: string | null };
    };
    promoter: { name: string; role: string; status: string };
    scouts: { name: string; role: string; status: string };
  } | null;
}

export default function BotCenterPage() {
  // ── Real-time SSE connection (replaces all polling) ──
  const { data: realtimeData, bot: rtBot, connectionStatus, lastUpdate, updateCount, forceRefresh, reconnect } = useRealtimeData();

  const [actionStatus, setActionStatus] = useState<string>('');
  const [binanceStatus, setBinanceStatus] = useState<string>('—');
  const [telegramOk, setTelegramOk] = useState<boolean | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  // Construct BotData from real-time stream
  const data: BotData | null = rtBot ? {
    stats: rtBot.stats as BotData['stats'],
    decisions: rtBot.decisions as BotData['decisions'],
    performance: rtBot.performance as BotData['performance'],
    optimizer: { version: rtBot.stats.optimizerVersion || 0, weights: {}, lastOptimizedAt: rtBot.stats.lastOptimized || '', history: [] },
    config: { ...rtBot.config, aiStatus: 'OK' },
    equityCurve: rtBot.equityCurve,
    balance: rtBot.balance,
    strategies: [],
    gladiators: rtBot.gladiators || [],
    v2Entities: rtBot.v2Entities || null,
  } : null;

  const loading = !realtimeData;

  // Kick cron loop on mount + fetch external connection status
  useEffect(() => {
    fetch('/api/cron').catch(() => {});

    // Check external connections once
    const checkExternal = async () => {
      try {
        const [telRes, binRes] = await Promise.allSettled([
          fetch('/api/telegram').then(r => r.ok ? r.json() : null),
          fetch('/api/auto-trade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test-binance' }) }).then(r => r.ok ? r.json() : null),
        ]);
        if (telRes.status === 'fulfilled' && telRes.value) setTelegramOk(telRes.value.ok);
        if (binRes.status === 'fulfilled' && binRes.value?.connection) {
          setBinanceStatus(binRes.value.connection.ok ? `✅ ${binRes.value.connection.mode}` : `❌ ${binRes.value.connection.error}`);
        }
      } catch { /* silent */ }
    };
    checkExternal();

    // Kick cron every 2 min to keep trading loop alive
    const cronInterval = setInterval(() => {
      fetch('/api/cron').catch(() => {});
    }, 120_000);

    return () => clearInterval(cronInterval);
  }, []);

  // Auto-clear action status toast
  useEffect(() => {
    if (!actionStatus) return;
    const t = setTimeout(() => setActionStatus(''), 4000);
    return () => clearTimeout(t);
  }, [actionStatus]);

  const botAction = async (action: string, payload: Record<string, unknown> = {}) => {
    setEvalLoading(true);
    setActionStatus(`Running ${action}...`);
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.error);
      setActionStatus(`✅ ${action} completed`);
      await forceRefresh();
    } catch {
      setActionStatus(`❌ ${action} failed`);
    } finally {
      setEvalLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncLoading(true);
    setActionStatus('↻ Syncing...');
    try {
      await forceRefresh();
      setActionStatus('✅ Synced');
    } catch {
      setActionStatus('❌ Sync failed');
    } finally {
      setSyncLoading(false);
    }
  };

  const s = data?.stats;
  const healthColor = s?.strategyHealth === 'EXCELLENT' ? 'var(--accent-green)'
    : s?.strategyHealth === 'GOOD' ? 'var(--accent-cyan)'
    : s?.strategyHealth === 'CAUTION' ? 'var(--accent-amber)'
    : 'var(--accent-red)';

  const isKsEngaged = realtimeData?.dashboard?.killSwitch?.engaged || false;
  const pendingDecisions = realtimeData?.dashboard?.trading?.pendingDecisions || 0;
  const openPositions = realtimeData?.dashboard?.trading?.openPositions || 0;
  const totalSignals = realtimeData?.dashboard?.trading?.totalSignals || 0;
  
  type StepStatus = 'ok' | 'degraded' | 'down' | 'idle';

  const pipelineSteps = [
    { id: 'scan', label: 'Scan', icon: '🔍', status: (isKsEngaged ? 'down' : 'ok') as StepStatus, detail: 'OSINT Gatherers' },
    { id: 'aggregate', label: 'Aggregate', icon: '📡', status: (totalSignals > 0 ? 'ok' : 'idle') as StepStatus, detail: `${totalSignals} raw signals` },
    { id: 'rank', label: 'Rank', icon: '🏅', status: (pendingDecisions > 0 ? 'ok' : 'idle') as StepStatus, detail: 'Arena Engine' },
    { id: 'score', label: 'Score', icon: '🎯', status: (pendingDecisions > 0 ? 'ok' : 'idle') as StepStatus, detail: 'Syndicate Master' },
    { id: 'risk', label: 'Risk', icon: '⚖️', status: (isKsEngaged ? 'down' : 'ok') as StepStatus, detail: isKsEngaged ? 'HALTED' : 'Shields UP' },
    { id: 'execute', label: 'Execute', icon: '⚡', status: (openPositions > 0 ? 'ok' : 'idle') as StepStatus, detail: s?.mode || 'PAPER' },
  ];

  return (
    <div className="page-container" style={{ maxWidth: 1600 }}>
      {/* ---- Action Status Toast ---- */}
      {actionStatus && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: actionStatus.startsWith('✅') ? 'rgba(16,185,129,0.15)' : actionStatus.startsWith('❌') ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
          border: `1px solid ${actionStatus.startsWith('✅') ? '#10b981' : actionStatus.startsWith('❌') ? '#ef4444' : '#3b82f6'}`,
          color: '#fff', fontSize: 13, fontWeight: 600,
          backdropFilter: 'blur(12px)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: 'toastSlideIn 0.3s ease-out',
        }}>
          {actionStatus}
        </div>
      )}
      <style>{`@keyframes toastSlideIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }`}</style>
      {/* ---- Premium Navigation & Top Bar ---- */}
      <header className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', marginBottom: 24, borderRadius: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="logo" style={{ fontSize: 20, letterSpacing: '0.05em' }}>
            <span style={{ color: '#fff', textShadow: '0 0 10px rgba(255,255,255,0.3)' }}>TRADE</span>
            <span style={{ color: 'var(--accent-cyan)', textShadow: 'var(--neon-cyan)' }}> AI</span>
          </div>
          <div style={{ padding: '4px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 20, fontSize: 11, border: '1px solid var(--border)' }}>
            <span className={`status-dot ${s?.mode === 'PAPER' ? 'dot-amber' : s?.mode === 'LIVE' ? 'dot-green' : 'dot-red'}`} />
            <span style={{ fontWeight: 600, letterSpacing: '0.05em' }}>{s?.mode || 'OFFLINE'}</span>
          </div>
        </div>

        <nav className="nav-toggle">
          <Link href="/bot-center" className="nav-toggle-item active">
            <span className="nav-dot" /> <span className="nav-toggle-icon">🏆</span> <span className="nav-toggle-label" style={{marginLeft: 4}}>Arena</span>
          </Link>
          <Link href="/crypto-radar" className="nav-toggle-item">
            <span className="nav-dot" /> <span className="nav-toggle-icon">🛰️</span> <span className="nav-toggle-label" style={{marginLeft: 4}}>Radar</span>
          </Link>
        </nav>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <LiveIndicator
            status={connectionStatus}
            lastUpdate={lastUpdate}
            updateCount={updateCount}
            onReconnect={reconnect}
          />
          <InstallPwaButton />
          <button className="btn" onClick={() => botAction('evaluate')} disabled={evalLoading} style={{ border: 'none', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-green)', opacity: evalLoading ? 0.6 : 1, cursor: evalLoading ? 'wait' : 'pointer' }}>
            {evalLoading ? '⏳ ...' : '▶ Evaluate'}
          </button>
          <button className="btn" onClick={handleSync} disabled={syncLoading} style={{ background: 'transparent', borderColor: 'var(--border)', opacity: syncLoading ? 0.6 : 1, cursor: syncLoading ? 'wait' : 'pointer' }}>
            {syncLoading ? '⏳ ...' : '↻ Sync'}
          </button>
        </div>
      </header>

      {/* ---- KPI Metrics Bar ---- */}
      <KpiBar
        equity={data?.balance || data?.config?.paperBalance || 1000}
        pnl24h={data?.stats?.todayPnlPercent || 0}
        maxDrawdown={data?.stats?.maxDrawdown || 0}
        riskMode={data?.stats?.mode || 'OFFLINE'}
        lastSync={null}
        systemHealth={data?.stats?.strategyHealth || 'OFFLINE'}
      />

      {/* ---- Decision Pipeline Status ---- */}
      <div style={{ marginBottom: 16 }}>
        <PipelineStatus 
          steps={pipelineSteps} 
          signalCount={data?.stats?.todayDecisions || 0} 
          lastScan={new Date(realtimeData?.dashboard?.logs?.recent?.[0]?.ts || Date.now()).toLocaleTimeString()} 
        />
      </div>

      {loading ? (
        <div className="empty-state glass-card"><div className="empty-state-icon pulse">💠</div>Initializing Core Protocols...</div>
      ) : !data ? (
        <div className="empty-state glass-card"><div className="empty-state-icon">🔌</div>System Offline. API Unreachable.</div>
      ) : (
        <div className="bento-grid">
          {/* ================= PHOENIX V2 CORE ARCHITECTURE ================= */}
          <div className="bento-col-12 grid-3">
            
            {/* LEVEL 1: THE MASTERS */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent-red)' }}>👑 SINDICATUL MAEȘTRILOR</span>
                <span className="pulse" style={{ fontSize: 10, background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)', padding: '2px 8px', borderRadius: 10 }}>CONSENSUS: 70%</span>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.v2Entities?.masters?.map((m) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8, borderLeft: m.id.includes('gemini') ? '2px solid var(--accent-blue)' : m.id.includes('deepseek') ? '2px solid var(--accent-cyan)' : '2px solid var(--accent-purple)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                       <div style={{ width: 32, height: 32, borderRadius: '50%', background: m.id.includes('gemini') ? 'var(--accent-blue)' : m.id.includes('deepseek') ? 'var(--accent-cyan)' : 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                         {m.id.includes('gemini') ? '🔵' : m.id.includes('deepseek') ? '🐋' : '🦙'}
                       </div>
                       <div>
                         <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{m.name}</div>
                         <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Role: {m.role}</div>
                       </div>
                    </div>
                    <span className="badge badge-bullish">{m.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* LEVEL 2: MANAGER & PROMOTER */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* MANAGER VIZIONAR */}
              <div className="glass-card" style={{ flex: 1, padding: 0 }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent-cyan)' }}>👔 {data.v2Entities?.manager?.name.toUpperCase() || 'MANAGER VIZIONAR'}</span>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>Gatekeeper Status: <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{data.v2Entities?.manager?.status}</span></div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>{data.v2Entities?.manager?.description}</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Decisions Today</div>
                      <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s?.todayDecisions || 0}</div>
                    </div>
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Overall WR</div>
                      <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 700, color: (s?.overallWinRate || 0) > 50 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>{s?.overallWinRate || 0}%</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* PROMOTER */}
              <div className="glass-card" style={{ flex: 1, padding: 0, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: 'var(--accent-purple)' }} />
                <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: '#fff' }}>📢 SOCIAL PROMOTER</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Moltbook Interaction Engine</div>
                  </div>
                  <button className="btn" onClick={() => botAction('trigger-promoter')} disabled={evalLoading} style={{ background: 'var(--accent-purple)', borderColor: 'var(--accent-purple)', padding: '6px 12px', fontSize: 11 }}>
                    [ Trigger Broadcast ]
                  </button>
                </div>
              </div>
            </div>

            {/* LEVEL 3 & 4: SENTINELS & SCOUTS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              
              {/* SENTINEL PLANE */}
              <div className="glass-card" style={{ flex: 1, padding: 0 }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent-amber)' }}>🛡️ SENTINEL PLANE</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Risk Auth</span>
                </div>
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{data.v2Entities?.sentinels?.riskShield?.name || 'MDD Sentinel'}</div>
                    <div className={data.v2Entities?.sentinels?.riskShield?.triggered ? 'badge badge-bearish' : 'badge badge-bullish'}>
                      {data.v2Entities?.sentinels?.riskShield?.triggered ? 'CRITICAL' : 'OK'} ({data.v2Entities?.sentinels?.riskShield?.limit})
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{data.v2Entities?.sentinels?.lossDaily?.name || 'Loss Sentinel'}</div>
                    <div className={data.v2Entities?.sentinels?.lossDaily?.triggered ? 'badge badge-bearish' : 'badge badge-bullish'}>
                      {data.v2Entities?.sentinels?.lossDaily?.triggered ? 'BREACHED' : 'OK'} ({data.v2Entities?.sentinels?.lossDaily?.limit})
                    </div>
                  </div>
                  
                  {/* KILL SWITCH */}
                  <button 
                    onClick={() => botAction('killswitch', { engage: !(data.v2Entities?.sentinels?.killSwitch?.triggered) })} 
                    disabled={evalLoading}
                    style={{ 
                      marginTop: 6, width: '100%', padding: '12px', borderRadius: 8, 
                      background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--accent-red)',
                      color: 'var(--accent-red)', fontSize: 14, fontWeight: 800, letterSpacing: '0.1em', cursor: 'pointer',
                      transition: 'all 0.2s', opacity: evalLoading ? 0.6 : 1
                    }}>
                    ⚠️ {data.v2Entities?.sentinels?.killSwitch?.triggered ? 'DISENGAGE EXIT' : 'ENGAGE EMEREGENCY EXIT'} ⚠️
                  </button>
                </div>
              </div>

              {/* ALPHA SCOUTS */}
              <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', color: '#fff' }}>📡 {data.v2Entities?.scouts?.name.toUpperCase() || 'ALPHA SCOUTS'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Zero MNPI | Pure OSINT</div>
                </div>
                <div className="pulse" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-green)', boxShadow: '0 0 10px var(--accent-green)' }} />
              </div>
            </div>
            
          </div>
          
          <div className="bento-col-12 bento-grid">
             {/* ================= COLUMN 1 (Logs) ================= */}
             <div className="bento-col-8 glass-card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: 12 }}>RECENT DECISIONS (SINDICAT CONSENSUS)</div>
                {data.decisions.length > 0 ? (
                   <div className="table-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                     {data.decisions.slice(0, 7).map((d) => (
                       <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '80px 100px 100px 1fr 100px 80px', gap: 12, alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '8px 12px', borderRadius: 6, borderLeft: d.outcome === 'WIN' ? '2px solid var(--accent-green)' : d.outcome === 'LOSS' ? '2px solid var(--accent-red)' : '2px solid var(--border)' }}>
                         <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(d.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                         <span style={{ fontSize: 13, fontWeight: 700 }}>{d.symbol}</span>
                         <span className={`badge ${d.signal.includes('BUY') ? 'badge-signal-buy' : d.signal.includes('SELL') ? 'badge-signal-sell' : 'badge-info'}`} style={{ fontSize: 9 }}>
                           {d.signal} {d.direction === 'BULLISH' ? '▲' : '▼'}
                         </span>
                         <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>${d.price?.toLocaleString()}</span>
                         <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: d.pnlPercent !== null ? (d.pnlPercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--accent-amber)' }}>
                           {d.pnlPercent !== null ? `${d.pnlPercent >= 0 ? '+' : ''}${d.pnlPercent}%` : 'PENDING'}
                         </span>
                         {/* Fake Confidence or Real if exists */}
                         <span style={{ fontSize: 10, textAlign: 'right', color: 'var(--text-muted)'}}>{d.confidence}% conf</span>
                       </div>
                     ))}
                   </div>
                ) : (
                   <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No recent consensus</div>
                )}
             </div>

             {/* ================= COLUMN 2 (Connections) ================= */}
             <div className="bento-col-4" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
               <div className="glass-card" style={{ padding: '16px 20px', flex: 1 }}>
                 <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: 16 }}>EXTERNAL LINKS (GATEKEEPER)</div>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                     <span style={{ fontSize: 12, fontWeight: 600 }}>🟡 Binance Exec</span>
                     <span style={{ fontSize: 12, color: binanceStatus.startsWith('✅') ? 'var(--accent-green)' : 'var(--accent-red)' }}>{binanceStatus}</span>
                   </div>
                   <div style={{ display: 'flex', justifyContent: 'space-between', padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                     <span style={{ fontSize: 12, fontWeight: 600 }}>✈️ Telegram Log</span>
                     <span style={{ fontSize: 12, color: telegramOk ? 'var(--accent-green)' : 'var(--accent-amber)' }}>{telegramOk ? '✅ ONLINE' : '🟡 STANDBY'}</span>
                   </div>
                   <div style={{ display: 'flex', justifyContent: 'space-between', padding: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                     <span style={{ fontSize: 12, fontWeight: 600 }}>🤖 Backtest System</span>
                     <span style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>READY</span>
                   </div>
                 </div>
               </div>
             </div>
          </div>
          
          {/* ================= ROW 3: SYSTEM HEALTH + EQUITY ================= */}
          <div className="bento-col-12" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginTop: 16 }}>

            {/* SYSTEM HEALTH PANEL */}
            <div className="glass-card" style={{ padding: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: healthColor }}>
                  ❤️ SYSTEM HEALTH: {s?.strategyHealth || 'OFFLINE'}
                </span>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total PnL</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: (s?.totalPnlPercent || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {(s?.totalPnlPercent || 0) >= 0 ? '+' : ''}{(s?.totalPnlPercent || 0).toFixed(2)}%
                    </div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Today PnL</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: (s?.todayPnlPercent || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {(s?.todayPnlPercent || 0) >= 0 ? '+' : ''}{(s?.todayPnlPercent || 0).toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Max Drawdown</div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: (s?.maxDrawdown || 0) > 10 ? 'var(--accent-red)' : 'var(--accent-amber)' }}>
                      {(s?.maxDrawdown || 0).toFixed(2)}%
                    </div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Streak</div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s?.streakType === 'WIN' ? 'var(--accent-green)' : s?.streakType === 'LOSS' ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                      {s?.currentStreak || 0} {s?.streakType || '-'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Balance (Real)</div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      ${(data.balance || data.config?.paperBalance || 1000).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Trades</div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {s?.totalDecisions || 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* EQUITY CURVE */}
            <div className="glass-card" style={{ padding: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-primary)' }}>📈 EQUITY CURVE</span>
              </div>
              <div style={{ padding: '12px 20px' }}>
                <EquityCurve data={data.equityCurve || []} initialBalance={data.config?.paperBalance || 1000} />
              </div>
            </div>
          </div>

          {/* ================= ROW 4: TRADINGVIEW CHART ================= */}
          <div className="bento-col-12" style={{ marginTop: 16 }}>
            <TradingViewPanel />
          </div>

          {/* ================= ROW 5: REASONING PANEL ================= */}
          <div className="bento-col-12" style={{ marginTop: 16 }}>
             <TradeReasoningPanel />
          </div>

        </div>
      )}
    </div>
  );

}

// ============================================================
// Trade Reasoning Panel — Full transparency for every decision
// ============================================================
interface TradeReasoningData {
  id: string;
  timestamp: string;
  symbol: string;
  signal: string;
  price: number;
  confidence: number;
  strategy: string;
  entryReason: string;
  marketContext: { emaAlignment: string; priceVsDailyOpen: string; trendDirection: string; volatility: string };
  confirmations: { mlScore: number; mlVerdict: string; mlReasons: string[]; confluenceConfirmed: number; confluenceTotal: number; sourceReliability: string };
  riskLogic: { positionSize: number; positionSizePercent: number; kellyFraction: number; dailyLossUsed: number; dailyLossLimit: number; maxDrawdown: number; drawdownCurrent: number; correlationCheck: string };
  slTpLogic: { stopLoss: number; stopLossPercent: number; takeProfit: number; takeProfitPercent: number; riskRewardRatio: number; method: string };
  reasoningSteps: string[];
  decision: 'EXECUTE' | 'SKIP' | 'PENDING';
  decisionReason: string;
  outcome?: string;
  pnlPercent?: number;
}

function TradeReasoningPanel() {
  const [trades, setTrades] = useState<TradeReasoningData[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/trade-reasoning?limit=15')
      .then(r => r.json())
      .then(d => setTrades(d.trades || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const decColor = (d: string) => d === 'EXECUTE' ? '#10b981' : d === 'SKIP' ? '#ef4444' : '#f59e0b';
  const mlColor = (s: number) => s >= 75 ? '#10b981' : s >= 55 ? '#f59e0b' : '#ef4444';

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span className="card-title">🧠 Trade Reasoning — Full Transparency</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {trades.length} decisions analyzed
        </span>
      </div>
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading reasoning data…</div>
      ) : trades.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No trade decisions yet</div>
      ) : (
        <div style={{ maxHeight: 600, overflowY: 'auto' }}>
          {trades.map(t => (
            <div key={t.id} style={{
              borderBottom: '1px solid var(--border)',
              padding: '12px 16px',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
              onClick={() => setExpanded(expanded === t.id ? null : t.id)}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Summary row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    background: decColor(t.decision), color: '#000', fontSize: 10,
                    fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                  }}>{t.decision}</span>
                  <span style={{ fontWeight: 600 }}>{t.symbol}</span>
                  <span style={{ color: t.signal.includes('BUY') || t.signal.includes('LONG') ? '#10b981' : '#ef4444', fontSize: 13 }}>
                    {t.signal}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>${t.price.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: mlColor(t.confirmations.mlScore) }}>
                    ML: {t.confirmations.mlScore}%
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t.strategy}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {expanded === t.id ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {/* Expanded reasoning */}
              {expanded === t.id && (
                <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.7 }}>
                  {/* Step-by-step reasoning */}
                  <div style={{
                    background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 12, marginBottom: 12,
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13, color: 'var(--accent)' }}>
                      Step-by-Step Reasoning
                    </div>
                    {t.reasoningSteps.map((step, i) => (
                      <div key={i} style={{ padding: '3px 0', color: 'var(--text-primary)' }}>{step}</div>
                    ))}
                  </div>

                  {/* 4-column detail grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    {/* Market Context */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 10 }}>
                      <div style={{ fontWeight: 600, color: '#818cf8', marginBottom: 4 }}>🌍 Market Context</div>
                      <div>EMA: {t.marketContext.emaAlignment}</div>
                      <div>Daily Open: {t.marketContext.priceVsDailyOpen}</div>
                      <div>Trend: {t.marketContext.trendDirection}</div>
                      <div>Volatility: {t.marketContext.volatility}</div>
                    </div>

                    {/* Confirmations */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 10 }}>
                      <div style={{ fontWeight: 600, color: '#34d399', marginBottom: 4 }}>✅ Confirmations</div>
                      <div>ML Score: <span style={{ color: mlColor(t.confirmations.mlScore), fontWeight: 700 }}>
                        {t.confirmations.mlScore}% ({t.confirmations.mlVerdict})
                      </span></div>
                      <div>Confluence: {t.confirmations.confluenceConfirmed}/{t.confirmations.confluenceTotal} TFs</div>
                      <div>Source: {t.confirmations.sourceReliability}</div>
                      {t.confirmations.mlReasons.map((r, i) => (
                        <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)' }}>• {r}</div>
                      ))}
                    </div>

                    {/* Risk Logic */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 10 }}>
                      <div style={{ fontWeight: 600, color: '#f59e0b', marginBottom: 4 }}>⚖️ Risk Logic</div>
                      <div>Position: ${t.riskLogic.positionSize} ({t.riskLogic.positionSizePercent}%)</div>
                      <div>Kelly: {(t.riskLogic.kellyFraction * 100).toFixed(1)}%</div>
                      <div>Daily Loss: {t.riskLogic.dailyLossUsed.toFixed(1)}% / {t.riskLogic.dailyLossLimit}%</div>
                      <div>Drawdown: {t.riskLogic.drawdownCurrent.toFixed(1)}% / {t.riskLogic.maxDrawdown}%</div>
                      <div>Correlation: {t.riskLogic.correlationCheck}</div>
                    </div>

                    {/* SL/TP */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 10 }}>
                      <div style={{ fontWeight: 600, color: '#ef4444', marginBottom: 4 }}>🎯 SL/TP Logic</div>
                      <div>Stop Loss: <span style={{ color: '#ef4444' }}>${t.slTpLogic.stopLoss.toLocaleString()} (-{t.slTpLogic.stopLossPercent}%)</span></div>
                      <div>Take Profit: <span style={{ color: '#10b981' }}>${t.slTpLogic.takeProfit.toLocaleString()} (+{t.slTpLogic.takeProfitPercent}%)</span></div>
                      <div>Risk/Reward: {t.slTpLogic.riskRewardRatio}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Method: {t.slTpLogic.method}</div>
                    </div>
                  </div>

                  {/* Outcome */}
                  {t.outcome && (
                    <div style={{ marginTop: 8, padding: '6px 12px', borderRadius: 6, background: t.outcome === 'WIN' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)' }}>
                      Outcome: <strong style={{ color: t.outcome === 'WIN' ? '#10b981' : '#ef4444' }}>
                        {t.outcome} {t.pnlPercent != null ? `(${t.pnlPercent > 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%)` : ''}
                      </strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
