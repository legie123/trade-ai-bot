'use client';

import { useState, useEffect, useCallback } from 'react';
import { useBotStats } from '@/hooks/useBotStats';
import BottomNav from '@/components/BottomNav';

interface Signal {
  symbol: string;
  direction: string;
  confidence: number;
  timestamp: string;
}

interface TokenRow {
  symbol: string;
  name: string;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  chain: string;
  exchange: string;
}

interface BTCData {
  price: number;
  ema50: number;
  ema200: number;
  ema800: number;
  dailyOpen: number;
  signals: { signal: string; reason: string }[];
}

interface CombatAudit {
  id: string;
  timestamp: string;
  finalDirection?: string;
  weightedConfidence?: number;
  opinions?: { seat: string; direction: string; confidence: number; reasoning: string }[];
}

const C = {
  text: '#e8ecf4',
  muted: '#6b7891',
  mutedLight: '#9aa5be',
  green: '#00e676',
  red: '#ff3d57',
  blue: '#29b6f6',
  yellow: '#ffd740',
  borderLight: '#242d44',
  border: '#1a2035',
};

function directionColor(d: string) {
  if (!d) return C.blue;
  const up = ['BUY', 'LONG'];
  const down = ['SELL', 'SHORT'];
  if (up.includes(d.toUpperCase())) return C.green;
  if (down.includes(d.toUpperCase())) return C.red;
  return C.blue;
}

function directionBg(d: string) {
  if (!d) return 'rgba(41,182,246,0.15)';
  const up = ['BUY', 'LONG'];
  const down = ['SELL', 'SHORT'];
  if (up.includes(d.toUpperCase())) return 'rgba(0,230,118,0.15)';
  if (down.includes(d.toUpperCase())) return 'rgba(255,61,87,0.15)';
  return 'rgba(41,182,246,0.15)';
}

