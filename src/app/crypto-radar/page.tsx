'use client';

import { useState, useEffect, useCallback } from 'react';
import { Signal, DashboardStats, RadarFilters } from '@/lib/types/radar';

// ============================================================
// Crypto Radar — Main Dashboard Page
// ============================================================

interface TokenRow {
  symbol: string;
  name: string;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  status: 'bullish' | 'neutral' | 'bearish';
  chain: string;
  exchange: string;
}

const POLL_INTERVAL = 10_000; // 10 seconds

interface BTCData {
  price: number;
  ema50: number;
  ema200: number;
  ema800: number;
  dailyOpen: number;
  psychHigh: number;
  psychLow: number;
  signals: { signal: string; reason: string }[];
}

interface SolanaCoin {
  symbol: string;
  name: string;
  price: number;
  ema50: number;
  ema200: number;
  signals: { signal: string; reason: string }[];
}

export default function CryptoRadarPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalSignalsToday: 0,
    activeAlerts: 0,
    strongestMover: null,
    lastWebhookAt: null,
  });
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [topMovers, setTopMovers] = useState<TokenRow[]>([]);
  const [btcData, setBtcData] = useState<BTCData | null>(null);
  const [solCoins, setSolCoins] = useState<SolanaCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<string>('—');
  const [filters, setFilters] = useState<RadarFilters>({
    search: '',
    exchange: '',
    chain: '',
    minVolume: '',
    minMarketCap: '',
    minChange: '',
  });

  // ---- Fetch signals from webhook endpoint ----
  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/tradingview');
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals || []);
        setStats(data.stats || stats);
      }
    } catch (e) {
      console.warn('Signal fetch error:', e);
    }
  }, []);

  // ---- Fetch BTC engine analysis ----
  const fetchBTC = useCallback(async () => {
    try {
      const res = await fetch('/api/btc-signals');
      if (res.ok) {
        const data = await res.json();
        if (data.btc) setBtcData({ ...data.btc, signals: data.signals || [] });
        // Re-fetch signals since BTC engine pushes new ones to store
        await fetchSignals();
      }
    } catch (e) {
      console.warn('BTC engine error:', e);
    }
  }, [fetchSignals]);

  // ---- Fetch tokens from API ----
  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/tokens');
      if (res.ok) {
        const data = await res.json();
        const mapped: TokenRow[] = (data.tokens || []).map((t: Record<string, unknown>) => ({
          symbol: t.symbol || '?',
          name: t.name || '',
          price: t.price as number | null,
          change24h: t.priceChange1h as number | null,
          volume24h: t.volume24h as number | null,
          marketCap: t.marketCap as number | null,
          status: getStatus(t.priceChange1h as number | null),
          chain: (t.chain as string) || 'solana',
          exchange: (t.dexName as string) || '—',
        }));
        setTokens(mapped);
        // Top movers = sorted by absolute change
        const sorted = [...mapped]
          .filter((t) => t.change24h !== null)
          .sort((a, b) => Math.abs(b.change24h || 0) - Math.abs(a.change24h || 0));
        setTopMovers(sorted.slice(0, 10));
      }
    } catch (e) {
      console.warn('Token fetch error:', e);
    }
  }, []);

  // ---- Fetch Solana multi-coin engine ----
  const fetchSolana = useCallback(async () => {
    try {
      const res = await fetch('/api/solana-signals');
      if (res.ok) {
        const data = await res.json();
        setSolCoins(data.coins || []);
      }
    } catch (e) {
      console.warn('Solana fetch error:', e);
    }
  }, []);

  // ---- Initial + polling ----
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      // BTC engine first (pushes signals to store), then fetch them
      await Promise.all([fetchBTC(), fetchTokens()]);
      await fetchSignals();
      // Solana engine (delayed to avoid CoinGecko rate limit)
      setTimeout(() => fetchSolana(), 3000);
      setLastSync(new Date().toLocaleTimeString());
      setLoading(false);
    };
    load();
    const interval = setInterval(() => {
      fetchSignals();
      fetchTokens();
      setLastSync(new Date().toLocaleTimeString());
    }, POLL_INTERVAL);
    // BTC engine every 60s, Solana engine every 90s (offset to respect rate limits)
    const btcInterval = setInterval(() => { fetchBTC(); }, 60_000);
    const solInterval = setInterval(() => { fetchSolana(); }, 180_000);
    return () => { clearInterval(interval); clearInterval(btcInterval); clearInterval(solInterval); };
  }, [fetchSignals, fetchTokens, fetchBTC, fetchSolana]);

  // ---- Filter tokens ----
  const filtered = tokens.filter((t) => {
    if (filters.search && !t.symbol.toLowerCase().includes(filters.search.toLowerCase()) &&
        !t.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.exchange && t.exchange.toLowerCase() !== filters.exchange.toLowerCase()) return false;
    if (filters.chain && t.chain.toLowerCase() !== filters.chain.toLowerCase()) return false;
    if (filters.minVolume && (t.volume24h || 0) < parseFloat(filters.minVolume)) return false;
    if (filters.minMarketCap && (t.marketCap || 0) < parseFloat(filters.minMarketCap)) return false;
    if (filters.minChange && Math.abs(t.change24h || 0) < parseFloat(filters.minChange)) return false;
    return true;
  });

  const handleRefresh = async () => {
    setLoading(true);
    await Promise.all([fetchSignals(), fetchTokens(), fetchBTC()]);
    setLastSync(new Date().toLocaleTimeString());
    setLoading(false);
  };

  return (
    <div className="page-container">
      {/* ---- Top Bar ---- */}
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="logo">⚡ CryptoRadar <span>v1.0</span></div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <span className={`status-dot ${loading ? 'dot-amber' : 'dot-green'}`} />
            {loading ? 'Syncing...' : 'Live'}
          </span>
        </div>
        <div className="top-bar-right">
          <nav className="nav-toggle">
            <a href="/bot-center" className="nav-toggle-item">
              <span className="nav-dot" />
              <span className="nav-toggle-icon">🤖</span>
              <span className="nav-toggle-label">Bot</span>
            </a>
            <a href="/crypto-radar" className="nav-toggle-item active">
              <span className="nav-dot" />
              <span className="nav-toggle-icon">📡</span>
              <span className="nav-toggle-label">Radar</span>
            </a>
          </nav>
          <button className="btn" onClick={handleRefresh}>↻</button>
        </div>
      </header>

      {/* ---- Stat Cards ---- */}
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <span className="stat-label">Signals Today</span>
          <span className="stat-value">{stats.totalSignalsToday}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Alerts</span>
          <span className="stat-value text-amber">{stats.activeAlerts}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Strongest Mover</span>
          <span className="stat-value" style={{ fontSize: 18 }}>
            {stats.strongestMover
              ? `${stats.strongestMover.symbol} (${stats.strongestMover.change}×)`
              : '—'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Last Webhook</span>
          <span className="stat-sub">
            {stats.lastWebhookAt ? formatTime(stats.lastWebhookAt) : 'No webhooks yet'}
          </span>
        </div>
      </div>

      {/* ---- BTC Engine Card ---- */}
      {btcData && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">₿ BTC Engine — Traders Reality</span>
            <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 700 }}>
              ${btcData.price > 0 ? btcData.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <div className="stat-card">
              <span className="stat-label">EMA 50</span>
              <span className="stat-sub text-blue">${btcData.ema50 > 0 ? btcData.ema50.toLocaleString() : '—'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">EMA 200</span>
              <span className="stat-sub text-amber">${btcData.ema200 > 0 ? btcData.ema200.toLocaleString() : '—'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">EMA 800</span>
              <span className="stat-sub text-red">${btcData.ema800 > 0 ? btcData.ema800.toLocaleString() : '—'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Daily Open</span>
              <span className="stat-sub">${btcData.dailyOpen > 0 ? btcData.dailyOpen.toLocaleString() : '—'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Psych High</span>
              <span className="stat-sub text-green">${btcData.psychHigh.toLocaleString()}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Psych Low</span>
              <span className="stat-sub text-red">${btcData.psychLow.toLocaleString()}</span>
            </div>
            {btcData.signals.map((sig, i) => (
              <div key={i} className="stat-card" style={{ gridColumn: 'span 2' }}>
                <span className="stat-label">Signal</span>
                <div>
                  <span className={`badge ${getSignalBadge(sig.signal)}`} style={{ marginRight: 6 }}>
                    {sig.signal}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{sig.reason}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Solana Ecosystem Card ---- */}
      {solCoins.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">◎ Solana Ecosystem Engine</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {solCoins.filter(c => c.price > 0).length}/{solCoins.length} active
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Price</th>
                  <th>EMA 50</th>
                  <th>EMA 200</th>
                  <th>Signal</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {solCoins.filter(c => c.price > 0).map((coin) => (
                  <tr key={coin.symbol}>
                    <td style={{ fontWeight: 600 }}>{coin.symbol}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      ${coin.price < 1 ? coin.price.toFixed(6) : coin.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--accent-blue)' }}>
                      ${coin.ema50 < 1 ? coin.ema50.toFixed(6) : coin.ema50.toLocaleString()}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--accent-amber)' }}>
                      ${coin.ema200 < 1 ? coin.ema200.toFixed(6) : coin.ema200.toLocaleString()}
                    </td>
                    <td>
                      {coin.signals.map((s, i) => (
                        <span key={i} className={`badge ${getSignalBadge(s.signal)}`} style={{ marginRight: 4 }}>
                          {s.signal}
                        </span>
                      ))}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--text-secondary)', maxWidth: 200 }}>
                      {coin.signals.map(s => s.reason).join(' | ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Filters Bar ---- */}
      <div className="filters-bar">
        <input
          placeholder="🔍 Search symbol or name..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <select value={filters.chain} onChange={(e) => setFilters({ ...filters, chain: e.target.value })}>
          <option value="">All Chains</option>
          <option value="solana">Solana</option>
          <option value="ethereum">Ethereum</option>
          <option value="bsc">BSC</option>
        </select>
        <select value={filters.exchange} onChange={(e) => setFilters({ ...filters, exchange: e.target.value })}>
          <option value="">All Exchanges</option>
          <option value="raydium">Raydium</option>
          <option value="jupiter">Jupiter</option>
          <option value="orca">Orca</option>
          <option value="pumpfun">Pump.fun</option>
        </select>
        <input
          placeholder="Min Volume"
          type="number"
          style={{ width: 100 }}
          value={filters.minVolume}
          onChange={(e) => setFilters({ ...filters, minVolume: e.target.value })}
        />
        <input
          placeholder="Min MCap"
          type="number"
          style={{ width: 100 }}
          value={filters.minMarketCap}
          onChange={(e) => setFilters({ ...filters, minMarketCap: e.target.value })}
        />
        <input
          placeholder="Min % Change"
          type="number"
          style={{ width: 90 }}
          value={filters.minChange}
          onChange={(e) => setFilters({ ...filters, minChange: e.target.value })}
        />
      </div>

      {/* ---- Main Grid: Watchlist + Signals ---- */}
      <div className="grid-2" style={{ marginBottom: 16 }}>
        {/* Watchlist */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📋 Watchlist</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{filtered.length} tokens</span>
          </div>
          <div className="table-wrap">
            {filtered.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Price</th>
                    <th>24h %</th>
                    <th>Volume</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t, i) => (
                    <tr key={`${t.symbol}-${i}`}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                        {t.symbol}
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, fontSize: 10 }}>
                          {t.chain}
                        </span>
                      </td>
                      <td>{t.price !== null ? `$${formatNum(t.price)}` : '—'}</td>
                      <td className={t.change24h !== null ? (t.change24h >= 0 ? 'text-green' : 'text-red') : ''}>
                        {t.change24h !== null ? `${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%` : '—'}
                      </td>
                      <td>{t.volume24h !== null ? `$${formatCompact(t.volume24h)}` : '—'}</td>
                      <td>
                        <span className={`badge badge-${t.status}`}>
                          {t.status === 'bullish' ? '▲' : t.status === 'bearish' ? '▼' : '●'} {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                {loading ? 'Loading tokens...' : 'No tokens match filters'}
              </div>
            )}
          </div>
        </div>

        {/* Live Signals */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <span className="pulse" style={{ color: 'var(--accent-red)' }}>●</span>{' '}
              Live Signals
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{signals.length} total</span>
          </div>
          <div className="table-wrap">
            {signals.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Symbol</th>
                    <th>Signal</th>
                    <th>Dir</th>
                    <th>Action</th>
                    <th>Conf</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {signals.map((s: any) => (
                    <tr key={s.id}>
                      <td>{formatTime(s.timestamp)}</td>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.symbol}</td>
                      <td>
                        <span className={`badge ${getSignalBadge(s.signal)}`}>
                          {s.signal}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${getDirectionBadge(s.direction)}`}>
                          {s.direction === 'BULLISH' ? '▲' : s.direction === 'BEARISH' ? '▼' : '●'}{' '}
                          {s.direction || '—'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 10, color: s.action === 'ENTRY' ? 'var(--accent-green)' : s.action === 'EXIT' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          {s.action || '—'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, color: getConfColor(s.confidence) }}>
                          {s.confidence ? `${s.confidence}%` : '—'}
                        </span>
                      </td>
                      <td>{s.price > 0 ? `$${formatNum(s.price)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">📡</div>
                Waiting for TradingView signals...
                <div style={{ marginTop: 8, fontSize: 11 }}>
                  Send POST to <code style={{ color: 'var(--accent-cyan)' }}>/api/tradingview</code>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- Bottom Grid: Top Movers + Trade Log ---- */}
      <div className="grid-2">
        {/* Top Movers */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🔥 Top Movers</span>
          </div>
          <div className="table-wrap">
            {topMovers.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Symbol</th>
                    <th>Price</th>
                    <th>Change</th>
                    <th>Volume</th>
                    <th>MCap</th>
                  </tr>
                </thead>
                <tbody>
                  {topMovers.map((t, i) => (
                    <tr key={`mover-${t.symbol}-${i}`}>
                      <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t.symbol}</td>
                      <td>{t.price !== null ? `$${formatNum(t.price)}` : '—'}</td>
                      <td className={t.change24h !== null ? (t.change24h >= 0 ? 'text-green' : 'text-red') : ''}>
                        {t.change24h !== null ? `${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%` : '—'}
                      </td>
                      <td>{t.volume24h !== null ? `$${formatCompact(t.volume24h)}` : '—'}</td>
                      <td>{t.marketCap !== null ? `$${formatCompact(t.marketCap)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">🚀</div>
                Loading top movers...
              </div>
            )}
          </div>
        </div>

        {/* Trade Log */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📒 Trade Log</span>
            <span className="badge badge-info">Bot: Standby</span>
          </div>
          <div className="table-wrap">
            <div className="empty-state">
              <div className="empty-state-icon">🤖</div>
              Bot infrastructure ready — trading not activated
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Entry/exit rules, SL/TP, and position sizing schemas are prepared.
                <br />Activate when ready.
              </div>
            </div>
          </div>
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
        CryptoRadar v1.0 — Webhook: <code style={{ color: 'var(--accent-cyan)' }}>/api/tradingview</code> •
        Health: <code style={{ color: 'var(--accent-cyan)' }}>/api/health</code> •
        Tokens: <code style={{ color: 'var(--accent-cyan)' }}>/api/tokens</code>
      </footer>
    </div>
  );
}

// ---- Helpers ----

function getStatus(change: number | null): 'bullish' | 'neutral' | 'bearish' {
  if (change === null) return 'neutral';
  if (change > 2) return 'bullish';
  if (change < -2) return 'bearish';
  return 'neutral';
}

function getSignalBadge(signal: string): string {
  if (signal === 'BUY' || signal === 'LONG') return 'badge-signal-buy';
  if (signal === 'SELL' || signal === 'SHORT') return 'badge-signal-sell';
  return 'badge-info';
}

function getDirectionBadge(direction: string): string {
  if (direction === 'BULLISH') return 'badge-bullish';
  if (direction === 'BEARISH') return 'badge-bearish';
  return 'badge-neutral';
}

function getConfColor(confidence: number): string {
  if (confidence >= 80) return 'var(--accent-green)';
  if (confidence >= 60) return 'var(--accent-cyan)';
  if (confidence >= 40) return 'var(--accent-amber)';
  return 'var(--text-muted)';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function formatNum(n: number): string {
  if (n < 0.001) return n.toExponential(2);
  if (n < 1) return n.toFixed(6);
  if (n < 1000) return n.toFixed(2);
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}
