'use client';

import { useState, useEffect, useCallback } from 'react';
import { useBotStats } from '@/hooks/useBotStats';
import BottomNav from '@/components/BottomNav';
import HelpTooltip from '@/components/HelpTooltip';

const HELP = {
  kpi: {
    title: 'KPI Dashboard',
    description: 'Indicatorii cheie de performanță ai botului în timp real.',
    details: [
      'Total Equity — capitalul total gestionat de bot (USDT)',
      'Daily Alpha (PnL) — profitul/pierderea din ziua curentă în procente',
      'Global Win Rate — procentul tranzacțiilor câștigătoare din toate timpurile',
      'Max Stress (DD) — drawdown-ul maxim istoric (risc maxim atins)',
    ],
    tip: 'Win Rate >55% + Profit Factor >1.3 = strategie profitabilă pe termen lung.',
  },
  syndicateRadar: {
    title: 'Syndicate Radar',
    description: 'Consensul AI al Sindicatului — mai mulți agenți analizează piața independent și votează direcția.',
    details: [
      'Fiecare "nod" este un agent AI cu specializare diferită (TA, sentiment, on-chain)',
      'Săgeata centrală = direcția majoritară (BUY/SELL/NEUTRAL)',
      'Procentul = nivelul de încredere agregat al consensului',
      'Animația radar se rotește continuu = sistem activ',
    ],
    tip: 'Confidence >75% + toți nodurile în aceeași direcție = semnal puternic.',
  },
  activeTargets: {
    title: 'Active Targets',
    description: 'Semnalele active primite de la TradingView sau generate intern prin analiza tehnică.',
    details: [
      'BULLISH/BEARISH = direcția semnalului detectat',
      'Confidence = încrederea algoritmului în semnal (0-100%)',
      'Click pe un target = detalii complete + raționamentul AI',
      'Semnalele sunt filtrate automat — duplicatele sunt eliminate',
    ],
    tip: 'Semnalele cu confidence 100% provin din pattern-uri clare (breakout, EMA cross). Verifică întotdeauna contextul pieței.',
  },
  heatgrid: {
    title: 'Token Heatgrid',
    description: 'Grid cu tokenii meme și DeFi cei mai activi în timp real, agregați din DexScreener, Pump.fun și alte surse.',
    details: [
      '1H MOVE — variația prețului în ultima oră (%)',
      'VOL 24H — volumul de tranzacționare din ultimele 24h',
      'PRICE — prețul curent în USDT',
      'Tokenii sunt sortați după schimbare de preț descrescătoare',
      'CHAIN indică rețeaua blockchain (Solana, ETH, BSC)',
    ],
    tip: 'Volum mare + mișcare mare 1H = momentum puternic. Verifică lichiditatea înainte de intrare.',
  },
  btcPanel: {
    title: 'BTC Analysis Panel',
    description: 'Analiza tehnică BTC în timp real: preț live, EMA-uri, semnale și niveluri cheie.',
    details: [
      'EMA 50/200/800 — medii mobile exponențiale pentru trend scurt/mediu/lung',
      '▲ > EMA200 = BTC în uptrend pe termen mediu',
      'NEUTRAL/BULLISH/BEARISH = concluzia analizei tehnice agregate',
      'Date preluate din MEXC + CryptoCompare (redundanță automată)',
    ],
    tip: 'Când BTC este BEARISH, riscul pentru alți tokeni crește semnificativ. Reduceți expunerea.',
  },
} as const;

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
  change1h: number | null;
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
  text: '#eae6f0',
  muted: '#5e576e',
  mutedLight: '#9a93a8',
  green: '#00e676',
  red: '#DC143C',
  blue: '#DAA520',
  yellow: '#FFD700',
  purple: '#B8860B',
  borderLight: '#1e1828',
  border: '#140e20',
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
  if (!d) return 'rgba(218,165,32,0.15)';
  const up = ['BUY', 'LONG'];
  const down = ['SELL', 'SHORT'];
  if (up.includes(d.toUpperCase())) return 'rgba(0,230,118,0.15)';
  if (down.includes(d.toUpperCase())) return 'rgba(255,61,87,0.15)';
  return 'rgba(218,165,32,0.15)';
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
  const [sortCol] = useState<'change1h' | 'volume24h' | 'price'>('change1h');
  const [sortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  const [expandedToken, setExpandedToken] = useState<number | null>(null);
  const [expandedAudit, setExpandedAudit] = useState<number | null>(null);

  const fetchMain = useCallback(async () => {
    try {
      const [signalsRes, btcRes, botRes] = await Promise.all([
        fetch('/api/tradingview', { signal: AbortSignal.timeout(10000) }).catch(() => null),
        fetch('/api/btc-signals', { signal: AbortSignal.timeout(20000) }).catch(() => null),
        fetch('/api/bot', { signal: AbortSignal.timeout(10000) }).catch(() => null),
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
      const res = await fetch('/api/tokens', { signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (res?.ok) {
        const d = await res.json();
        setTokens((d.tokens || []).map((t: Record<string, unknown>) => ({
          symbol: (t.symbol as string) || '?',
          name: (t.name as string) || '',
          price: t.price as number | null,
          // AUDIT FIX T2.9: Field renamed from change24h → change1h to match actual data source (priceChange1h)
          change1h: t.priceChange1h as number | null,
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
    <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #0d0a14, #06040a)', color: C.text, paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Outfit", "Inter", sans-serif' }}>
      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap');
        
        @keyframes pulseGlow { 0%,100%{opacity:1; transform: scale(1)} 50%{opacity:.6; transform: scale(1.02)} }
        @keyframes slideUpFade { from{opacity:0; transform:translateY(15px)} to{opacity:1; transform:translateY(0)} }
        @keyframes radarScan { 0% { transform: rotate(0deg); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: rotate(360deg); opacity: 0; } }
        
        .glass-card {
          background: rgba(12, 8, 18, 0.6);
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
          background: rgba(10, 6, 16, 0.45);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.03);
          border-radius: 12px;
          padding: 14px;
          transition: transform 0.2s ease, border-color 0.2s ease;
        }
        .token-card:hover {
          transform: translateY(-3px);
          border-color: rgba(218,165,32,0.3);
          background: rgba(15, 18, 32, 0.7);
        }
        
        input::placeholder { color: ${C.muted}; font-family: 'Outfit', sans-serif; }
        input:focus, select:focus { outline: none; border-color: ${C.blue} !important; }
      `}</style>

      {/* ── TOP HEADER ──────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(6, 4, 10, 0.8)',
        backdropFilter: 'blur(20px)', borderBottom: `1px solid rgba(255,255,255,0.05)`, padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.15em', color: C.text, textShadow: '0 0 10px rgba(255,255,255,0.2)' }}>
          RADAR<span style={{ color: C.blue }}>.AI</span>
        </span>

        {btcData ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(255,255,255,0.03)', padding: '6px 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700 }}>
              BTC <span style={{ color: btcData.price >= btcData.dailyOpen ? C.green : C.red, textShadow: `0 0 10px ${btcData.price >= btcData.dailyOpen ? C.green : C.red}80` }}>${formatNum(btcData.price)}</span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {btcData.signals.slice(0, 2).map((sig, i) => (
                <span key={i} style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                  background: directionBg(sig.signal), color: directionColor(sig.signal),
                  border: `1px solid ${directionColor(sig.signal)}40`,
                }}>{sig.signal}</span>
              ))}
            </div>
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)' }} />
            <span style={{ fontSize: 11, color: btcData.price >= btcData.ema200 ? C.green : C.red, fontWeight: 600 }}>
               {btcData.price >= btcData.ema200 ? '▲ > EMA200' : '▼ < EMA200'}
            </span>
            <HelpTooltip section={HELP.btcPanel} position="left" size={12} />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)', padding: '6px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.yellow, animation: 'pulseGlow 1.5s infinite' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted, fontWeight: 600 }}>BTC LOADING...</span>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: 8 }}>
            <span style={{ fontSize: 11, color: C.mutedLight, fontWeight: 600, letterSpacing: '0.05em' }}>
              {syncing ? 'UPDATING...' : `${lastSync}`}
            </span>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: syncing ? C.yellow : C.blue,
              boxShadow: `0 0 10px ${syncing ? C.yellow : C.blue}`,
              animation: 'pulseGlow 2s infinite',
            }} />
          </div>
          <button onClick={() => fetchMain()} style={{
            padding: '8px 16px', background: 'rgba(218,165,32,0.1)',
            border: `1px solid rgba(218,165,32,0.3)`, borderRadius: 8,
            color: C.blue, cursor: 'pointer', fontSize: 12, fontWeight: 700,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(218,165,32,0.2)'; e.currentTarget.style.boxShadow = '0 0 15px rgba(218,165,32,0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(218,165,32,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
          >↻ SYNC</button>
        </div>
      </div>

      <div style={{ padding: '24px', maxWidth: 1600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* ── KPI ROW ─────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: C.mutedLight }}>PERFORMANCE METRICS</span>
          <HelpTooltip section={HELP.kpi} position="left" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {[
            { label: 'TOTAL EQUITY', value: `$${formatNum(botStats.equity || 0)}`, color: '#fff', glow: 'none' },
            {
              label: 'DAILY ALPHA (PnL)', color: (botStats.todayPnlPercent || 0) >= 0 ? C.green : C.red,
              glow: (botStats.todayPnlPercent || 0) >= 0 ? `0 0 20px ${C.green}40` : `0 0 20px ${C.red}40`,
              value: `${(botStats.todayPnlPercent || 0) >= 0 ? '+' : ''}${(botStats.todayPnlPercent || 0).toFixed(2)}%`,
            },
            { label: 'GLOBAL WIN RATE', value: `${(botStats.overallWinRate || 0).toFixed(1)}%`, color: C.blue, glow: `0 0 15px ${C.blue}30` },
            { label: 'MAX STRESS (DD)', value: `${(botStats.maxDrawdown || 0).toFixed(2)}%`, color: C.red, glow: 'none' },
          ].map((kpi, idx) => (
            <div key={kpi.label} className="glass-card" style={{ padding: '20px 24px', animation: `slideUpFade 0.4s ease ${idx * 100}ms both` }}>
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
            <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, background: `radial-gradient(circle, ${C.blue}20, transparent 70%)`, filter: 'blur(30px)', zIndex: 0 }} />
            
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.2em', color: C.text, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 4, height: 14, background: C.blue, borderRadius: 2 }} />
                  SYNDICATE RADAR
                </div>
                <HelpTooltip section={HELP.syndicateRadar} position="left" />
              </div>
              
              {latestAudit ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
                  <div style={{ position: 'relative', width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {/* Radar swept background */}
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1px solid ${C.borderLight}` }} />
                    <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', border: `1px dashed ${C.border}` }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(from 0deg, transparent 70%, ${directionColor(latestAudit.finalDirection || '')}60 100%)`, animation: 'radarScan 4s linear infinite' }} />
                    
                    {/* Center Core */}
                    <div style={{ zIndex: 2, background: 'rgba(10, 6, 16, 0.8)', backdropFilter: 'blur(10px)', borderRadius: '50%', width: 100, height: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: `2px solid ${directionColor(latestAudit.finalDirection || '')}`, boxShadow: `0 0 20px ${directionColor(latestAudit.finalDirection || '')}50` }}>
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
                    {latestAudit.opinions && latestAudit.opinions.slice(0, 6).map((op, opIdx) => {
                      const isOpExpanded = expandedAudit === opIdx;
                      return (
                      <div key={op.seat} onClick={(e) => { e.stopPropagation(); setExpandedAudit(isOpExpanded ? null : opIdx); }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer',
                          background: isOpExpanded ? 'rgba(218,165,32,0.05)' : 'transparent', borderRadius: isOpExpanded ? 8 : 0, padding: isOpExpanded ? 8 : '0 0 8px 0', transition: 'all 0.2s ease' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{op.seat}</div>
                            {!isOpExpanded && (
                              <div style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{op.reasoning || "Technical consensus aligned."}</div>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: directionColor(op.direction), background: directionBg(op.direction), padding: '2px 8px', borderRadius: 4, letterSpacing: '0.05em' }}>
                              {op.direction}
                            </span>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.mutedLight, fontWeight: 600 }}>{op.confidence.toFixed(0)}%</span>
                          </div>
                        </div>
                        {/* ── EXPANDED REASONING ── */}
                        {isOpExpanded && (
                          <div style={{ marginTop: 8, padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: 8, animation: 'slideUpFade 0.2s ease' }}>
                            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>FULL REASONING</div>
                            <div style={{ fontSize: 11, color: C.mutedLight, lineHeight: 1.5 }}>
                              {op.reasoning || "No detailed reasoning provided for this node."}
                            </div>
                            <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '4px 8px' }}>
                                <span style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>CONFIDENCE: </span>
                                <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 800, color: op.confidence > 70 ? C.green : C.yellow }}>{op.confidence.toFixed(1)}%</span>
                              </div>
                              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '4px 8px' }}>
                                <span style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>CALL: </span>
                                <span style={{ fontSize: 11, fontWeight: 800, color: directionColor(op.direction) }}>{op.direction}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      );
                    })}
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
                <HelpTooltip section={HELP.activeTargets} />
              </div>
              <span style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: 12, fontSize: 11, color: C.mutedLight }}>
                {signals.length} SPOTTED
              </span>
            </div>

            {signals.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12, fontWeight: 600 }}>NO HIGH-CONVICTION SIGNALS DETECTED</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                {signals.map((sig, i) => {
                  const isExpanded = expandedSignal === i;
                  return (
                  <div key={i} className="token-card" onClick={() => setExpandedSignal(isExpanded ? null : i)}
                    style={{ animation: `slideUpFade 0.3s ease ${i * 40}ms both`, cursor: 'pointer',
                      border: isExpanded ? `1px solid ${directionColor(sig.direction)}60` : undefined,
                      boxShadow: isExpanded ? `0 0 20px ${directionColor(sig.direction)}20` : undefined }}>
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
                       <div style={{ height: '100%', width: `${sig.confidence}%`, background: directionColor(sig.direction), borderRadius: 2 }} />
                    </div>

                    {/* ── EXPANDED DETAIL PANEL ── */}
                    {isExpanded && (
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 10, animation: 'slideUpFade 0.25s ease' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em' }}>TIMESTAMP</div>
                            <div style={{ fontSize: 11, fontFamily: 'monospace', color: C.mutedLight, marginTop: 2 }}>
                              {sig.timestamp ? new Date(sig.timestamp).toLocaleString() : '—'}
                            </div>
                          </div>
                          <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em' }}>SIGNAL TYPE</div>
                            <div style={{ fontSize: 11, fontFamily: 'monospace', color: directionColor(sig.direction), marginTop: 2 }}>
                              {sig.direction} @ {sig.confidence.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em' }}>SIGNAL STRENGTH</div>
                          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${sig.confidence}%`, background: `linear-gradient(90deg, ${directionColor(sig.direction)}80, ${directionColor(sig.direction)})`, borderRadius: 3, transition: 'width 0.4s ease' }} />
                            </div>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: sig.confidence > 80 ? C.green : sig.confidence > 60 ? C.yellow : C.red }}>
                              {sig.confidence > 80 ? 'STRONG' : sig.confidence > 60 ? 'MODERATE' : 'WEAK'}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: 9, color: C.muted, textAlign: 'center', fontWeight: 600, letterSpacing: '0.1em' }}>
                          TAP AGAIN TO COLLAPSE
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
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
              <HelpTooltip section={HELP.heatgrid} />
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
                  const isUp = t.change1h !== null && t.change1h >= 0;
                  const isTkExpanded = expandedToken === i;
                  return (
                    <div key={i} className="token-card" onClick={() => setExpandedToken(isTkExpanded ? null : i)}
                      style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: `slideUpFade 0.3s ease ${i * 15}ms both`, cursor: 'pointer',
                        border: isTkExpanded ? '1px solid rgba(218,165,32,0.4)' : undefined,
                        boxShadow: isTkExpanded ? '0 0 20px rgba(218,165,32,0.15)' : undefined }}>
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
                          <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700 }}>{t.price !== null ? `$${formatNum(t.price)}` : '—'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                           <span style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.1em' }}>1H MOVE</span>
                           <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: isUp ? C.green : C.red }}>
                             {t.change1h !== null ? `${isUp ? '+' : ''}${t.change1h.toFixed(2)}%` : '—'}
                           </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <span style={{ fontSize: 9, color: C.mutedLight, fontWeight: 700, letterSpacing: '0.1em' }}>VOL 24H</span>
                          <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600, color: C.text }}>{t.volume24h !== null ? `$${formatCompact(t.volume24h)}` : '—'}</span>
                        </div>
                      </div>

                      {/* ── EXPANDED TOKEN DETAIL ── */}
                      {isTkExpanded && (
                        <div style={{ paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 10, animation: 'slideUpFade 0.25s ease' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em' }}>MARKET CAP</div>
                              <div style={{ fontSize: 13, fontFamily: 'monospace', color: C.text, fontWeight: 700, marginTop: 2 }}>
                                {t.marketCap ? `$${formatCompact(t.marketCap)}` : '—'}
                              </div>
                            </div>
                            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em' }}>DEX / EXCHANGE</div>
                              <div style={{ fontSize: 13, fontFamily: 'monospace', color: C.blue, fontWeight: 700, marginTop: 2 }}>
                                {t.exchange || '—'}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em' }}>CHAIN</div>
                              <div style={{ fontSize: 13, fontFamily: 'monospace', color: C.purple || '#c084fc', fontWeight: 700, marginTop: 2, textTransform: 'uppercase' }}>
                                {t.chain}
                              </div>
                            </div>
                            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em' }}>FULL NAME</div>
                              <div style={{ fontSize: 12, color: C.mutedLight, fontWeight: 600, marginTop: 2 }}>
                                {t.name || t.symbol}
                              </div>
                            </div>
                          </div>
                          {/* Volume vs MarketCap ratio indicator */}
                          {t.volume24h && t.marketCap && t.marketCap > 0 && (
                            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: '0.1em' }}>VOL/MCAP RATIO</div>
                              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.min((t.volume24h / t.marketCap) * 100, 100)}%`, background: `linear-gradient(90deg, ${C.blue}80, ${C.blue})`, borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: (t.volume24h / t.marketCap) > 0.5 ? C.green : C.mutedLight }}>
                                  {((t.volume24h / t.marketCap) * 100).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          )}
                          <div style={{ fontSize: 9, color: C.muted, textAlign: 'center', fontWeight: 600, letterSpacing: '0.1em' }}>
                            TAP AGAIN TO COLLAPSE
                          </div>
                        </div>
                      )}
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