function formatNum(n: number): string {
  if (!isFinite(n)) return '—';
  if (n < 0.001) return n.toExponential(2);
  if (n < 1) return n.toFixed(6);
  if (n < 1000) return n.toFixed(2);
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

export default function CryptoRadarPage() {
  const { stats: botStats } = useBotStats(15_000);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [btcData, setBtcData] = useState<BTCData | null>(null);
  const [combatAudits, setCombatAudits] = useState<CombatAudit[]>([]);
  const [lastSync, setLastSync] = useState<string>('—');
  const [syncing, setSyncing] = useState(true);
  const [tokenSearch, setTokenSearch] = useState('');
  const [tokenChainFilter, setTokenChainFilter] = useState('');
  const [sortCol, setSortCol] = useState<'change24h' | 'volume24h' | 'price'>('change24h');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchMain = useCallback(async () => {
    try {
      const [signalsRes, btcRes, botRes] = await Promise.all([
        fetch('/api/tradingview', { signal: AbortSignal.timeout(8000) }).catch(() => null),
        fetch('/api/btc-signals', { signal: AbortSignal.timeout(8000) }).catch(() => null),
        fetch('/api/bot', { signal: AbortSignal.timeout(8000) }).catch(() => null),
      ]);
      if (signalsRes?.ok) {
        const d = await signalsRes.json();
        setSignals((d.signals || []).slice(0, 20));
      }
      if (btcRes?.ok) {
        const d = await btcRes.json();
        if (d.btc) setBtcData({ ...d.btc, signals: d.signals || [] });
      }
      if (botRes?.ok) {
        const d = await botRes.json();
        if (d.syndicateAudits) setCombatAudits(d.syndicateAudits.slice(0, 5));
      }
    } catch { /* silent */ }
  }, []);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/tokens', { signal: AbortSignal.timeout(12000) }).catch(() => null);
      if (res?.ok) {
        const d = await res.json();
        setTokens((d.tokens || []).map((t: Record<string, unknown>) => ({
          symbol: (t.symbol as string) || '?',
          name: (t.name as string) || '',
          price: t.price as number | null,
          change24h: t.priceChange1h as number | null,
          volume24h: t.volume24h as number | null,
          marketCap: t.marketCap as number | null,
          chain: (t.chain as string) || 'solana',
          exchange: (t.dexName as string) || '—',
        })));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    const load = async () => {
      setSyncing(true);
      await fetchMain();
      await fetchTokens();
      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setSyncing(false);
    };
    load();
    const m = setInterval(() => {
      fetchMain();
      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 15_000);
    const t = setInterval(fetchTokens, 60_000);
    return () => { clearInterval(m); clearInterval(t); };
  }, [fetchMain, fetchTokens]);

  const latestAudit = combatAudits[0];
  const conf = latestAudit?.weightedConfidence ?? 0;

  const filteredTokens = tokens
    .filter(t => {
      if (tokenSearch && !t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) &&
          !t.name.toLowerCase().includes(tokenSearch.toLowerCase())) return false;
      if (tokenChainFilter && t.chain.toLowerCase() !== tokenChainFilter.toLowerCase()) return false;
      return true;
    })
    .sort((a, b) => {
      const aVal = a[sortCol] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const bVal = b[sortCol] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      return sortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #151a2d, #050609)', color: C.text, paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Outfit", "Inter", sans-serif' }}>
      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap');
        
        @keyframes pulseGlow { 0%,100%{opacity:1; transform: scale(1)} 50%{opacity:.6; transform: scale(1.02)} }
        @keyframes slideUpFade { from{opacity:0; transform:translateY(15px)} to{opacity:1; transform:translateY(0)} }
        @keyframes radarScan { 0% { transform: rotate(0deg); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: rotate(360deg); opacity: 0; } }
        
        .glass-card {
          background: rgba(18, 22, 38, 0.55);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.04);
          border-radius: 16px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
          transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s ease;
        }
        .glass-card:hover {
          border-color: rgba(255,255,255,0.1);
          box-shadow: 0 12px 48px 0 rgba(0, 0, 0, 0.35);
        }
        
        .token-card {
          background: rgba(12, 15, 26, 0.45);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.03);
          border-radius: 12px;
          padding: 14px;
          transition: transform 0.2s ease, border-color 0.2s ease;
        }
        .token-card:hover {
          transform: translateY(-3px);
          border-color: rgba(41,182,246,0.3);
          background: rgba(15, 18, 32, 0.7);
        }
        
        input::placeholder { color: ${C.muted}; font-family: 'Outfit', sans-serif; }
        input:focus, select:focus { outline: none; border-color: ${C.blue} !important; }
      `}</style>

      {/* ── TOP HEADER ──────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(5, 6, 9, 0.8)',
        backdropFilter: 'blur(20px)', borderBottom: `1px solid rgba(255,255,255,0.05)`, padding: '14px 24px',
        display: 'flex', alignItems: 'center', gap: 20 }}>

        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.15em', color: C.text, textShadow: '0 0 10px rgba(255,255,255,0.2)' }}>
          RADAR<span style={{ color: C.blue }}>.AI</span>
        </span>

        {btcData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(255,255,255,0.03)', padding: '6px 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700 }}>
              BTC <span style={{ color: btcData.price >= btcData.dailyOpen ? C.green : C.red, textShadow: `0 0 10px \${btcData.price >= btcData.dailyOpen ? C.green : C.red}80` }}>${formatNum(btcData.price)}</span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {btcData.signals.slice(0, 2).map((sig, i) => (
                <span key={i} style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                  background: directionBg(sig.signal), color: directionColor(sig.signal),
                  border: `1px solid \${directionColor(sig.signal)}40`,
                }}>{sig.signal}</span>
              ))}
            </div>
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)' }} />
            <span style={{ fontSize: 11, color: btcData.price >= btcData.ema200 ? C.green : C.red, fontWeight: 600 }}>
               {btcData.price >= btcData.ema200 ? '▲ > EMA200' : '▼ < EMA200'}
            </span>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: 8 }}>
            <span style={{ fontSize: 11, color: C.mutedLight, fontWeight: 600, letterSpacing: '0.05em' }}>
              {syncing ? 'UPDATING...' : `\${lastSync}`}
            </span>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: syncing ? C.yellow : C.blue,
              boxShadow: `0 0 10px \${syncing ? C.yellow : C.blue}`,
              animation: 'pulseGlow 2s infinite',
            }} />
          </div>
          <button onClick={() => fetchMain()} style={{
            padding: '8px 16px', background: 'rgba(41,182,246,0.1)',
            border: `1px solid rgba(41,182,246,0.3)`, borderRadius: 8,
            color: C.blue, cursor: 'pointer', fontSize: 12, fontWeight: 700,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(41,182,246,0.2)'; e.currentTarget.style.boxShadow = '0 0 15px rgba(41,182,246,0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(41,182,246,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
          >↻ SYNC</button>
        </div>
      </div>

      <div style={{ padding: '24px', maxWidth: 1600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* ── KPI ROW ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {[
            { label: 'TOTAL EQUITY', value: `\$\${formatNum(botStats.equity || 0)}`, color: '#fff', glow: 'none' },
            {
              label: 'DAILY ALPHA (PnL)', color: (botStats.todayPnlPercent || 0) >= 0 ? C.green : C.red,
              glow: (botStats.todayPnlPercent || 0) >= 0 ? `0 0 20px \${C.green}40` : `0 0 20px \${C.red}40`,
              value: `\${(botStats.todayPnlPercent || 0) >= 0 ? '+' : ''}\${(botStats.todayPnlPercent || 0).toFixed(2)}%`,
            },
            { label: 'GLOBAL WIN RATE', value: `\${(botStats.overallWinRate || 0).toFixed(1)}%`, color: C.blue, glow: `0 0 15px \${C.blue}30` },
            { label: 'MAX STRESS (DD)', value: `\${(botStats.maxDrawdown || 0).toFixed(2)}%`, color: C.red, glow: 'none' },
          ].map((kpi, idx) => (
            <div key={kpi.label} className="glass-card" style={{ padding: '20px 24px', animation: `slideUpFade 0.4s ease \${idx * 100}ms both` }}>
              <div style={{ fontSize: 11, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.15em', marginBottom: 8 }}>
                {kpi.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'monospace', color: kpi.color, textShadow: kpi.glow }}>
                {kpi.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── MAINFRAME GRID ─────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 1fr) 1fr', gap: 24 }}>
          
          {/* SYNDICATE CONSENSUS */}
          <div className="glass-card" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, background: `radial-gradient(circle, \${C.blue}20, transparent 70%)`, filter: 'blur(30px)', zIndex: 0 }} />
            
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: C.text, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 4, height: 14, background: C.blue, borderRadius: 2 }} />
                SYNDICATE RADAR
              </div>
              
              {latestAudit ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
                  <div style={{ position: 'relative', width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {/* Radar swept background */}
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1px solid \${C.borderLight}` }} />
                    <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', border: `1px dashed \${C.border}` }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(from 0deg, transparent 70%, \${directionColor(latestAudit.finalDirection || '')}60 100%)`, animation: 'radarScan 4s linear infinite' }} />
                    
                    {/* Center Core */}
                    <div style={{ zIndex: 2, background: 'rgba(12, 15, 26, 0.8)', backdropFilter: 'blur(10px)', borderRadius: '50%', width: 100, height: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: `2px solid \${directionColor(latestAudit.finalDirection || '')}`, boxShadow: `0 0 20px \${directionColor(latestAudit.finalDirection || '')}50` }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: directionColor(latestAudit.finalDirection || ''), letterSpacing: '0.05em' }}>
                          {latestAudit.finalDirection || 'IDLE'}
                        </div>
                        <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 800, color: C.text }}>
                          {conf.toFixed(0)}%
                        </div>
                    </div>
                  </div>

                  <div style={{ width: '100%', background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 10, color: C.mutedLight, letterSpacing: '0.1em', fontWeight: 700, marginBottom: 4 }}>NODE OPINIONS (T-0)</div>
                    {latestAudit.opinions && latestAudit.opinions.slice(0, 4).map(op => (
                      <div key={op.seat} style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{op.seat}</div>
                          <div style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{op.reasoning || "Technical consensus aligned."}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: directionColor(op.direction), background: directionBg(op.direction), padding: '2px 8px', borderRadius: 4, letterSpacing: '0.05em' }}>
                            {op.direction}
                          </span>
                          <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.mutedLight, fontWeight: 600 }}>{op.confidence.toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontWeight: 600, letterSpacing: '0.1em' }}>
                  AWAITING VECTORS...
                </div>
              )}
            </div>
          </div>

          {/* ACTIVE TARGETS FEED */}
          <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: C.text, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 4, height: 14, background: C.green, borderRadius: 2 }} />
                ACTIVE TARGETS
              </div>
              <span style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: 12, fontSize: 11, color: C.mutedLight }}>
                {signals.length} SPOTTED
              </span>
            </div>

            {signals.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12, fontWeight: 600 }}>NO HIGH-CONVICTION SIGNALS DETECTED</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                {signals.map((sig, i) => (
                  <div key={i} className="token-card" style={{ animation: `slideUpFade 0.3s ease \${i * 40}ms both` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '0.02em' }}>{sig.symbol}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: directionColor(sig.direction), background: directionBg(sig.direction), padding: '3px 8px', borderRadius: 6, letterSpacing: '0.05em' }}>
                        {sig.direction}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                      <div style={{ fontSize: 10, color: C.mutedLight, fontWeight: 600, letterSpacing: '0.05em' }}>CONFIDENCE</div>
                      <div style={{ fontSize: 16, fontFamily: 'monospace', fontWeight: 800, color: sig.confidence > 75 ? C.green : C.yellow }}>
                        {sig.confidence.toFixed(1)}%
                      </div>
                    </div>
                    {/* Mini progress bar inside card */}
                    <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                       <div style={{ height: '100%', width: `\${sig.confidence}%`, background: directionColor(sig.direction), borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── TOKEN HEATGRID (Replaces generic table) ──────── */}
        <div className="glass-card" style={{ padding: '24px' }}>
           <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 4, height: 14, background: C.yellow, borderRadius: 2 }} />
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: C.text }}>
                MARKET HEATGRID
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <input type="text" placeholder="Filter symbol..." value={tokenSearch} onChange={e => setTokenSearch(e.target.value)}
                style={{ width: 160, padding: '8px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: C.text, fontSize: 12, fontWeight: 600 }}
              />
              <select value={tokenChainFilter} onChange={e => setTokenChainFilter(e.target.value)}
                style={{ padding: '8px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: C.text, fontSize: 12, fontWeight: 600 }}>
                <option value="">ALL CHAINS</option>
                <option value="solana">SOLANA</option>
                <option value="ethereum">ETHEREUM</option>
              </select>
            </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, maxHeight: 500, overflowY: 'auto' }}>
             {filteredTokens.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: C.muted, fontWeight: 600, letterSpacing: '0.1em' }}>NO TARGETS FOUND</div>
             ) : (
                filteredTokens.slice(0, 50).map((t, i) => {
                  const isUp = t.change24h !== null && t.change24h >= 0;
                  return (
                    <div key={i} className="token-card" style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: `slideUpFade 0.3s ease \${i * 15}ms both` }}>
                      {/* Token Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                           <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.02em', color: C.text }}>{t.symbol}</div>
                           <div style={{ fontSize: 10, color: C.mutedLight, fontWeight: 600 }}>{t.name?.slice(0, 20)}</div>
                        </div>
                        <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>
                          {t.chain}
                        </div>
                      </div>
                      
                      {/* Price & Metrics */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.1em' }}>PRICE</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700 }}>{t.price !== null ? `$\${formatNum(t.price)}` : '—'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                           <span style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.1em' }}>1H MOVE</span>
                           <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: isUp ? C.green : C.red }}>
                             {t.change24h !== null ? `\${isUp ? '+' : ''}\${t.change24h.toFixed(2)}%` : '—'}
                           </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <span style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.1em' }}>VOL 24H</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600, color: C.text }}>{t.volume24h !== null ? `$\${formatCompact(t.volume24h)}` : '—'}</span>
                        </div>
                      </div>
                    </div>
                  )
                })
             )}
          </div>
        </div>

      </div>

      <BottomNav />
    </div>
  );
}
