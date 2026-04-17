'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import BottomNav from '@/components/BottomNav';
import IntelligencePanel from '@/components/IntelligencePanel';
import HelpTooltip from '@/components/HelpTooltip';

const POLY_HELP = {
  command: {
    title: 'Command Center',
    description: 'Centrul de comandă Polymarket — vizualizare globală a sectorului de predicție AI.',
    details: [
      'CLOB — conexiunea la bursa de ordine Polymarket (clob.polymarket.com)',
      'GAMMA — conexiunea la API-ul de piețe Polymarket (gamma-api.polymarket.com)',
      'Verde = conexiune activă | Roșu = conexiune întreruptă',
      'Gladiators LIVE = agenți activi care plasează pariuri pe bani reali (paper mode: virtual)',
      'PAPER MODE = toate tranzacțiile sunt simulate, fără risc real',
    ],
    tip: 'Dacă CLOB sau GAMMA arată roșu, scanarea de piețe nu va funcționa. Verifică secretele din GCP.',
  },
  scanner: {
    title: 'Market Scanner',
    description: 'Scanează piețele de predicție după oportunități — edge scoring, mispricing și momentum.',
    details: [
      'Edge Score — cât de mult deviază prețul față de probabilitatea reală estimată (0-100)',
      'Mispricing Score — eroarea de preț detectată față de valoarea așteptată',
      'Momentum Score — intensitatea mișcării recente a prețului',
      'Risk Level — evaluarea riscului: LOW / MEDIUM / HIGH',
      'Recommendation — STRONG BUY / BUY / PASS bazat pe scorul agregat',
    ],
    tip: 'Edge Score >60 + Risk LOW = oportunitate de calitate. Scanează TRENDING zilnic pentru cele mai bune setup-uri.',
  },
  gladiators: {
    title: 'Poly Gladiators',
    description: 'Agenții AI specializați pe fiecare divizie Polymarket, antrenați prin phantom bets.',
    details: [
      'Readiness Score — pregătirea gladiatorului (0-100) bazat pe training',
      'Division Expertise — specializarea pe un anumit tip de piață',
      'Win Rate — procentul pariurilor câștigate din toate phantom bets',
      'IN_TRAINING = acumulează date | READY = poate paria | LIVE = plasează pariuri reale',
      'Phantom Bets = pariuri simulate pentru antrenament, fără bani reali',
    ],
    tip: 'Un gladiator devine LIVE când are Win Rate >55% + Readiness >70 + minim 20 phantom bets.',
  },
  markets: {
    title: 'Markets Browser',
    description: 'Browsing direct al piețelor active pe Polymarket, grupate pe divizii.',
    details: [
      'Volume 24H — valoarea totală tranzacționată în ultimele 24 ore (USDT)',
      'Liquidity USD — lichiditatea disponibilă în order book',
      'Outcomes — variantele posibile de câștig + probabilitățile curente',
      'End Date — data la care piața se închide și se stabilesc câștigătorii',
    ],
    tip: 'Piețele cu Volume 24H mare au spread mai mic și execuție mai bună. Evită piețele cu lichiditate sub $1,000.',
  },
  wallet: {
    title: 'Paper Wallet',
    description: 'Portofelul virtual pentru simularea tranzacțiilor Polymarket în modul Paper Trading.',
    details: [
      'Total Balance — suma disponibilă pentru noi pariuri (pornește cu $16,000 virtual)',
      'Total Invested — suma blocată în pariuri active deschise',
      'Realized PnL — profitul/pierderea din pariurile deja închise',
      'Unrealized PnL — profitul/pierderea curentă pe pozițiile deschise',
      'Per Division — breakdown pe fiecare categorie (Crypto, Politics, Sports etc)',
    ],
    tip: 'PAPER MODE complet — zero risc real. Sistemul simulează execuția exactă ca în live trading.',
  },
} as const;

/* ── Types ──────────────────────────────────────── */
interface DivisionStat {
  division: string;
  balance: number;
  invested: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalReturn: number;
  positionCount: number;
  maxDrawdown: number;
}
interface WalletData {
  totalBalance: number;
  totalInvested: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  roi: number;
  positionCount: number;
  divisionStats: DivisionStat[];
}
interface GladiatorData {
  id: string;
  name: string;
  division: string;
  readinessScore: number;
  divisionExpertise: number;
  winRate: string;
  totalBets: number;
  phantomBets: number;
  cumulativeEdge: string;
  status: string;
  isLive: boolean;
}
interface ScanOpportunity {
  marketId: string;
  division: string;
  edgeScore: number;
  mispricingScore: number;
  momentumScore: number;
  riskLevel: string;
  recommendation: string;
  reasoning: string;
  market: { title: string; outcomes: { name: string; price: number }[] };
}
interface ScanResult {
  division: string;
  totalMarkets: number;
  opportunities: ScanOpportunity[];
  topPick: ScanOpportunity | null;
}
interface MarketItem {
  id: string;
  title: string;
  outcomes: { name: string; price: number }[];
  volume24h: number;
  liquidityUSD: number;
  endDate: string;
  active: boolean;
}
interface LogEntry {
  ts: number;
  type: 'scan' | 'info' | 'warn' | 'error' | 'success';
  msg: string;
}

