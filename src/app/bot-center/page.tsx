'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { TradingViewPanel } from '@/components/TradingViewChart';
import KpiBar from '@/components/KpiBar';
import PipelineStatus from '@/components/PipelineStatus';
import InstallPwaButton from '@/components/InstallPwaButton';

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
  strategies: Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    targetAssets: string[];
    risk: { stopLossPercent: number; takeProfitPercent: number; trailingStopEnabled: boolean };
  }>;
}

export default function BotCenterPage() {
  const [data, setData] = useState<BotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionStatus, setActionStatus] = useState<string>('');
  const [backtest, setBacktest] = useState<Record<string, unknown> | null>(null);
  const [exchange, setExchange] = useState<Record<string, unknown> | null>(null);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [autoTrade, setAutoTrade] = useState<Record<string, unknown> | null>(null);
  const [binanceStatus, setBinanceStatus] = useState<string>('—');
  const [portfolio, setPortfolio] = useState<Record<string, unknown> | null>(null);
  const [signals, setSignals] = useState<Record<string, unknown> | null>(null);
  const [telegramOk, setTelegramOk] = useState<boolean | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/bot');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.warn('Bot fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDashboardData = useCallback(async () => {
    try {
      const [exRes, anRes, atRes, portRes, sigRes, telRes, binRes] = await Promise.allSettled([
        fetch('/api/exchanges').then(r => r.ok ? r.json() : null),
        fetch('/api/analytics').then(r => r.ok ? r.json() : null),
        fetch('/api/auto-trade').then(r => r.ok ? r.json() : null),
        fetch('/api/portfolio').then(r => r.ok ? r.json() : null),
        fetch('/api/signals').then(r => r.ok ? r.json() : null),
        fetch('/api/telegram').then(r => r.ok ? r.json() : null),
        fetch('/api/auto-trade', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'test-binance'}) }).then(r => r.ok ? r.json() : null)
      ]);

      if (exRes.status === 'fulfilled' && exRes.value) setExchange(exRes.value);
      if (anRes.status === 'fulfilled' && anRes.value) setAnalytics(anRes.value);
      if (atRes.status === 'fulfilled' && atRes.value) setAutoTrade(atRes.value);
      if (portRes.status === 'fulfilled' && portRes.value) setPortfolio(portRes.value);
      if (sigRes.status === 'fulfilled' && sigRes.value) setSignals(sigRes.value);
      if (telRes.status === 'fulfilled' && telRes.value) setTelegramOk(telRes.value.ok);
      if (binRes.status === 'fulfilled' && binRes.value?.connection) {
        setBinanceStatus(binRes.value.connection.ok ? `✅ ${binRes.value.connection.mode}` : `❌ ${binRes.value.connection.error}`);
      }
    } catch (e) {
      console.warn('Dashboard fetch error:', e);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchDashboardData();
    const interval = setInterval(() => {
      fetchData();
      fetchDashboardData();
    }, 30_000);

    // Notification SSE (Push)
    let evtSource: EventSource | null = null;
    if (notifEnabled) {
      evtSource = new EventSource('/api/notifications');
      evtSource.addEventListener('signal', (e) => {
        try {
          const json = JSON.parse(e.data);
          for (const alert of json.alerts || []) {
            new Notification(`🚨 ${alert.symbol} ${alert.signal}`, {
              body: `${alert.direction} | Confidence: ${alert.confidence}% | Price: $${alert.price}`,
              icon: '/favicon.ico',
            });
          }
        } catch { /* parse err */ }
      });
    }

    return () => { 
      clearInterval(interval); 
      if (evtSource) evtSource.close();
    };
  }, [fetchData, fetchDashboardData, notifEnabled]);

  const botAction = async (action: string) => {
    setActionStatus(`Running ${action}...`);
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      setActionStatus(`✅ ${action}: ${JSON.stringify(json).slice(0, 80)}`);
      await fetchData();
    } catch {
      setActionStatus(`❌ ${action} failed`);
    }
  };

  const s = data?.stats;
  const healthColor = s?.strategyHealth === 'EXCELLENT' ? 'var(--accent-green)'
    : s?.strategyHealth === 'GOOD' ? 'var(--accent-cyan)'
    : s?.strategyHealth === 'CAUTION' ? 'var(--accent-amber)'
    : 'var(--accent-red)';

  return (
    <div className="page-container" style={{ maxWidth: 1600 }}>
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
          <InstallPwaButton />
          <button className="btn" onClick={() => botAction('evaluate')} style={{ border: 'none', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-green)' }}>
            ▶ Evaluate
          </button>
          <button className="btn" onClick={() => { fetchData(); fetchDashboardData(); }} style={{ background: 'transparent', borderColor: 'var(--border)' }}>
            ↻ Sync
          </button>
        </div>
      </header>

      {/* ---- KPI Metrics Bar ---- */}
      <KpiBar
        equity={data?.config?.paperBalance || 1000}
        pnl24h={data?.stats?.todayPnlPercent || 0}
        maxDrawdown={data?.stats?.maxDrawdown || 0}
        riskMode={data?.stats?.mode || 'OFFLINE'}
        lastSync={null}
        systemHealth={data?.stats?.strategyHealth || 'OFFLINE'}
      />

      {/* ---- Decision Pipeline Status ---- */}
      <div style={{ marginBottom: 16 }}>
        <PipelineStatus signalCount={data?.stats?.todayDecisions || 0} />
      </div>

      {loading ? (
        <div className="empty-state glass-card"><div className="empty-state-icon pulse">💠</div>Initializing Core Protocols...</div>
      ) : !data ? (
        <div className="empty-state glass-card"><div className="empty-state-icon">🔌</div>System Offline. API Unreachable.</div>
      ) : (
        <div className="bento-grid">
          
          {/* ================= COLUMN 1 ================= */}
          <div className="bento-col-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* System Health */}
            <div className="glass-card" style={{ borderTop: `3px solid ${healthColor}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>System Health</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: healthColor, textShadow: `0 0 10px ${healthColor}` }}>
                    {s?.strategyHealth}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Current Streak</div>
                  <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)' }}>
                    {s?.currentStreak || 0} {s?.streakType === 'WIN' ? '��' : s?.streakType === 'LOSS' ? '💀' : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* STRATEGY ARENA LEADERBOARD */}
            <div className="glass-card" style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--accent-cyan)' }}>⚔️ STRATEGY ARENA</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 10 }}>LIVE</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.performance.length > 0 ? (
                  data.performance
                    .sort((a, b) => b.winRate - a.winRate)
                    .map((p, i) => (
                      <div key={i} style={{ 
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                        background: i === 0 ? 'rgba(6, 182, 212, 0.1)' : 'rgba(0,0,0,0.2)', 
                        border: i === 0 ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid var(--border)',
                        padding: '12px', borderRadius: 12, position: 'relative', overflow: 'hidden'
                      }}>
                        {i === 0 && <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: 'var(--accent-cyan)', boxShadow: 'var(--neon-cyan)' }} />}
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 18, opacity: i === 0 ? 1 : 0.5 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}</span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: i === 0 ? '#fff' : 'var(--text-primary)' }}>{p.signalType}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.totalTrades} battles</div>
                          </div>
                        </div>
                        
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: p.winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {p.winRate}% WR
                          </div>
                          <div style={{ fontSize: 10, color: p.avgPnlPercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {p.avgPnlPercent >= 0 ? '+' : ''}{p.avgPnlPercent}% PnL
                          </div>
                        </div>
                      </div>
                  ))
                ) : data.strategies && data.strategies.length > 0 ? (
                  data.strategies.map((strat, i) => (
                    <div key={strat.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: i === 0 ? 'rgba(6, 182, 212, 0.08)' : 'rgba(0,0,0,0.2)',
                      border: i === 0 ? '1px solid rgba(6, 182, 212, 0.25)' : '1px solid var(--border)',
                      padding: '12px', borderRadius: 12, position: 'relative', overflow: 'hidden'
                    }}>
                      {i === 0 && <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: 'var(--accent-cyan)', boxShadow: 'var(--neon-cyan)' }} />}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 16 }}>{['⚡','🔄','📊','📈','🎯','🔀','💰','🧱','🚀'][i] || '🔹'}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{strat.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{strat.targetAssets.join(', ')} · {strat.description.slice(0, 35)}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                          background: strat.status === 'active' ? 'rgba(16,185,129,0.15)' : strat.status === 'probation' ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.15)',
                          color: strat.status === 'active' ? 'var(--accent-green)' : strat.status === 'probation' ? 'var(--accent-amber)' : 'var(--text-muted)',
                          textTransform: 'uppercase'
                        }}>{strat.status}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                          SL {strat.risk.stopLossPercent}% · TP {strat.risk.takeProfitPercent}%
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state pulse" style={{ padding: '20px 0' }}>Arena is waiting...</div>
                )}
              </div>
            </div>

            {/* Global Metrics Mini Bento */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="glass-card" style={{ padding: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Total PnL</div>
                <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 700, color: (s?.totalPnlPercent || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {(s?.totalPnlPercent || 0) >= 0 ? '+' : ''}{s?.totalPnlPercent || 0}%
                </div>
              </div>
              <div className="glass-card" style={{ padding: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Drawdown</div>
                <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-red)' }}>
                  -{s?.maxDrawdown || 0}%
                </div>
              </div>
            </div>
            
          </div>

          {/* ================= COLUMN 2 ================= */}
          <div className="bento-col-8" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* TradingView Chart */}
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>OPTICAL RADAR VISION</span>
                <span className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-red)', boxShadow: '0 0 8px var(--accent-red)' }}></span>
              </div>
              <TradingViewPanel />
            </div>

            {/* Equity Curve */}
            <div className="glass-card" style={{ padding: 0 }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)', letterSpacing: '0.05em' }}>EQUITY TRAJECTORY</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(59, 130, 246, 0.1)', padding: '2px 8px', borderRadius: 4, color: 'var(--accent-blue)' }}>
                  BAL: ${data.config.paperBalance?.toLocaleString() || '1,000'}
                </span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <EquityChart data={data.equityCurve || []} startBalance={data.config.paperBalance || 1000} />
              </div>
            </div>

          </div>

          {/* ================= COLUMN 3 (Connections & Logs) ================= */}
          <div className="bento-col-4" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="glass-card" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: 16 }}>EXTERNAL LINKS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                  <span style={{ fontSize: 12 }}>🟡 Binance</span>
                  <span style={{ fontSize: 12, color: binanceStatus.startsWith('✅') ? 'var(--accent-green)' : 'var(--accent-red)' }}>{binanceStatus}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                  <span style={{ fontSize: 12 }}>✈️ Telegram</span>
                  <span style={{ fontSize: 12, color: telegramOk ? 'var(--accent-green)' : 'var(--accent-amber)' }}>{telegramOk ? '✅ ONLINE' : '🟡 STANDBY'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                  <span style={{ fontSize: 12 }}>🤖 Backtest</span>
                  <span style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>READY</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bento-col-8 glass-card" style={{ padding: '16px 20px' }}>
             <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: 12 }}>RECENT EXECUTIONS</div>
             {data.decisions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.decisions.slice(0, 5).map((d) => (
                    <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '80px 100px 100px 1fr 100px', gap: 12, alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '8px 12px', borderRadius: 6, borderLeft: d.outcome === 'WIN' ? '2px solid var(--accent-green)' : d.outcome === 'LOSS' ? '2px solid var(--accent-red)' : '2px solid var(--border)' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{new Date(d.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{d.symbol}</span>
                      <span className={`badge ${d.signal.includes('BUY') ? 'badge-signal-buy' : d.signal.includes('SELL') ? 'badge-signal-sell' : 'badge-info'}`} style={{ fontSize: 9 }}>
                        {d.signal} {d.direction === 'BULLISH' ? '▲' : '▼'}
                      </span>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>${d.price?.toLocaleString()}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: d.pnlPercent !== null ? (d.pnlPercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--accent-amber)' }}>
                        {d.pnlPercent !== null ? `${d.pnlPercent >= 0 ? '+' : ''}${d.pnlPercent}%` : 'PENDING'}
                      </span>
                    </div>
                  ))}
                </div>
             ) : (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No recent trades</div>
             )}
          </div>

          {/* ================= COLUMN FULL (Reasoning Panel) ================= */}
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

// ============================================================
// Equity Curve Chart Component — Pure SVG, no libraries
// ============================================================
interface EquityChartProps {
  data: BotData['equityCurve'];
  startBalance: number;
}

function EquityChart({ data, startBalance }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (data.length === 0) {
    return (
      <div style={{
        height: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 8,
        color: 'var(--text-muted)',
      }}>
        <span style={{ fontSize: 32 }}>📉</span>
        <span style={{ fontSize: 12 }}>Waiting for evaluated trades to build the equity curve...</span>
        <span style={{ fontSize: 10 }}>Decisions will be auto-evaluated after 1 hour</span>
      </div>
    );
  }

  const W = 800;
  const H = 200;
  const PAD = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Start with 0 PnL point
  const points = [{ pnl: 0, balance: startBalance, outcome: 'START', timestamp: '', signal: '', symbol: '' }, ...data];
  const pnls = points.map((p) => p.pnl);
  const minPnl = Math.min(0, ...pnls);
  const maxPnl = Math.max(0.1, ...pnls); // avoid zero range
  const range = maxPnl - minPnl || 1;

  const xStep = chartW / Math.max(points.length - 1, 1);
  const yScale = (pnl: number) => PAD.top + chartH - ((pnl - minPnl) / range) * chartH;
  const zeroY = yScale(0);

  // Build path
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${PAD.left + i * xStep},${yScale(p.pnl)}`)
    .join(' ');

  // Area fill path (closes down to zero line)
  const areaPath = linePath +
    ` L${PAD.left + (points.length - 1) * xStep},${zeroY}` +
    ` L${PAD.left},${zeroY} Z`;

  const lastPnl = points[points.length - 1]?.pnl || 0;
  const isPositive = lastPnl >= 0;

  // Grid lines
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const pnl = minPnl + (range / gridCount) * i;
    return { y: yScale(pnl), label: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%` };
  });

  return (
    <div ref={containerRef} style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', minWidth: 500, height: 'auto' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
            <stop offset="100%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y}
              stroke="var(--border)" strokeWidth="0.5" strokeDasharray="4,4" />
            <text x={PAD.left - 6} y={g.y + 4} textAnchor="end"
              style={{ fontSize: 9, fill: 'var(--text-muted)' }}>{g.label}</text>
          </g>
        ))}

        {/* Zero line */}
        <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY}
          stroke="var(--text-muted)" strokeWidth="1" strokeOpacity="0.4" />

        {/* Area fill */}
        <path d={areaPath} fill="url(#eqGrad)" />

        {/* Line */}
        <path d={linePath} fill="none"
          stroke={isPositive ? '#10b981' : '#ef4444'} strokeWidth="2" strokeLinecap="round" />

        {/* Data points (skip first which is synthetic 0) */}
        {points.slice(1).map((p, i) => {
          const cx = PAD.left + (i + 1) * xStep;
          const cy = yScale(p.pnl);
          const color = p.outcome === 'WIN' ? '#10b981' : p.outcome === 'LOSS' ? '#ef4444' : '#64748b';
          return (
            <circle key={i} cx={cx} cy={cy} r={4}
              fill={color} stroke="var(--bg-primary)" strokeWidth="1.5" opacity="0.9" />
          );
        })}

        {/* Current balance label */}
        <text x={PAD.left + (points.length - 1) * xStep} y={yScale(lastPnl) - 10}
          textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: isPositive ? '#10b981' : '#ef4444' }}>
          {lastPnl >= 0 ? '+' : ''}{lastPnl.toFixed(2)}%
        </text>

        {/* X-axis labels (first and last) */}
        {data.length > 0 && (
          <>
            <text x={PAD.left + xStep} y={H - 6} textAnchor="start"
              style={{ fontSize: 8, fill: 'var(--text-muted)' }}>
              {new Date(data[0].timestamp).toLocaleDateString()}
            </text>
            <text x={PAD.left + points.length * xStep - xStep} y={H - 6} textAnchor="end"
              style={{ fontSize: 8, fill: 'var(--text-muted)' }}>
              {new Date(data[data.length - 1].timestamp).toLocaleDateString()}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
