'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { TradingViewPanel } from '@/components/TradingViewChart';

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
    <div className="page-container">
      {/* ---- Header ---- */}
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="logo">🤖 Bot Center <span>v{data?.optimizer?.version || 0}</span></div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <span className={`status-dot ${s?.mode === 'PAPER' ? 'dot-amber' : s?.mode === 'LIVE' ? 'dot-green' : 'dot-red'}`} />
            Mode: {s?.mode || 'LOADING'}
          </span>
        </div>
        <div className="top-bar-right">
          <nav className="nav-toggle">
            <Link href="/bot-center" className="nav-toggle-item active">
              <span className="nav-dot" />
              <span className="nav-toggle-icon">🤖</span>
              <span className="nav-toggle-label">Bot</span>
            </Link>
            <Link href="/crypto-radar" className="nav-toggle-item">
              <span className="nav-dot" />
              <span className="nav-toggle-icon">📡</span>
              <span className="nav-toggle-label">Radar</span>
            </Link>
          </nav>
          <button className="btn" onClick={() => { fetchData(); fetchDashboardData(); }}>↻</button>
        </div>
      </header>

      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">⏳</div>Loading Bot Data...</div>
      ) : !data ? (
        <div className="empty-state"><div className="empty-state-icon">🔌</div>Could not connect to Bot API</div>
      ) : (
        <>
          {/* ---- AI Discovery Status Banner ---- */}
          {data?.config?.aiStatus === 'NO_CREDIT' && (
            <div className="card" style={{ marginBottom: 16, background: 'rgba(255, 50, 50, 0.1)', border: '1px solid var(--accent-red)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 28 }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--accent-red)', fontSize: 16 }}>AI Discovery Offline: OpenAI API Credit Depleted</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                      The AI cannot invent new strategies because your OpenAI account quota is Zero. Existing strategies will continue to backtest and trade normally.
                    </div>
                  </div>
                </div>
                <a href="https://platform.openai.com/account/billing" target="_blank" rel="noreferrer" style={{ background: 'var(--accent-red)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 13, textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Top Up API Credit 💳
                </a>
              </div>
            </div>
          )}

          {/* ---- Strategy Health Banner ---- */}
          <div className="card" style={{ marginBottom: 16, borderLeft: `3px solid ${healthColor}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: healthColor }}>
                  {s?.strategyHealth === 'EXCELLENT' ? '🟢' : s?.strategyHealth === 'GOOD' ? '🔵' : s?.strategyHealth === 'CAUTION' ? '🟡' : '🔴'}
                  {' '}Strategy Health: {s?.strategyHealth}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 12 }}>
                  Streak: {s?.currentStreak || 0} {s?.streakType === 'WIN' ? '🔥' : s?.streakType === 'LOSS' ? '💀' : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => botAction('evaluate')}>▶ Evaluate</button>
                <button className="btn" onClick={() => botAction('optimize')}>⚡ Optimize</button>
                <button className="btn" onClick={() => botAction('recalculate')}>📊 Recalc</button>
                <button className="btn" onClick={async () => {
                  setActionStatus('Running backtest...');
                  try {
                    const res = await fetch('/api/backtest');
                    const json = await res.json();
                    setBacktest(json);
                    setActionStatus(`✅ Backtest: ${json.stats?.totalTrades || 0} trades, WR ${json.stats?.winRate || 0}%`);
                  } catch { setActionStatus('❌ Backtest failed'); }
                }}>🔬 Backtest</button>
                <button className="btn" onClick={() => {
                  if ('Notification' in window) {
                    Notification.requestPermission().then(p => {
                      setNotifEnabled(p === 'granted');
                      setActionStatus(p === 'granted' ? '✅ Notifications enabled' : '❌ Notifications denied');
                    });
                  }
                }}>🔔 {notifEnabled ? 'ON' : 'Notify'}</button>
              </div>
            </div>
            {actionStatus && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{actionStatus}</div>
            )}
          </div>

          {/* ---- Core Stats ---- */}
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <span className="stat-label">Win Rate (All)</span>
              <span className="stat-value" style={{ color: (s?.overallWinRate || 0) >= 50 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {s?.overallWinRate || 0}%
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Win Rate (Today)</span>
              <span className="stat-value" style={{ color: (s?.todayWinRate || 0) >= 50 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                {s?.todayWinRate || 0}%
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total PnL</span>
              <span className={`stat-value ${(s?.totalPnlPercent || 0) >= 0 ? 'text-green' : 'text-red'}`}>
                {(s?.totalPnlPercent || 0) >= 0 ? '+' : ''}{s?.totalPnlPercent || 0}%
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Max Drawdown</span>
              <span className="stat-value text-red">-{s?.maxDrawdown || 0}%</span>
            </div>
          </div>

          <div className="grid-4" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <span className="stat-label">Total Decisions</span>
              <span className="stat-value">{s?.totalDecisions || 0}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Today</span>
              <span className="stat-value">{s?.todayDecisions || 0}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Optimizer v{data.optimizer.version}</span>
              <span className="stat-sub">
                {data.optimizer.lastOptimizedAt
                  ? new Date(data.optimizer.lastOptimizedAt).toLocaleString()
                  : 'Never'}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Paper Balance</span>
              <span className="stat-value" style={{ fontSize: 18 }}>
                ${data.config.paperBalance?.toLocaleString() || '1,000'}
              </span>
            </div>
          </div>

          {/* ---- TradingView Live Chart ---- */}
          <TradingViewPanel />

          {/* ---- Equity Curve Chart ---- */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">📈 Equity Curve</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Paper Balance: ${data.config.paperBalance?.toLocaleString()}
              </span>
            </div>
            <EquityChart data={data.equityCurve || []} startBalance={data.config.paperBalance || 1000} />
          </div>

          {/* ---- TRADE REASONING PANEL ---- */}
          <TradeReasoningPanel />

          {/* ---- Performance by Signal Type ---- */}
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-header">
                <span className="card-title">📊 Performance by Signal</span>
              </div>
              <div className="table-wrap">
                {data.performance.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Signal</th>
                        <th>Trades</th>
                        <th>W</th>
                        <th>L</th>
                        <th>Win%</th>
                        <th>Avg PnL</th>
                        <th>Best</th>
                        <th>Worst</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.performance.map((p, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{p.signalType}</td>
                          <td>{p.totalTrades}</td>
                          <td className="text-green">{p.wins}</td>
                          <td className="text-red">{p.losses}</td>
                          <td style={{ color: p.winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {p.winRate}%
                          </td>
                          <td className={p.avgPnlPercent >= 0 ? 'text-green' : 'text-red'}>
                            {p.avgPnlPercent >= 0 ? '+' : ''}{p.avgPnlPercent}%
                          </td>
                          <td className="text-green">+{p.bestTrade}%</td>
                          <td className="text-red">{p.worstTrade}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon">📈</div>
                    No evaluated trades yet. Run ▶ Evaluate when decisions age past 1h.
                  </div>
                )}
              </div>
            </div>

            {/* ---- Optimizer Weights ---- */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">⚙️ Optimizer Weights</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>v{data.optimizer.version}</span>
              </div>
              <div style={{ padding: '8px 0' }}>
                {Object.entries(data.optimizer.weights).map(([key, val]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                    <span style={{ width: 120, fontSize: 11, color: 'var(--text-secondary)' }}>
                      {key.replace('Weight', '')}
                    </span>
                    <div style={{
                      flex: 1,
                      height: 6,
                      background: 'var(--bg-tertiary)',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${(val as number) * 100}%`,
                        height: '100%',
                        background: 'var(--accent-cyan)',
                        borderRadius: 3,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <span style={{ width: 40, fontSize: 11, textAlign: 'right', color: 'var(--text-primary)' }}>
                      {Math.round((val as number) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
              {data.optimizer.history.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Recent Changes:</span>
                  {data.optimizer.history.slice(-3).map((h, i) => (
                    <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {new Date(h.date).toLocaleDateString()}: {Object.entries(h.weightChanges).map(([k, v]) =>
                        `${k.replace('Weight', '')} ${Math.round(v.from * 100)}→${Math.round(v.to * 100)}%`
                      ).join(', ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ---- Backtest Results ---- */}
          {backtest && (backtest as { stats?: Record<string, number> }).stats && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">🔬 Backtest Results</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {(backtest as { stats?: { totalTrades: number } }).stats?.totalTrades || 0} trades simulated
                </span>
              </div>
              {(() => {
                const st = (backtest as { stats: Record<string, number> }).stats;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                    <div className="stat-card">
                      <span className="stat-label">Win Rate</span>
                      <span className="stat-value" style={{ color: st.winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {st.winRate}%
                      </span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Total PnL</span>
                      <span className={`stat-value ${st.totalPnlPercent >= 0 ? 'text-green' : 'text-red'}`}>
                        {st.totalPnlPercent >= 0 ? '+' : ''}{st.totalPnlPercent}%
                      </span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Final Balance</span>
                      <span className="stat-value" style={{ fontSize: 16 }}>
                        ${st.finalBalance?.toLocaleString()}
                      </span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Max Drawdown</span>
                      <span className="stat-value text-red">-{st.maxDrawdownPercent}%</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Profit Factor</span>
                      <span className="stat-value">{st.profitFactor}</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Sharpe</span>
                      <span className="stat-value">{st.sharpeApprox}</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Avg Win</span>
                      <span className="stat-value text-green">+{st.avgWin}%</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Avg Loss</span>
                      <span className="stat-value text-red">-{st.avgLoss}%</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ---- Exchange Panel ---- */}
          {exchange && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">💱 Exchange</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {(exchange as { exchange?: { exchange: string } }).exchange?.exchange || 'simulation'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                <div className="stat-card">
                  <span className="stat-label">Available</span>
                  <span className="stat-value" style={{ fontSize: 16 }}>
                    ${((exchange as { balance?: { available: number } }).balance?.available || 0).toLocaleString()}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">In Positions</span>
                  <span className="stat-value" style={{ fontSize: 16 }}>
                    ${((exchange as { balance?: { inPositions: number } }).balance?.inPositions || 0).toLocaleString()}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Open Positions</span>
                  <span className="stat-value">{(exchange as { exchange?: { openPositions: number } }).exchange?.openPositions || 0}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Total Orders</span>
                  <span className="stat-value">{(exchange as { exchange?: { totalOrders: number } }).exchange?.totalOrders || 0}</span>
                </div>
              </div>
            </div>
          )}

          {/* ---- Binance Connection ---- */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title">🔗 Binance</span>
              <span style={{ fontSize: 11, color: binanceStatus.startsWith('✅') ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {binanceStatus}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0' }}>
              <button className="btn" onClick={async () => {
                setBinanceStatus('Testing...');
                try {
                  const res = await fetch('/api/auto-trade', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'test-binance'}) });
                  const d = await res.json();
                  setBinanceStatus(d.connection?.ok ? `✅ ${d.connection.mode}` : `❌ ${d.connection?.error}`);
                } catch { setBinanceStatus('❌ Failed'); }
              }}>🔄 Test Connection</button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>HMAC SHA256 signed</span>
            </div>
          </div>

          {/* ---- ML Signal Scores ---- */}
          {autoTrade && (autoTrade as { mlScores?: Array<{ symbol: string; signal: string; score: number; verdict: string; reasons: string[] }> }).mlScores && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">🤖 ML Signal Filter</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pattern-based scoring</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Symbol</th><th>Signal</th><th>ML Score</th><th>Verdict</th><th>Reason</th></tr></thead>
                  <tbody>
                    {((autoTrade as { mlScores: Array<{ symbol: string; signal: string; score: number; verdict: string; reasons: string[] }> }).mlScores || []).map((m, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{m.symbol}</td>
                        <td><span className={`badge ${m.signal === 'BUY' || m.signal === 'LONG' ? 'badge-buy' : 'badge-sell'}`}>{m.signal}</span></td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: m.score >= 70 ? 'var(--accent-green)' : m.score >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)' }}>
                          {m.score}%
                        </td>
                        <td><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: m.verdict === 'STRONG' ? 'rgba(0,255,0,0.15)' : m.verdict === 'REJECT' ? 'rgba(255,0,0,0.15)' : 'rgba(255,255,0,0.1)', color: m.verdict === 'STRONG' ? 'var(--accent-green)' : m.verdict === 'REJECT' ? 'var(--accent-red)' : 'var(--accent-amber)' }}>{m.verdict}</span></td>
                        <td style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{m.reasons?.[0] || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---- Auto-Trade Candidates ---- */}
          {autoTrade && (autoTrade as { candidates?: Array<{ symbol: string; signal: string; confidence: number; shouldExecute: boolean; reason: string }> }).candidates && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">⚡ Auto-Trade</span>
                <span style={{ fontSize: 11, color: (autoTrade as { autoTradeEnabled?: boolean }).autoTradeEnabled ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                  {(autoTrade as { autoTradeEnabled?: boolean }).autoTradeEnabled ? '🟢 ACTIVE' : '🟡 STANDBY'}
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Symbol</th><th>Signal</th><th>Conf</th><th>Execute</th><th>Reason</th></tr></thead>
                  <tbody>
                    {((autoTrade as { candidates: Array<{ symbol: string; signal: string; confidence: number; shouldExecute: boolean; reason: string }> }).candidates || []).map((c, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{c.symbol}</td>
                        <td><span className={`badge ${c.signal === 'BUY' || c.signal === 'LONG' ? 'badge-buy' : 'badge-sell'}`}>{c.signal}</span></td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{c.confidence}%</td>
                        <td>{c.shouldExecute ? '✅' : '⏸️'}</td>
                        <td style={{ fontSize: 10, color: 'var(--text-secondary)', maxWidth: 250 }}>{c.reason.slice(0, 80)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---- Hourly Heatmap ---- */}
          {analytics && (analytics as { hourlyHeatmap?: Array<{ hour: number; trades: number; winRate: number; avgPnl: number }> }).hourlyHeatmap && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">🗓️ Hourly Performance Heatmap</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Best: {(analytics as { summary?: { bestHour: number } }).summary?.bestHour ?? '—'}h
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4, padding: '8px 0' }}>
                {((analytics as { hourlyHeatmap: Array<{ hour: number; trades: number; winRate: number; avgPnl: number }> }).hourlyHeatmap || []).map((h) => {
                  const bg = h.trades === 0 ? 'rgba(255,255,255,0.03)'
                    : h.avgPnl > 0 ? `rgba(0,255,100,${Math.min(h.avgPnl * 5, 0.4)})` 
                    : `rgba(255,50,50,${Math.min(Math.abs(h.avgPnl) * 5, 0.4)})`;
                  return (
                    <div key={h.hour} style={{ background: bg, borderRadius: 4, padding: '4px 2px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{h.hour}h</div>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{h.trades > 0 ? `${h.winRate}%` : '—'}</div>
                      <div style={{ fontSize: 8, color: h.avgPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {h.trades > 0 ? `${h.avgPnl >= 0 ? '+' : ''}${h.avgPnl}%` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---- Portfolio Tracker ---- */}
          {portfolio && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">💼 Portfolio</span>
                <span style={{ fontSize: 11, color: (portfolio as { totalPnl?: number }).totalPnl! >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  PnL: {(portfolio as { totalPnl?: number }).totalPnl! >= 0 ? '+' : ''}{(portfolio as { totalPnl?: number }).totalPnl}$
                </span>
              </div>
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">Total Balance</span>
                  <span className="stat-value">${(portfolio as { totalBalance?: number }).totalBalance?.toLocaleString()}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Cash</span>
                  <span className="stat-value">${(portfolio as { cashBalance?: number }).cashBalance?.toLocaleString()}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Invested</span>
                  <span className="stat-value">${(portfolio as { investedBalance?: number }).investedBalance?.toLocaleString()}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Daily PnL</span>
                  <span className={`stat-value ${(portfolio as { dailyPnl?: number }).dailyPnl! >= 0 ? 'text-green' : 'text-red'}`}>
                    {(portfolio as { dailyPnl?: number }).dailyPnl! >= 0 ? '+' : ''}{(portfolio as { dailyPnl?: number }).dailyPnl}%
                  </span>
                </div>
              </div>
              {/* Allocation bar */}
              {(portfolio as { allocation?: Array<{ symbol: string; percent: number }> }).allocation && (
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 20, marginTop: 8 }}>
                  {(portfolio as { allocation: Array<{ symbol: string; percent: number }> }).allocation.map((a, i) => {
                    const colors = ['rgba(100,100,255,0.4)', 'rgba(0,200,100,0.4)', 'rgba(255,180,0,0.4)', 'rgba(255,100,100,0.4)', 'rgba(180,100,255,0.4)', 'rgba(0,200,200,0.4)'];
                    return (
                      <div key={i} style={{ width: `${a.percent}%`, background: colors[i % colors.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, color: 'white', minWidth: a.percent > 5 ? 30 : 0 }}>
                        {a.percent > 5 ? `${a.symbol} ${a.percent}%` : ''}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Positions table */}
              {((portfolio as { positions?: Array<{ symbol: string; side: string; entryPrice: number; unrealizedPnlPercent: number; holdDuration: string }> }).positions || []).length > 0 && (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table>
                    <thead><tr><th>Symbol</th><th>Side</th><th>Entry</th><th>PnL</th><th>Hold</th></tr></thead>
                    <tbody>
                      {(portfolio as { positions: Array<{ symbol: string; side: string; entryPrice: number; unrealizedPnlPercent: number; holdDuration: string }> }).positions.map((p, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{p.symbol}</td>
                          <td><span className={`badge ${p.side === 'BUY' || p.side === 'LONG' ? 'badge-buy' : 'badge-sell'}`}>{p.side}</span></td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>${p.entryPrice}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: p.unrealizedPnlPercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {p.unrealizedPnlPercent >= 0 ? '+' : ''}{p.unrealizedPnlPercent}%
                          </td>
                          <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.holdDuration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ---- Signal Aggregator ---- */}
          {signals && (signals as { signals?: Array<{ symbol: string; signal: string; mlScore: number; mlVerdict: string; confidence: number; rank: number; age: string; source: string }> }).signals && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">📡 Signal Aggregator</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {(signals as { stats?: { total: number; strongSignals: number } }).stats?.total || 0} signals | {(signals as { stats?: { strongSignals: number } }).stats?.strongSignals || 0} STRONG
                  </span>
                  <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={async () => {
                    try {
                      await fetch('/api/telegram', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'test'}) });
                      setActionStatus('Telegram test sent!');
                    } catch { setActionStatus('Telegram error'); }
                    setTimeout(() => setActionStatus(''), 3000);
                  }}>📨 Telegram Test</button>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Rank</th><th>Symbol</th><th>Signal</th><th>ML</th><th>Conf</th><th>Age</th><th>Source</th></tr></thead>
                  <tbody>
                    {((signals as { signals: Array<{ symbol: string; signal: string; mlScore: number; mlVerdict: string; confidence: number; rank: number; age: string; source: string }> }).signals || []).slice(0, 15).map((s, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-purple)' }}>{s.rank}</td>
                        <td style={{ fontWeight: 600 }}>{s.symbol}</td>
                        <td><span className={`badge ${s.signal === 'BUY' || s.signal === 'LONG' ? 'badge-buy' : 'badge-sell'}`}>{s.signal}</span></td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: s.mlScore >= 70 ? 'var(--accent-green)' : s.mlScore >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)' }}>
                          {s.mlScore}% <span style={{ fontSize: 8, opacity: 0.6 }}>{s.mlVerdict}</span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{s.confidence}%</td>
                        <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.age}</td>
                        <td style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{s.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ---- Telegram Status ---- */}
          <div className="card" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📢</span>
              <span style={{ fontWeight: 600 }}>Telegram</span>
              <span style={{ fontSize: 11, color: telegramOk ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                {telegramOk === null ? 'Checking...' : telegramOk ? '✅ @tradedsd33_bot' : '🟡 Not configured'}
              </span>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Alerts with Accept/Reject</span>
          </div>

          {/* ---- Decision Log ---- */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">📒 Decision Memory</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{data.decisions.length} stored</span>
            </div>
            <div className="table-wrap">
              {data.decisions.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Symbol</th>
                      <th>Signal</th>
                      <th>Dir</th>
                      <th>Conf</th>
                      <th>Price</th>
                      <th>EMA 50</th>
                      <th>EMA 200</th>
                      <th>Outcome</th>
                      <th>PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.decisions.slice(0, 30).map((d) => (
                      <tr key={d.id}>
                        <td>{new Date(d.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ fontWeight: 600 }}>{d.symbol}</td>
                        <td>
                          <span className={`badge ${d.signal === 'BUY' || d.signal === 'LONG' ? 'badge-signal-buy' : d.signal === 'SELL' || d.signal === 'SHORT' ? 'badge-signal-sell' : 'badge-info'}`}>
                            {d.signal}
                          </span>
                        </td>
                        <td style={{ color: d.direction === 'BULLISH' ? 'var(--accent-green)' : d.direction === 'BEARISH' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          {d.direction === 'BULLISH' ? '▲' : d.direction === 'BEARISH' ? '▼' : '●'}
                        </td>
                        <td>{d.confidence}%</td>
                        <td>${d.price?.toLocaleString()}</td>
                        <td style={{ fontSize: 10 }}>${d.ema50?.toLocaleString()}</td>
                        <td style={{ fontSize: 10 }}>${d.ema200?.toLocaleString()}</td>
                        <td>
                          <span className={`badge ${d.outcome === 'WIN' ? 'badge-bullish' : d.outcome === 'LOSS' ? 'badge-bearish' : 'badge-info'}`}>
                            {d.outcome}
                          </span>
                        </td>
                        <td className={d.pnlPercent !== null ? (d.pnlPercent >= 0 ? 'text-green' : 'text-red') : ''}>
                          {d.pnlPercent !== null ? `${d.pnlPercent >= 0 ? '+' : ''}${d.pnlPercent}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">🧠</div>
                  No decisions recorded yet. BTC Engine will store them automatically.
                </div>
              )}
            </div>
          </div>

          {/* ---- Footer ---- */}
          <footer style={{
            textAlign: 'center',
            padding: '24px 0 12px',
            fontSize: 11,
            color: 'var(--text-muted)',
            borderTop: '1px solid var(--border)',
            marginTop: 24,
          }}>
            Bot Center — API: <code style={{ color: 'var(--accent-cyan)' }}>/api/bot</code> •
            Radar: <code style={{ color: 'var(--accent-cyan)' }}>/crypto-radar</code> •
            Mode: <span style={{ color: healthColor }}>{s?.mode}</span>
          </footer>
        </>
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