/* ── Constants ──────────────────────────────────── */
import { C } from '@/lib/theme';
const DIVISIONS = [
  'TRENDING','BREAKING','NEW','POLITICS','SPORTS','CRYPTO','ESPORTS',
  'IRAN','FINANCE','GEOPOLITICS','TECH','CULTURE','ECONOMY','WEATHER','MENTIONS','ELECTIONS'
];

/* ── Helpers ─────────────────────────────────────── */
function riskColor(r: string) {
  if (r === 'LOW') return C.green;
  if (r === 'HIGH') return C.red;
  return C.yellow;
}
function edgeColor(e: number) {
  if (e >= 60) return C.green;
  if (e >= 40) return C.yellow;
  return C.mutedLight;
}
function statusStyle(s: string) {
  if (s === 'LIVE') return { color: C.green, bg: 'rgba(0,230,118,0.12)', border: 'rgba(0,230,118,0.3)' };
  if (s === 'IN_TRAINING') return { color: C.blue, bg: 'rgba(41,182,246,0.12)', border: 'rgba(41,182,246,0.3)' };
  if (s === 'READY') return { color: C.yellow, bg: 'rgba(255,215,64,0.12)', border: 'rgba(255,215,64,0.3)' };
  return { color: C.mutedLight, bg: 'rgba(155,165,190,0.08)', border: 'rgba(155,165,190,0.2)' };
}

