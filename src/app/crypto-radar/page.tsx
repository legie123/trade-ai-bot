'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Signal, DashboardStats, RadarFilters } from '@/lib/types/radar';
import InstallPwaButton from '@/components/InstallPwaButton';
import KpiBar from '@/components/KpiBar';
import Sparkline, { generateSparkData } from '@/components/Sparkline';
import { useDebounce, usePersistedState } from '@/hooks/useDebounce';
import { useBotStats } from '@/hooks/useBotStats';
// LoadingStates available for future skeletons
// import { SkeletonCard, ErrorState } from '@/components/LoadingStates';

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

interface LogDecision {
  id: string;
  timestamp: string;
  symbol: string;
  signal: string;
  outcome?: string;
}

const POLL_INTERVAL = 30_000; // 30 seconds (cost-optimized)

const FILTER_PRESETS: { label: string; icon: string; filters: Partial<RadarFilters> }[] = [
  { label: 'All', icon: '🌐', filters: { search: '', chain: '', exchange: '', minVolume: '', minChange: '' } },
  { label: 'SOL Scalp', icon: '⚡', filters: { chain: 'solana', exchange: 'raydium', minChange: '5' } },
  { label: 'ETH Movers', icon: '💎', filters: { chain: 'ethereum', minChange: '3' } },
  { label: 'High Vol', icon: '🔥', filters: { minVolume: '100000', minChange: '' } },
];

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
  const { stats: botStats } = useBotStats(30_000);
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_fetchError, setFetchError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string>('—');
  const [filters, setFilters] = usePersistedState<RadarFilters>('radar-filters', {
    search: '',
    exchange: '',
    chain: '',
    minVolume: '',
    minMarketCap: '',
    minChange: '',
  });
  const debouncedSearch = useDebounce(filters.search, 300);
  const [combatAudits, setCombatAudits] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [indicators, setIndicators] = useState<any>(null);

  // ---- Watch/Mute State ----
  const [watchlist, setWatchlist] = usePersistedState<string[]>('radar-watchlist', []);
  const [mutedSymbols, setMutedSymbols] = usePersistedState<string[]>('radar-muted', []);
  const [toast, setToast] = useState<string>('');

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleWatch = (symbol: string) => {
    if (watchlist.includes(symbol)) {
      setWatchlist(watchlist.filter((s: string) => s !== symbol));
      setToast(`👁 ${symbol} removed from watchlist`);
    } else {
      setWatchlist([...watchlist, symbol]);
      setToast(`👁 Watching ${symbol}`);
    }
  };

  const toggleMute = (symbol: string) => {
    if (mutedSymbols.includes(symbol)) {
      setMutedSymbols(mutedSymbols.filter((s: string) => s !== symbol));
      setToast(`🔊 ${symbol} unmuted`);
    } else {
      setMutedSymbols([...mutedSymbols, symbol]);
      setToast(`🔇 ${symbol} muted`);
    }
  };

  // ---- Fetch signals & health ----
  const [forgeState, setForgeState] = useState({ progress: 0, active: 0 });

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/tradingview');
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals || []);
        setStats(s => data.stats || s);
      }
      const healthRes = await fetch('/api/health');
      if (healthRes.ok) {
        const hData = await healthRes.json();
        setForgeState({
          progress: hData.trading?.forgeProgress || 0,
          active: hData.trading?.totalGladiators || 0,
        });
      }
    } catch (e) {
      console.warn('Signal/Health fetch error:', e);
    }
  }, []);

  const fetchDecisions = useCallback(async () => {
    try {
      const res = await fetch('/api/bot');
      if (res.ok) {
        const data = await res.json();
        if (data.syndicateAudits) {
          setCombatAudits(data.syndicateAudits.slice(0, 20));
        }
      }
    } catch {}
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

  const fetchIndicators = useCallback(async () => {
    try {
      const res = await fetch('/api/indicators');
      if (res.ok) setIndicators(await res.json());
    } catch { /* optional */ }
  }, []);

  // ---- Forge/Moltbook cron loop: triggers Forge Extraction & background sweep ----
  const triggerCron = useCallback(async () => {
    try { 
      await fetch('/api/cron'); // Trigger main heartbeat
      // Silently try moltbook (may fail without secret, which is fine since it's a Vercel cron)
      await fetch('/api/moltbook-cron'); 
    } catch { /* background, non-blocking */ }
  }, []);

  // ---- Initial + polling ----
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await triggerCron(); // Kick the trading loop first
      await Promise.all([fetchBTC(), fetchTokens(), fetchIndicators()]);
      await fetchSignals();
      await fetchDecisions();
      setTimeout(() => fetchSolana(), 3000);
      setLastSync(new Date().toLocaleTimeString());
      setLoading(false);
    };
    load();
    const interval = setInterval(() => {
      fetchSignals();
      fetchTokens();
      fetchDecisions();
      fetchIndicators();
      setLastSync(new Date().toLocaleTimeString());
    }, POLL_INTERVAL);
    // BTC engine + cron loop every 60s, Solana engine every 180s
    const cronInterval = setInterval(() => { triggerCron(); fetchBTC(); }, 60_000);
    const solInterval = setInterval(() => { fetchSolana(); }, 180_000);
    return () => { clearInterval(interval); clearInterval(cronInterval); clearInterval(solInterval); };
  }, [fetchSignals, fetchTokens, fetchBTC, fetchSolana, fetchDecisions, fetchIndicators, triggerCron]);

  // ---- Filter tokens ----
  const filtered = useMemo(() => tokens.filter((t) => {
    if (debouncedSearch && !t.symbol.toLowerCase().includes(debouncedSearch.toLowerCase()) &&
        !t.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    if (filters.exchange && t.exchange.toLowerCase() !== filters.exchange.toLowerCase()) return false;
    if (filters.chain && t.chain.toLowerCase() !== filters.chain.toLowerCase()) return false;
    if (filters.minVolume && (t.volume24h || 0) < parseFloat(filters.minVolume)) return false;
    if (filters.minMarketCap && (t.marketCap || 0) < parseFloat(filters.minMarketCap)) return false;
    if (filters.minChange && Math.abs(t.change24h || 0) < parseFloat(filters.minChange)) return false;
    return true;
  }), [tokens, debouncedSearch, filters]);

  const hasActiveFilters = filters.search || filters.chain || filters.exchange || filters.minVolume || filters.minChange;
  const activeFilterCount = [filters.search, filters.chain, filters.exchange, filters.minVolume, filters.minChange].filter(Boolean).length;

  const handleRefresh = async () => {
    setLoading(true);
    await Promise.all([fetchSignals(), fetchTokens(), fetchBTC()]);
    setLastSync(new Date().toLocaleTimeString());
    setLoading(false);
  };

  return (
    <div className="page-container" style={{ maxWidth: 1600 }}>
      {/* ---- Toast Notification ---- */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: 'rgba(6,182,212,0.15)',
          border: '1px solid #06b6d4',
          color: '#fff', fontSize: 13, fontWeight: 600,
          backdropFilter: 'blur(12px)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: 'radarToast 0.3s ease-out',
        }}>
          {toast}
        </div>
      )}
      <style>{`@keyframes radarToast { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }`}</style>
      {/* ---- Premium Navigation & Top Bar ---- */}
      <header className="glass-card" role="banner" aria-label="Crypto Radar navigation" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', marginBottom: 24, borderRadius: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="logo" style={{ fontSize: 20, letterSpacing: '0.05em' }}>
             <span style={{ color: '#fff', textShadow: '0 0 10px rgba(255,255,255,0.3)' }}>OPTICAL</span>
             <span style={{ color: 'var(--accent-red)', textShadow: '0 0 10px rgba(239, 68, 68, 0.4)' }}> RADAR</span>
          </div>
          <div style={{ padding: '4px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 20, fontSize: 11, border: '1px solid var(--border)' }}>
             <span className={`status-dot ${loading ? 'dot-amber' : 'dot-green'}`} />
             <span style={{ fontWeight: 600, letterSpacing: '0.05em' }}>{loading ? 'SYNCING...' : 'LIVE FEED'}</span>
          </div>
        </div>

        <nav className="nav-toggle">
          <Link href="/bot-center" className="nav-toggle-item">
            <span className="nav-dot" /> <span className="nav-toggle-icon">🏆</span> <span className="nav-toggle-label" style={{marginLeft: 4}}>Arena</span>
          </Link>
          <Link href="/crypto-radar" className="nav-toggle-item active">
            <span className="nav-dot" /> <span className="nav-toggle-icon">🛰️</span> <span className="nav-toggle-label" style={{marginLeft: 4}}>Radar view</span>
          </Link>
        </nav>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <InstallPwaButton />
          <button className="btn" onClick={handleRefresh} style={{ background: 'transparent', borderColor: 'var(--border)' }}>
            ↻ Matrix Sync
          </button>
        </div>
      </header>

      {/* ---- KPI Metrics Bar (LIVE from /api/bot) ---- */}
      <KpiBar
        equity={botStats.equity}
        pnl24h={botStats.todayPnlPercent}
        maxDrawdown={botStats.maxDrawdown}
        riskMode={botStats.mode}
        lastSync={lastSync || null}
        systemHealth={loading ? 'SYNCING' : botStats.strategyHealth}
        winRate={botStats.overallWinRate}
        totalDecisions={botStats.totalDecisions}
        todayDecisions={botStats.todayDecisions}
      />

      {/* ---- The Forge Progress (Super-AI Training) ---- */}
      <div className="glass-card" style={{ marginBottom: 24, padding: '20px 24px', borderRadius: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28 }}>🔬</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.05em', color: '#fff' }}>THE FORGE: MOLDING THE OMEGA GLADIATOR</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Extracting DNA from {forgeState.active} Active Gladiators</div>
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-cyan)' }}>
            {forgeState.progress}%
          </div>
        </div>
        
        {/* Progress Bar Container */}
        <div style={{ height: 12, background: 'rgba(0,0,0,0.4)', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)', position: 'relative' }}>
          <div style={{
            height: '100%',
            width: `${forgeState.progress}%`,
            background: 'linear-gradient(90deg, #3b82f6, #06b6d4, #10b981)',
            boxShadow: '0 0 15px rgba(6, 182, 212, 0.5)',
            transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative'
          }}>
            {/* Animated shimmer effect on the progress bar */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
              animation: 'shimmer 2s infinite',
              transform: 'skewX(-20deg)'
            }} />
          </div>
        </div>
        <style>{`@keyframes shimmer { 0% { transform: translateX(-100%) skewX(-20deg); } 100% { transform: translateX(200%) skewX(-20deg); } }`}</style>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
          <div>Assimilating Win Behaviors</div>
          <div>Target: 100 Wins (Genesis)</div>
        </div>
      </div>

      {/* ---- Filter Presets ---- */}
      <div role="toolbar" aria-label="Filter presets" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {FILTER_PRESETS.map((preset) => {
          const isActive = preset.label === 'All' ? !hasActiveFilters
            : Object.entries(preset.filters).every(([k, v]) => v ? filters[k as keyof RadarFilters] === v : true) && hasActiveFilters;
          return (
            <button key={preset.label} className={`filter-preset ${isActive ? 'filter-preset-active' : ''}`}
              aria-pressed={isActive ? true : false}
              onClick={() => setFilters({ ...filters, ...preset.filters, search: preset.label === 'All' ? '' : filters.search })}
            >
              {preset.icon} {preset.label}
            </button>
          );
        })}
        {hasActiveFilters && (
          <button className="filter-preset filter-preset-clear"
            aria-label="Clear all filters"
            onClick={() => setFilters({ search: '', exchange: '', chain: '', minVolume: '', minMarketCap: '', minChange: '' })}
          >
            ✕ Clear ({activeFilterCount})
          </button>
        )}
      </div>

      {/* ---- Filters Bar ---- */}
      <div className="glass-card" role="search" aria-label="Token filters" style={{ padding: '12px 20px', marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search symbol..." aria-label="Search by symbol or name" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)' }} />
        <select aria-label="Filter by blockchain" value={filters.chain} onChange={(e) => setFilters({ ...filters, chain: e.target.value })} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)' }}>
          <option value="">All Chains</option><option value="solana">Solana</option><option value="ethereum">Ethereum</option>
        </select>
        <select aria-label="Filter by exchange" value={filters.exchange} onChange={(e) => setFilters({ ...filters, exchange: e.target.value })} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)' }}>
          <option value="">All Exchanges</option><option value="raydium">Raydium</option><option value="pumpfun">Pump.fun</option>
        </select>
        <input placeholder="Min Vol" aria-label="Minimum volume filter" type="number" style={{ width: 100, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)' }} value={filters.minVolume} onChange={(e) => setFilters({ ...filters, minVolume: e.target.value })} />
        <input placeholder="Min % Change" aria-label="Minimum percent change filter" type="number" style={{ width: 100, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)' }} value={filters.minChange} onChange={(e) => setFilters({ ...filters, minChange: e.target.value })} />
        {debouncedSearch && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Showing results for &ldquo;{debouncedSearch}&rdquo;</span>
        )}
      </div>

      <div className="bento-grid">
        
        {/* ================= COLUMN 1 (Span 8) ================= */}
        <div className="bento-col-8" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
           
           {/* Market Intelligence Panel */}
           {indicators && (
             <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
               <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)' }}>
                 <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>🧠 GLOBAL MARKET CONTEXT</span>
                 <span className={`badge ${indicators.regime === 'BULL_TREND' ? 'badge-bullish' : indicators.regime === 'BEAR_TREND' ? 'badge-bearish' : 'badge-neutral'}`}>
                    {indicators.regime?.replace('_', ' ')}
                 </span>
               </div>
               
               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, padding: 20 }}>
                 <div>
                   <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Fear & Greed</div>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                     <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: indicators.fearGreed?.value <= 30 ? 'var(--accent-red)' : indicators.fearGreed?.value >= 70 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>{indicators.fearGreed?.value}</div>
                     <Sparkline data={generateSparkData(indicators.fearGreed?.value || 50, 14, 0.08)} color={indicators.fearGreed?.value <= 30 ? '#ef4444' : indicators.fearGreed?.value >= 70 ? '#10b981' : '#f59e0b'} width={70} height={24} />
                   </div>
                   <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{indicators.fearGreed?.label}</div>
                 </div>
                 <div>
                   <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>RSI (14)</div>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                     <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: indicators.rsi?.value <= 30 ? 'var(--accent-red)' : indicators.rsi?.value >= 70 ? 'var(--accent-green)' : 'var(--accent-blue)' }}>{indicators.rsi?.value}</div>
                     <Sparkline data={generateSparkData(indicators.rsi?.value || 50, 14, 0.06)} color={indicators.rsi?.value <= 30 ? '#ef4444' : indicators.rsi?.value >= 70 ? '#10b981' : '#3b82f6'} width={70} height={24} />
                   </div>
                   <div className="badge badge-info" style={{ marginTop: 4 }}>{indicators.rsi?.zone}</div>
                 </div>
                 <div>
                   <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>VWAP Metric</div>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                     <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)', marginTop: 4 }}>${indicators.vwap?.value?.toLocaleString()}</div>
                     <Sparkline data={generateSparkData(indicators.vwap?.value || 0, 12, 0.02)} color="#3b82f6" width={60} height={22} />
                   </div>
                   <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>Vol {indicators.vwap?.volumeRatio}x {indicators.vwap?.volumeSurge ? '🔥' : ''}</div>
                 </div>
                 <div>
                   <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>BB Band</div>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                     <Sparkline data={generateSparkData(indicators.bollingerBands?.upper || 0, 12, 0.015)} color="#10b981" width={50} height={20} showDot={false} />
                     <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                       <div style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent-green)' }}>${indicators.bollingerBands?.upper?.toLocaleString()}</div>
                       <div style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent-red)' }}>${indicators.bollingerBands?.lower?.toLocaleString()}</div>
                     </div>
                   </div>
                 </div>
               </div>
             </div>
           )}

           {/* Watchlist & Top Movers (Split Grid) */}
           <div className="grid-2">
              {/* Top Movers */}
              <div className="glass-card" style={{ padding: 0 }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-amber)', letterSpacing: '0.05em' }}>🔥 TOP MOVERS</span>
                </div>
                <div className="table-wrap" style={{ maxHeight: 300, padding: '0 8px 8px' }}>
                  {topMovers.length > 0 ? (
                    <table>
                      <thead><tr><th>Token</th><th>Price</th><th>24h %</th><th>MCap</th></tr></thead>
                      <tbody>
                        {topMovers.slice(0, 10).map((t, i) => (
                           <tr key={i}>
                             <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.symbol}</td>
                             <td style={{ fontFamily: 'var(--font-mono)' }}>{t.price !== null ? `$${formatNum(t.price)}` : '—'}</td>
                             <td style={{ fontFamily: 'var(--font-mono)', color: t.change24h !== null && t.change24h >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                               {t.change24h !== null ? `${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%` : '—'}
                             </td>
                             <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.marketCap !== null ? `$${formatCompact(t.marketCap)}` : '—'}</td>
                           </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (<div style={{ padding: 20, textAlign:'center', color: 'var(--text-muted)' }}>Scan loading...</div>)}
                </div>
              </div>

              {/* Watchlist Filtered */}
              <div className="glass-card" style={{ padding: 0 }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-cyan)', letterSpacing: '0.05em' }}>📋 WATCHLIST ({filtered.length})</span>
                </div>
                <div className="table-wrap" style={{ maxHeight: 300, padding: '0 8px 8px' }}>
                  {filtered.length > 0 ? (
                    <table>
                      <thead><tr><th>Token</th><th>DEX</th><th>Change</th><th>Status</th></tr></thead>
                      <tbody>
                        {filtered.slice(0, 20).map((t, i) => (
                           <tr key={i}>
                             <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.symbol}</td>
                             <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.exchange}</td>
                             <td style={{ fontFamily: 'var(--font-mono)', color: t.change24h !== null && t.change24h >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                               {t.change24h !== null ? `${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%` : '—'}
                             </td>
                             <td><span className={`badge badge-${t.status}`} style={{ fontSize: 9 }}>{t.status}</span></td>
                           </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (<div style={{ padding: 20, textAlign:'center', color: 'var(--text-muted)' }}>No tokens match filters</div>)}
                </div>
              </div>
           </div>
        </div>

        {/* ================= COLUMN 2 (Span 4) ================= */}
        <div className="bento-col-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
           
           {/* Radar Pulse Identity */}
           <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(145deg, rgba(6, 182, 212, 0.1), rgba(15, 23, 42, 0.6))' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600, letterSpacing: '0.05em' }}>TODAY'S ACTIVITY</div>
                <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff' }}>{stats.totalSignalsToday} <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>SIGNALS</span></div>
              </div>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(6, 182, 212, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--accent-cyan)' }} className="pulse">
                 🛰️
              </div>
           </div>

           {/* Live Signals Data Stream */}
           <div className="glass-card" style={{ flex: 1, padding: 0, display: 'flex', flexDirection: 'column' }}>
             <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>LIVE SIGNALS STREAM</span>
                <span className="pulse" style={{ fontSize: 10, color: 'var(--accent-red)' }}>● {combatAudits.length > 0 ? combatAudits.length : signals.length}</span>
             </div>
             
             <div style={{ padding: 12, flex: 1, maxHeight: 450, overflowY: 'auto' }}>
                {combatAudits.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {combatAudits.filter((s: any) => !mutedSymbols.includes(s.symbol)).slice(0, 15).map((audit: any) => (
                      <div key={audit.id} style={{ display: 'flex', flexDirection: 'column', padding: 12, background: watchlist.includes(audit.symbol) ? 'rgba(6,182,212,0.08)' : 'rgba(0,0,0,0.2)', borderRadius: 8, borderLeft: `3px solid ${audit.finalDirection === 'LONG' ? 'var(--accent-green)' : audit.finalDirection === 'SHORT' ? 'var(--accent-red)' : 'var(--text-muted)'}`, transition: 'background 0.2s' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{formatTime(audit.timestamp)}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{audit.symbol} {watchlist.includes(audit.symbol) && <span style={{ fontSize: 10, color: 'var(--accent-cyan)' }}>★</span>}</span>
                          <span className={`badge ${audit.finalDirection === 'LONG' ? 'badge-signal-buy' : audit.finalDirection === 'SHORT' ? 'badge-signal-sell' : 'badge-info'}`} style={{ fontSize: 10 }}>{audit.finalDirection || 'NEUTRAL'}</span>
                          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: getConfColor(audit.weightedConfidence ? audit.weightedConfidence * 100 : 0) }}>
                            {Math.round((audit.weightedConfidence || 0) * 100)}%
                          </span>
                          
                          {/* Actionable CTAs */}
                          <div className="signal-cta-group">
                            <button className="signal-cta" title={watchlist.includes(audit.symbol) ? 'Unwatch' : 'Watch'} onClick={() => toggleWatch(audit.symbol)} style={{ background: watchlist.includes(audit.symbol) ? 'rgba(6,182,212,0.2)' : undefined, color: watchlist.includes(audit.symbol) ? 'var(--accent-cyan)' : undefined }}>👁</button>
                            <button className="signal-cta" title={mutedSymbols.includes(audit.symbol) ? 'Unmute' : 'Mute'} onClick={() => toggleMute(audit.symbol)} style={{ opacity: 0.5 }}>🔇</button>
                          </div>
                        </div>
                        {audit.opinions && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            {audit.opinions.map((op: any, i: number) => (
                              <div key={i} style={{ fontSize: 11, background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{op.seat}</span>
                                  <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', color: op.direction === 'LONG' ? 'var(--accent-green)' : op.direction === 'SHORT' ? 'var(--accent-red)' : 'var(--text-muted)'}}>
                                    {op.direction} ({(op.confidence * 100).toFixed(0)}%)
                                  </span>
                                </div>
                                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4, fontStyle: 'italic' }}>&quot;{op.reasoning}&quot;</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : signals.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {signals.filter((s: any) => !mutedSymbols.includes(s.symbol)).slice(0, 15).map((s: any) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: watchlist.includes(s.symbol) ? 'rgba(6,182,212,0.08)' : 'rgba(0,0,0,0.2)', borderRadius: 8, borderLeft: `3px solid ${s.signal.includes('BUY') ? 'var(--accent-green)' : 'var(--accent-red)'}`, transition: 'background 0.2s' }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{formatTime(s.timestamp)}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{s.symbol} {watchlist.includes(s.symbol) && <span style={{ fontSize: 10, color: 'var(--accent-cyan)' }}>★</span>}</span>
                        <span className={`badge ${getSignalBadge(s.signal)}`} style={{ fontSize: 10 }}>{s.signal}</span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: getConfColor(s.confidence) }}>{s.confidence}%</span>
                        
                        {/* Actionable CTAs */}
                        <div className="signal-cta-group">
                          <button className="signal-cta" title={watchlist.includes(s.symbol) ? 'Unwatch' : 'Watch'} onClick={() => toggleWatch(s.symbol)} style={{ background: watchlist.includes(s.symbol) ? 'rgba(6,182,212,0.2)' : undefined, color: watchlist.includes(s.symbol) ? 'var(--accent-cyan)' : undefined }}>👁</button>
                          <button className="signal-cta" title={mutedSymbols.includes(s.symbol) ? 'Unmute' : 'Mute'} onClick={() => toggleMute(s.symbol)} style={{ opacity: 0.5 }}>🔇</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Awaiting optical data...</div>
                )}
             </div>
           </div>

        </div>

        {/* ================= COLUMN 3: ENGINE MODULES (Span 12) ================= */}
        <div className="bento-col-12 grid-2">
           
           {/* BTC Reality Engine */}
           {btcData && (
             <div className="glass-card" style={{ padding: 0 }}>
               <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-amber)', letterSpacing: '0.05em' }}>₿ THE BITCOIN ENGINE</span>
                 <span style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>${btcData.price.toLocaleString()}</span>
               </div>
               <div className="grid-4" style={{ padding: 20 }}>
                 <div>
                   <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>EMA 50 / 200</div>
                   <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)', fontWeight: 600 }}>${btcData.ema50?.toLocaleString()}</div>
                   <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--accent-amber)', fontWeight: 600 }}>${btcData.ema200?.toLocaleString()}</div>
                 </div>
                 <div>
                   <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Daily Open</div>
                   <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }}>${btcData.dailyOpen?.toLocaleString()}</div>
                 </div>
                 <div style={{ gridColumn: 'span 2' }}>
                   <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Live Signals</div>
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                     {btcData.signals.slice(0, 3).map((sig, i) => (
                       <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className={`badge ${getSignalBadge(sig.signal)}`} style={{ fontSize: 9 }}>{sig.signal}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{sig.reason}</span>
                       </div>
                     ))}
                   </div>
                 </div>
               </div>
             </div>
           )}

           {/* Solana Matrix */}
           {solCoins.length > 0 && (
             <div className="glass-card" style={{ padding: 0 }}>
               <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-purple)', letterSpacing: '0.05em' }}>◎ SOLANA MULTI-COIN ECOSYSTEM</span>
                 <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{solCoins.filter(c => c.price > 0).length} ACTIVE TRACKERS</span>
               </div>
               <div className="table-wrap" style={{ maxHeight: 200, padding: '0 8px 8px' }}>
                 <table>
                   <thead><tr><th>Token</th><th>Price</th><th>Signal</th><th>Reason</th></tr></thead>
                   <tbody>
                     {solCoins.filter(c => c.price > 0).map((coin) => (
                       <tr key={coin.symbol}>
                         <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{coin.symbol}</td>
                         <td style={{ fontFamily: 'var(--font-mono)' }}>${coin.price < 1 ? coin.price.toFixed(6) : coin.price.toLocaleString()}</td>
                         <td>
                           {coin.signals.slice(0, 1).map((s, i) => (
                             <span key={i} className={`badge ${getSignalBadge(s.signal)}`} style={{ fontSize: 9 }}>{s.signal}</span>
                           ))}
                         </td>
                         <td style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{coin.signals[0]?.reason.slice(0, 40)}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             </div>
           )}

        </div>

      </div>

      {/* ---- Footer ---- */}
      <footer style={{ textAlign: 'center', padding: '24px 0 12px', fontSize: 11, color: 'var(--text-muted)', marginTop: 24 }}>
        OPTICAL RADAR — TRADE AI PHOENIX V2 | Matrix Last Sync: {lastSync} | Connected via <code style={{ color: 'var(--accent-cyan)' }}>/api/tradingview</code>
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