export default function PolymarketPage() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [gladiators, setGladiators] = useState<GladiatorData[]>([]);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [markets, setMarkets] = useState<MarketItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanningDiv, setScanningDiv] = useState<string | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'command' | 'scanner' | 'gladiators' | 'markets' | 'wallet'>('command');
  const [selectedDivision, setSelectedDivision] = useState<string>('TRENDING');
  const [gladFilter, setGladFilter] = useState<'all' | 'live' | 'training'>('all');
  const [lastSync, setLastSync] = useState('—');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connHealth, setConnHealth] = useState<{ clob: boolean; gamma: boolean } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((type: LogEntry['type'], msg: string) => {
    setLogs(prev => [{ ts: Date.now(), type, msg }, ...prev].slice(0, 50));
  }, []);

  const fetchCore = useCallback(async () => {
    try {
      const [statusRes, walletRes, gladRes] = await Promise.all([
        fetch('/api/v2/polymarket?action=status'),
        fetch('/api/v2/polymarket?action=wallet'),
        fetch('/api/v2/polymarket?action=gladiators'),
      ]);
      // API wraps responses in { success, data } via successResponse
      if (statusRes.ok) {
        const s = await statusRes.json();
        const sd = s.data || s;
        setStatus(sd);
        setConnHealth(sd.connection || null);
      }
      if (walletRes.ok) {
        const w = await walletRes.json();
        const wd = w.data || w;
        setWallet(wd.wallet || null);
      }
      if (gladRes.ok) {
        const g = await gladRes.json();
        const gd = g.data || g;
        setGladiators(gd.gladiators || []);
      }
      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      addLog('error', `Fetch failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  // Auto-refresh
  useEffect(() => {
    fetchCore();
    if (!autoRefresh) return;
    const t = setInterval(fetchCore, 12_000);
    return () => clearInterval(t);
  }, [fetchCore, autoRefresh]);

  // Auto-scan TRENDING + CRYPTO on first mount to populate scanner data
  const autoScannedRef = useRef(false);
  useEffect(() => {
    if (autoScannedRef.current) return;
    autoScannedRef.current = true;
    // Delay to let fetchCore settle first
    const timer = setTimeout(async () => {
      try {
        addLog('scan', 'Auto-scanning TRENDING + CRYPTO on startup...');
        const res = await fetch('/api/v2/polymarket?action=scan&division=TRENDING');
        if (res.ok) {
          const raw = await res.json();
          const data = raw.data || raw;
          const newScans = data.scans || (data.scan ? [data.scan] : []);
          setScans(prev => {
            const merged = [...prev];
            for (const ns of newScans) {
              const idx = merged.findIndex(s => s.division === ns.division);
              if (idx >= 0) merged[idx] = ns; else merged.push(ns);
            }
            return merged;
          });
          const oppCount = newScans.reduce((a: number, s: ScanResult) => a + (s.opportunities?.length || 0), 0);
          addLog('success', `Auto-scan complete: ${oppCount} opportunities in TRENDING`);
        }
      } catch { /* non-blocking */ }
    }, 2000);
    return () => clearTimeout(timer);
  }, [addLog]);

  const runScan = async (division?: string) => {
    const div = division || selectedDivision;
    if (division) setScanningDiv(division); else setScanning(true);
    addLog('scan', `Scanning ${div}...`);
    try {
      const url = division
        ? `/api/v2/polymarket?action=scan&division=${div}`
        : '/api/v2/polymarket?action=scan';
      const res = await fetch(url);
      if (res.ok) {
        const raw = await res.json();
        const data = raw.data || raw;
        const newScans = data.scans || (data.scan ? [data.scan] : []);
        setScans(prev => {
          const merged = [...prev];
          for (const ns of newScans) {
            const idx = merged.findIndex(s => s.division === ns.division);
            if (idx >= 0) merged[idx] = ns; else merged.push(ns);
          }
          return merged;
        });
        const oppCount = newScans.reduce((a: number, s: ScanResult) => a + (s.opportunities?.length || 0), 0);
        addLog('success', `Scan complete: ${oppCount} opportunities found in ${div}`);
      } else {
        addLog('error', `Scan failed: ${res.status}`);
      }
    } catch (err) {
      addLog('error', `Scan error: ${(err as Error).message}`);
    } finally {
      setScanning(false);
      setScanningDiv(null);
    }
  };

  const fetchMarkets = async (div: string) => {
    setLoadingMarkets(true);
    addLog('info', `Fetching ${div} markets...`);
    try {
      const res = await fetch(`/api/v2/polymarket?action=markets&division=${div}`);
      if (res.ok) {
        const raw = await res.json();
        const data = raw.data || raw;
        setMarkets(data.markets || []);
        addLog('success', `Loaded ${data.markets?.length || 0} markets from ${div}`);
      }
    } catch (err) {
      addLog('error', `Markets fetch error: ${(err as Error).message}`);
    } finally {
      setLoadingMarkets(false);
    }
  };

  const runHealthCheck = async () => {
    addLog('info', 'Running health check...');
    try {
      const res = await fetch('/api/v2/polymarket?action=health');
      if (res.ok) {
        const raw = await res.json();
        const data = raw.data || raw;
        setConnHealth(data.polymarket || null);
        addLog('success', `Health: CLOB=${data.polymarket?.clob ? 'OK' : 'FAIL'} Gamma=${data.polymarket?.gamma ? 'OK' : 'FAIL'}`);
      }
    } catch (err) {
      addLog('error', `Health check failed: ${(err as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #1a1530, #050609)', color: C.purple }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16, animation: 'pulseGlow 2s infinite' }}>🔮</div>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.2em' }}>INITIALIZING POLYMARKET SECTOR...</div>
        </div>
        <style>{`@keyframes pulseGlow { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.1)} }`}</style>
      </div>
    );
  }

  const totalOpps = scans.reduce((a, s) => a + (s.opportunities?.length || 0), 0);
  const liveGlads = gladiators.filter(g => g.isLive).length;
  const trainingGlads = gladiators.filter(g => g.status === 'IN_TRAINING').length;
  const filteredGlads = gladiators.filter(g => {
    if (gladFilter === 'live') return g.isLive;
    if (gladFilter === 'training') return g.status === 'IN_TRAINING';
    return true;
  });

  const tabs = [
    { id: 'command' as const, label: 'COMMAND', icon: '⚡' },
    { id: 'scanner' as const, label: 'SCANNER', icon: '🔍' },
    { id: 'gladiators' as const, label: 'GLADIATORS', icon: '⚔️' },
    { id: 'markets' as const, label: 'MARKETS', icon: '📊' },
    { id: 'wallet' as const, label: 'WALLET', icon: '💰' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #1a1530, #050609)', color: C.text, paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Outfit", "Inter", sans-serif' }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap');
        @keyframes pulseGlow { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.02)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes scanPulse { 0%{box-shadow:0 0 0 0 rgba(139,92,246,0.4)} 70%{box-shadow:0 0 0 10px rgba(139,92,246,0)} 100%{box-shadow:0 0 0 0 rgba(139,92,246,0)} }

        .glass-card {
          background: rgba(18, 22, 38, 0.55);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.04);
          border-radius: 16px;
          box-shadow: 0 8px 32px 0 rgba(0,0,0,0.2);
          transition: border-color 0.2s ease;
        }
        .glass-card:hover { border-color: rgba(255,255,255,0.08); }

        .op-btn {
          padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
          background: rgba(139,92,246,0.15); color: ${C.purple}; cursor: pointer;
          font-size: 12px; font-weight: 700; letter-spacing: 0.05em;
          transition: all 0.2s; display: flex; align-items: center; gap: 6;
        }
        .op-btn:hover { background: rgba(139,92,246,0.3); border-color: ${C.purpleDark}; box-shadow: 0 0 15px rgba(139,92,246,0.3); transform: translateY(-1px); }
        .op-btn:active { transform: scale(0.97); }
        .op-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }

        .op-btn-green { background: rgba(0,230,118,0.12); color: ${C.green}; border-color: rgba(0,230,118,0.2); }
        .op-btn-green:hover { background: rgba(0,230,118,0.25); border-color: ${C.green}; box-shadow: 0 0 15px rgba(0,230,118,0.3); }

        .op-btn-blue { background: rgba(41,182,246,0.12); color: ${C.blue}; border-color: rgba(41,182,246,0.2); }
        .op-btn-blue:hover { background: rgba(41,182,246,0.25); border-color: ${C.blue}; box-shadow: 0 0 15px rgba(41,182,246,0.3); }

        .division-chip {
          padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 700;
          cursor: pointer; border: 1px solid rgba(255,255,255,0.06); transition: all 0.2s;
          background: rgba(255,255,255,0.03); color: ${C.mutedLight};
        }
        .division-chip:hover { background: rgba(139,92,246,0.15); border-color: ${C.purpleDark}40; }
        .division-chip.active { background: rgba(139,92,246,0.25); border-color: ${C.purpleDark}; color: ${C.purple}; }

        .log-line { font-size: 11px; font-family: monospace; padding: 4px 8px; border-radius: 4px; }

        .tab-btn { padding: 10px 20px; border: none; cursor: pointer; font-size: 12px; font-weight: 700;
          letter-spacing: 0.1em; border-radius: 10px; transition: all 0.2s; display: flex; align-items: center; gap: 6; }

        input:focus, select:focus { outline: none; border-color: ${C.purpleDark} !important; }
      `}</style>

      {/* ── TOP BAR ───────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50, background: 'rgba(5, 6, 9, 0.85)',
        backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'
      }}>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.15em', color: C.text }}>
          POLY<span style={{ color: C.purpleDark }}>.SECTOR</span>
        </span>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 800,
            background: connHealth?.clob ? 'rgba(0,230,118,0.12)' : 'rgba(255,61,87,0.12)',
            color: connHealth?.clob ? C.green : C.red, border: `1px solid ${connHealth?.clob ? C.green : C.red}30` }}>
            CLOB {connHealth?.clob ? '●' : '○'}
          </span>
          <span style={{ padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 800,
            background: connHealth?.gamma ? 'rgba(0,230,118,0.12)' : 'rgba(255,61,87,0.12)',
            color: connHealth?.gamma ? C.green : C.red, border: `1px solid ${connHealth?.gamma ? C.green : C.red}30` }}>
            GAMMA {connHealth?.gamma ? '●' : '○'}
          </span>
          <HelpTooltip section={POLY_HELP.command} size={12} />
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="op-btn" onClick={() => setAutoRefresh(!autoRefresh)}
            style={{ fontSize: 10, padding: '4px 10px', background: autoRefresh ? 'rgba(0,230,118,0.12)' : 'rgba(255,61,87,0.12)',
              color: autoRefresh ? C.green : C.red, borderColor: autoRefresh ? `${C.green}30` : `${C.red}30` }}>
            {autoRefresh ? '● AUTO' : '○ PAUSED'}
          </button>
          <button className="op-btn" onClick={runHealthCheck} style={{ fontSize: 10, padding: '4px 10px' }}>
            🩺 CHECK
          </button>
          <button className="op-btn op-btn-blue" onClick={fetchCore} style={{ fontSize: 10, padding: '4px 10px' }}>
            ↻ SYNC
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.02)', padding: '4px 10px', borderRadius: 8 }}>
            <span style={{ fontSize: 10, color: C.mutedLight, fontWeight: 600 }}>{lastSync}</span>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, boxShadow: `0 0 8px ${C.green}`, animation: autoRefresh ? 'pulseGlow 2s infinite' : 'none' }} />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ margin: '12px 16px', background: 'rgba(255,61,87,0.1)', border: `1px solid ${C.red}30`, borderRadius: 10, padding: '10px 16px', color: C.red, fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* ── TABS ──────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, padding: '12px 16px', overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button key={tab.id} className="tab-btn" onClick={() => setActiveTab(tab.id)}
            style={{
              background: activeTab === tab.id ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.02)',
              color: activeTab === tab.id ? C.purple : C.mutedLight,
              border: `1px solid ${activeTab === tab.id ? C.purpleDark + '50' : 'transparent'}`,
            }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <div style={{ padding: '0 16px 24px', maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ════════════════ COMMAND CENTER TAB ════════════════ */}
        {activeTab === 'command' && (
          <>
            {/* KPI Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {[
                { label: 'TOTAL BALANCE', value: `$${wallet?.totalBalance?.toLocaleString() || '0'}`, color: C.purple, glow: `0 0 20px ${C.purple}30` },
                { label: 'INVESTED', value: `$${wallet?.totalInvested?.toLocaleString() || '0'}`, color: C.blue, glow: 'none' },
                { label: 'REALIZED P&L', value: `$${wallet?.realizedPnL?.toFixed(2) || '0.00'}`, color: (wallet?.realizedPnL || 0) >= 0 ? C.green : C.red, glow: (wallet?.realizedPnL || 0) >= 0 ? `0 0 15px ${C.green}30` : `0 0 15px ${C.red}30` },
                { label: 'POSITIONS', value: String(wallet?.positionCount || 0), color: C.yellow, glow: 'none' },
                { label: 'GLADIATORS', value: `${liveGlads} / ${gladiators.length}`, color: C.purple, glow: 'none' },
                { label: 'OPPORTUNITIES', value: String(totalOpps), color: totalOpps > 0 ? C.green : C.mutedLight, glow: totalOpps > 0 ? `0 0 15px ${C.green}30` : 'none' },
              ].map((kpi, i) => (
                <div key={kpi.label} className="glass-card" style={{ padding: '16px 18px', animation: `slideUp 0.3s ease ${i * 60}ms both` }}>
                  <div style={{ fontSize: 10, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 6 }}>{kpi.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: kpi.color, textShadow: kpi.glow }}>{kpi.value}</div>
                </div>
              ))}
            </div>

            {/* Action Bar + Activity Log */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Quick Actions */}
              <div className="glass-card" style={{ padding: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.15em', color: C.text, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 3, height: 12, background: C.purpleDark, borderRadius: 2 }} />
                  QUICK ACTIONS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button className="op-btn" onClick={() => runScan()} disabled={scanning}
                    style={{ width: '100%', justifyContent: 'center', padding: '12px', animation: scanning ? 'scanPulse 1.5s infinite' : 'none' }}>
                    {scanning ? '⏳ SCANNING ALL DIVISIONS...' : '🔍 FULL MARKET SCAN'}
                  </button>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button className="op-btn op-btn-green" onClick={() => runScan('CRYPTO')} disabled={!!scanningDiv}>
                      {scanningDiv === 'CRYPTO' ? '⏳...' : '₿ SCAN CRYPTO'}
                    </button>
                    <button className="op-btn op-btn-green" onClick={() => runScan('TRENDING')} disabled={!!scanningDiv}>
                      {scanningDiv === 'TRENDING' ? '⏳...' : '🔥 SCAN TRENDING'}
                    </button>
                    <button className="op-btn op-btn-blue" onClick={() => runScan('POLITICS')} disabled={!!scanningDiv}>
                      {scanningDiv === 'POLITICS' ? '⏳...' : '🏛️ SCAN POLITICS'}
                    </button>
                    <button className="op-btn op-btn-blue" onClick={() => { fetchMarkets(selectedDivision); setActiveTab('markets'); }} disabled={loadingMarkets}>
                      📊 BROWSE MARKETS
                    </button>
                  </div>
                  <button className="op-btn" onClick={runHealthCheck} style={{ width: '100%', justifyContent: 'center' }}>
                    🩺 FULL HEALTH CHECK
                  </button>
                </div>
              </div>

              {/* Activity Log */}
              <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.15em', color: C.text, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 3, height: 12, background: C.green, borderRadius: 2 }} />
                    ACTIVITY LOG
                  </div>
                  <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{logs.length} entries</span>
                </div>
                <div ref={logRef} style={{ flex: 1, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, paddingRight: 4 }}>
                  {logs.length === 0 ? (
                    <div style={{ color: C.muted, fontSize: 11, textAlign: 'center', padding: 30, fontWeight: 600 }}>No activity yet. Run a scan!</div>
                  ) : (
                    logs.map((l, i) => (
                      <div key={i} className="log-line" style={{
                        background: l.type === 'error' ? 'rgba(255,61,87,0.08)' : l.type === 'success' ? 'rgba(0,230,118,0.06)' : 'rgba(255,255,255,0.02)',
                        color: l.type === 'error' ? C.red : l.type === 'success' ? C.green : l.type === 'warn' ? C.yellow : C.mutedLight,
                        animation: i === 0 ? 'slideUp 0.2s ease' : 'none',
                      }}>
                        <span style={{ opacity: 0.5 }}>{new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        {' '}{l.type === 'error' ? '✗' : l.type === 'success' ? '✓' : l.type === 'scan' ? '⟳' : '·'} {l.msg}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Division Overview Grid */}
            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.15em', color: C.text, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 3, height: 12, background: C.yellow, borderRadius: 2 }} />
                DIVISIONS ({(status as Record<string, unknown>)?.divisions as number || 16})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {DIVISIONS.map(div => {
                  const divGlads = gladiators.filter(g => g.division === div);
                  const liveCount = divGlads.filter(g => g.isLive).length;
                  const scanData = scans.find(s => s.division === div);
                  return (
                    <div key={div} onClick={() => { setSelectedDivision(div); runScan(div); }}
                      style={{
                        background: selectedDivision === div ? 'rgba(139,92,246,0.15)' : 'rgba(12,15,26,0.4)',
                        border: `1px solid ${selectedDivision === div ? C.purpleDark + '50' : 'rgba(255,255,255,0.03)'}`,
                        borderRadius: 10, padding: '12px', cursor: 'pointer', transition: 'all 0.2s',
                        position: 'relative', overflow: 'hidden'
                      }}>
                      {scanData && scanData.opportunities.length > 0 && (
                        <div style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: C.green, boxShadow: `0 0 8px ${C.green}`, animation: 'pulseGlow 2s infinite' }} />
                      )}
                      <div style={{ fontSize: 11, fontWeight: 700, color: selectedDivision === div ? C.purple : C.text, marginBottom: 6 }}>{div}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted }}>
                        <span>{liveCount > 0 ? `${liveCount} live` : `${divGlads.length} glads`}</span>
                        {scanData && <span style={{ color: C.green }}>{scanData.opportunities.length} opps</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ════════════════ SCANNER TAB ════════════════ */}
        {activeTab === 'scanner' && (
          <>
            {/* Scanner Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.mutedLight, letterSpacing: '0.12em' }}>MARKET SCANNER</span>
              <HelpTooltip section={POLY_HELP.scanner} position="left" />
            </div>
            {/* Division Selector */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DIVISIONS.map(div => (
                <button key={div} className={`division-chip ${selectedDivision === div ? 'active' : ''}`}
                  onClick={() => setSelectedDivision(div)}>
                  {div}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="op-btn" onClick={() => runScan(selectedDivision)} disabled={scanning || !!scanningDiv}
                style={{ animation: (scanning || scanningDiv === selectedDivision) ? 'scanPulse 1.5s infinite' : 'none' }}>
                {scanningDiv === selectedDivision || scanning ? `⏳ SCANNING ${selectedDivision}...` : `🔍 SCAN ${selectedDivision}`}
              </button>
              <button className="op-btn" onClick={() => runScan()} disabled={scanning}>
                {scanning ? '⏳ FULL SCAN...' : '🌐 SCAN ALL'}
              </button>
            </div>

            {scans.length === 0 && !scanning && (
              <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                <div style={{ color: C.mutedLight, fontWeight: 600 }}>No scans yet. Select a division and hit scan.</div>
              </div>
            )}

            {scans.map((scan, i) => (
              <div key={i} className="glass-card" style={{ padding: 20, animation: `slideUp 0.3s ease ${i * 80}ms both` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 3, height: 12, background: C.purpleDark, borderRadius: 2 }} />
                    <span style={{ fontSize: 14, fontWeight: 800, color: C.purple }}>{scan.division}</span>
                    {scan.topPick && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(0,230,118,0.12)', color: C.green, fontWeight: 700 }}>TOP PICK</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ color: C.muted, fontSize: 12 }}>{scan.totalMarkets} mkts</span>
                    <span style={{ color: scan.opportunities.length > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 700 }}>
                      {scan.opportunities.length} opps
                    </span>
                    <button className="op-btn" onClick={() => runScan(scan.division)} disabled={!!scanningDiv}
                      style={{ fontSize: 10, padding: '4px 10px' }}>↻</button>
                  </div>
                </div>

                {scan.opportunities.length === 0 ? (
                  <div style={{ color: C.muted, fontSize: 13, padding: '16px 0', textAlign: 'center' }}>No opportunities above threshold.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {scan.opportunities.slice(0, 8).map((opp, j) => (
                      <div key={j} style={{
                        background: 'rgba(12,15,26,0.5)', borderRadius: 10, padding: '12px 16px',
                        borderLeft: `3px solid ${edgeColor(opp.edgeScore)}`,
                        display: 'flex', flexDirection: 'column', gap: 8,
                        animation: `slideUp 0.2s ease ${j * 40}ms both`
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: 13, color: C.text, fontWeight: 600, flex: 1, marginRight: 12 }}>{opp.market?.title?.slice(0, 100)}</div>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                            background: `${riskColor(opp.riskLevel)}15`, color: riskColor(opp.riskLevel),
                            border: `1px solid ${riskColor(opp.riskLevel)}30`, whiteSpace: 'nowrap' }}>
                            {opp.riskLevel} RISK
                          </span>
                        </div>

                        {/* Outcomes */}
                        {opp.market?.outcomes && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            {opp.market.outcomes.map((o, k) => (
                              <div key={k} style={{ flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '6px 10px', display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 11, color: C.mutedLight }}>{o.name}</span>
                                <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 800, color: C.text }}>{(o.price * 100).toFixed(0)}¢</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: C.mutedLight }}>
                          <span>Edge: <b style={{ color: edgeColor(opp.edgeScore), fontFamily: 'monospace' }}>{opp.edgeScore}</b></span>
                          <span>Mispricing: <b style={{ fontFamily: 'monospace' }}>{opp.mispricingScore}</b></span>
                          <span>Momentum: <b style={{ fontFamily: 'monospace' }}>{opp.momentumScore}</b></span>
                          <span style={{ marginLeft: 'auto', color: C.purple, fontWeight: 700 }}>→ {opp.recommendation}</span>
                        </div>

                        {opp.reasoning && (
                          <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 6 }}>
                            {opp.reasoning.slice(0, 150)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* ════════════════ GLADIATORS TAB ════════════════ */}
        {activeTab === 'gladiators' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.mutedLight, letterSpacing: '0.12em' }}>POLY GLADIATORS</span>
              <HelpTooltip section={POLY_HELP.gladiators} position="left" />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {(['all', 'live', 'training'] as const).map(f => (
                <button key={f} className={`division-chip ${gladFilter === f ? 'active' : ''}`}
                  onClick={() => setGladFilter(f)}>
                  {f === 'all' ? `ALL (${gladiators.length})` : f === 'live' ? `LIVE (${liveGlads})` : `TRAINING (${trainingGlads})`}
                </button>
              ))}
              <div style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>
                Avg Readiness: <b style={{ color: C.purple, fontFamily: 'monospace' }}>
                  {gladiators.length > 0 ? (gladiators.reduce((a, g) => a + g.readinessScore, 0) / gladiators.length).toFixed(0) : 0}
                </b>
              </div>
            </div>

            {filteredGlads.length === 0 ? (
              <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ color: C.mutedLight }}>No gladiators match filter.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredGlads.map((g, i) => {
                  const ss = statusStyle(g.status);
                  const readColor = g.readinessScore >= 70 ? C.green : g.readinessScore >= 40 ? C.yellow : C.red;
                  return (
                    <div key={g.id} className="glass-card" style={{
                      padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
                      borderLeft: `3px solid ${ss.color}`, animation: `slideUp 0.2s ease ${i * 30}ms both`
                    }}>
                      {/* Rank */}
                      <div style={{ minWidth: 28, fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: C.muted }}>#{i + 1}</div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{g.division}</span>
                          <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                            color: ss.color, background: ss.bg, border: `1px solid ${ss.border}` }}>
                            {g.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: C.muted }}>{g.name}</div>
                      </div>

                      {/* Readiness Gauge */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70, gap: 4 }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.08em' }}>READINESS</div>
                        <div style={{ width: 50, height: 50, borderRadius: '50%', border: `3px solid ${readColor}30`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
                          background: `conic-gradient(${readColor} ${g.readinessScore * 3.6}deg, transparent 0deg)` }}>
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(18,22,38,0.9)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: readColor }}>{g.readinessScore}</span>
                          </div>
                        </div>
                      </div>

                      {/* Stats */}
                      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                        <div style={{ textAlign: 'center', minWidth: 55 }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>WIN RATE</div>
                          <div style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 800,
                            color: parseFloat(g.winRate) >= 55 ? C.green : parseFloat(g.winRate) >= 45 ? C.yellow : C.red }}>
                            {parseFloat(g.winRate).toFixed(1)}%
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 45 }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>BETS</div>
                          <div style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 800, color: C.text }}>{g.totalBets}</div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 45 }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>PHANTOM</div>
                          <div style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 800, color: C.blue }}>{g.phantomBets}</div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 55 }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>EDGE</div>
                          <div style={{ fontSize: 15, fontFamily: 'monospace', fontWeight: 800,
                            color: parseFloat(g.cumulativeEdge) > 0 ? C.green : C.red }}>
                            {parseFloat(g.cumulativeEdge) > 0 ? '+' : ''}{g.cumulativeEdge}
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: 50 }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>EXPERTISE</div>
                          <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${g.divisionExpertise}%`, background: C.purple, borderRadius: 2 }} />
                          </div>
                          <div style={{ fontSize: 10, fontFamily: 'monospace', color: C.mutedLight, marginTop: 2 }}>{g.divisionExpertise}%</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ════════════════ MARKETS TAB ════════════════ */}
        {activeTab === 'markets' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.mutedLight, letterSpacing: '0.12em' }}>MARKETS BROWSER</span>
              <HelpTooltip section={POLY_HELP.markets} position="left" />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {['TRENDING', 'CRYPTO', 'POLITICS', 'SPORTS', 'FINANCE', 'TECH', 'ELECTIONS', 'GEOPOLITICS'].map(div => (
                <button key={div} className={`division-chip ${selectedDivision === div ? 'active' : ''}`}
                  onClick={() => { setSelectedDivision(div); fetchMarkets(div); }}>
                  {div}
                </button>
              ))}
              <button className="op-btn" onClick={() => fetchMarkets(selectedDivision)} disabled={loadingMarkets}
                style={{ marginLeft: 'auto', fontSize: 10, padding: '5px 12px' }}>
                {loadingMarkets ? '⏳ LOADING...' : `↻ REFRESH ${selectedDivision}`}
              </button>
            </div>

            {markets.length === 0 && !loadingMarkets && (
              <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📊</div>
                <div style={{ color: C.mutedLight, fontWeight: 600, marginBottom: 12 }}>Select a division and load markets</div>
                <button className="op-btn" onClick={() => fetchMarkets(selectedDivision)} style={{ margin: '0 auto' }}>
                  📊 LOAD {selectedDivision} MARKETS
                </button>
              </div>
            )}

            {loadingMarkets && (
              <div className="glass-card" style={{ padding: 30, textAlign: 'center' }}>
                <div style={{ color: C.purple, fontWeight: 700, animation: 'blink 1s infinite' }}>Loading markets...</div>
              </div>
            )}

            {!loadingMarkets && markets.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {markets.map((m, i) => (
                  <div key={m.id || i} className="glass-card" style={{
                    padding: '16px 20px', animation: `slideUp 0.2s ease ${i * 30}ms both`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, flex: 1 }}>{m.title}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
                        background: m.active ? 'rgba(0,230,118,0.1)' : 'rgba(255,61,87,0.1)',
                        color: m.active ? C.green : C.red }}>
                        {m.active ? 'ACTIVE' : 'CLOSED'}
                      </span>
                    </div>

                    {/* Outcome Bars */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      {m.outcomes?.map((o, j) => {
                        const pct = (o.price * 100);
                        const isYes = o.name.toLowerCase().includes('yes');
                        const barColor = isYes ? C.green : C.red;
                        return (
                          <div key={j} style={{ flex: 1, background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 12px', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`, background: `${barColor}15`, borderRadius: 8 }} />
                            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{o.name}</span>
                              <span style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 800, color: barColor }}>{pct.toFixed(0)}¢</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: 'flex', gap: 20, fontSize: 11, color: C.muted }}>
                      {m.volume24h > 0 && <span>Vol 24h: <b style={{ color: C.text, fontFamily: 'monospace' }}>${m.volume24h.toLocaleString()}</b></span>}
                      {m.liquidityUSD > 0 && <span>Liquidity: <b style={{ color: C.text, fontFamily: 'monospace' }}>${m.liquidityUSD.toLocaleString()}</b></span>}
                      {m.endDate && <span>Ends: <b style={{ color: C.mutedLight }}>{new Date(m.endDate).toLocaleDateString()}</b></span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ════════════════ WALLET TAB ════════════════ */}
        {activeTab === 'wallet' && wallet && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.mutedLight, letterSpacing: '0.12em' }}>PAPER WALLET</span>
              <HelpTooltip section={POLY_HELP.wallet} position="left" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {[
                { label: 'TOTAL BALANCE', value: `$${wallet.totalBalance.toLocaleString()}`, color: C.purple },
                { label: 'TOTAL INVESTED', value: `$${wallet.totalInvested.toLocaleString()}`, color: C.blue },
                { label: 'REALIZED P&L', value: `${wallet.realizedPnL >= 0 ? '+' : ''}$${wallet.realizedPnL.toFixed(2)}`, color: wallet.realizedPnL >= 0 ? C.green : C.red },
                { label: 'UNREALIZED P&L', value: `${wallet.unrealizedPnL >= 0 ? '+' : ''}$${wallet.unrealizedPnL.toFixed(2)}`, color: wallet.unrealizedPnL >= 0 ? C.green : C.red },
                { label: 'ROI', value: `${wallet.roi >= 0 ? '+' : ''}${wallet.roi.toFixed(2)}%`, color: wallet.roi >= 0 ? C.green : C.red },
                { label: 'POSITIONS', value: String(wallet.positionCount), color: C.yellow },
              ].map((kpi, i) => (
                <div key={kpi.label} className="glass-card" style={{ padding: '16px 18px', animation: `slideUp 0.3s ease ${i * 50}ms both` }}>
                  <div style={{ fontSize: 10, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 6 }}>{kpi.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: kpi.color }}>{kpi.value}</div>
                </div>
              ))}
            </div>

            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.15em', color: C.text, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 3, height: 12, background: C.purple, borderRadius: 2 }} />
                DIVISION ALLOCATIONS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(wallet.divisionStats || []).map((d, i) => {
                  const pnlColor = d.realizedPnL >= 0 ? C.green : C.red;
                  const balPct = wallet.totalBalance > 0 ? (d.balance / wallet.totalBalance * 100) : 0;
                  return (
                    <div key={d.division} style={{
                      background: 'rgba(12,15,26,0.4)', borderRadius: 10, padding: '12px 16px',
                      border: '1px solid rgba(255,255,255,0.03)', position: 'relative', overflow: 'hidden',
                      animation: `slideUp 0.2s ease ${i * 30}ms both`
                    }}>
                      {/* Background allocation bar */}
                      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${balPct}%`, background: `${C.purple}08` }} />

                      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{d.division}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 20, fontSize: 12, color: C.mutedLight, fontFamily: 'monospace' }}>
                          <span>Bal: <b style={{ color: C.text }}>${d.balance.toFixed(0)}</b></span>
                          <span>Inv: <b>${d.invested.toFixed(0)}</b></span>
                          <span style={{ color: pnlColor }}>P&L: {d.realizedPnL >= 0 ? '+' : ''}${d.realizedPnL.toFixed(2)}</span>
                          <span>Pos: {d.positionCount}</span>
                          <span style={{ color: d.maxDrawdown > 10 ? C.red : C.muted }}>DD: {d.maxDrawdown.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ─── ADDITIVE: Intelligence Panel (Phase 2 Batch 4) ─── */}
        <IntelligencePanel defaultSector="POLYMARKET" title="Polymarket Intelligence" />

      </div>

      <BottomNav />
    </div>
  );
}
