'use client';

import { useState, useEffect, useCallback } from 'react';
import { useBotStats } from '@/hooks/useBotStats';
import BottomNav from '@/components/BottomNav';
import SectorInfo from '@/components/SectorInfo';

interface Signal {
  symbol: string;
  direction: string;
  confidence: number;
  timestamp: string;
  edgeScore?: number;
  risk?: number;
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

const COLORS = {
  bg: '#0a0e17',
  card: '#111827',
  border: '#1e293b',
  text: '#f1f5f9',
  muted: '#64748b',
  green: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  purple: '#8b5cf6',
};

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

function getConfidenceColor(conf: number): string {
  if (conf >= 80) return COLORS.green;
  if (conf >= 65) return COLORS.amber;
  return COLORS.muted;
}

export default function CryptoRadarPage() {
  const { stats: botStats } = useBotStats(15_000);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [btcData, setBtcData] = useState<BTCData | null>(null);
  const [combatAudits, setCombatAudits] = useState<CombatAudit[]>([]);
  const [lastSync, setLastSync] = useState<string>('—');
  const [scanDuration, setScanDuration] = useState<number>(0);
  const [syncing, setSyncing] = useState(true);
  const [sortBy, setSortBy] = useState<'confidence' | 'edge' | 'risk'>('confidence');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchMain = useCallback(async () => {
    const startTime = performance.now();
    try {
      const [signalsRes, btcRes, botRes] = await Promise.all([
        fetch('/api/tradingview', { signal: AbortSignal.timeout(8000) }).catch(() => null),
        fetch('/api/btc-signals', { signal: AbortSignal.timeout(8000) }).catch(() => null),
        fetch('/api/bot', { signal: AbortSignal.timeout(8000) }).catch(() => null),
      ]);
      if (signalsRes?.ok) {
        const d = await signalsRes.json();
        setSignals((d.signals || []).slice(0, 50));
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
    setScanDuration(Math.round(performance.now() - startTime));
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
    }, 60_000);
    const t = setInterval(fetchTokens, 60_000);
    return () => { clearInterval(m); clearInterval(t); };
  }, [fetchMain, fetchTokens]);

  const latestAudit = combatAudits[0];
  const conf = latestAudit?.weightedConfidence ?? 0;

  const signalsAboveThreshold = signals.filter(s => s.confidence >= 65).length;
  const avgConfidence = signals.length > 0 ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length : 0;
  const topSignal = signals[0];

  const sortedSignals = [...signals].sort((a, b) => {
    let aVal = 0, bVal = 0;
    if (sortBy === 'confidence') {
      aVal = a.confidence;
      bVal = b.confidence;
    } else if (sortBy === 'edge') {
      aVal = a.edgeScore || 0;
      bVal = b.edgeScore || 0;
    } else {
      aVal = a.risk || 0;
      bVal = b.risk || 0;
    }
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
  });

  const btcRegime = btcData ? (btcData.price > btcData.ema50 ? 'BULL' : btcData.price > btcData.ema200 ? 'RANGE' : 'BEAR') : 'UNKNOWN';

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, paddingBottom: 80, fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid ${COLORS.border}; }
        th { background: rgba(255,255,255,0.02); font-weight: 700; font-size: 11px; letter-spacing: 0.1em; }
        tr:hover { background: rgba(255,255,255,0.02); }
        input, select { background: ${COLORS.card}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 12px; }
        input:focus, select:focus { outline: none; border-color: ${COLORS.blue}; box-shadow: 0 0 10px rgba(59,130,246,0.3); }
      `}</style>

      {/* MARKET HEADER BAR */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: COLORS.bg, borderBottom: `1px solid ${COLORS.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.15em' }}>CRYPTO RADAR</span>

          {btcData && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 12, borderLeft: `1px solid ${COLORS.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>BTC</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: btcData.price >= btcData.dailyOpen ? COLORS.green : COLORS.red }}>
                ${formatNum(btcData.price)}
              </span>
              <span style={{ fontSize: 12, color: btcData.price >= btcData.dailyOpen ? COLORS.green : COLORS.red }}>
                {btcData.price >= btcData.dailyOpen ? '▲' : '▼'} {Math.abs(((btcData.price - btcData.dailyOpen) / btcData.dailyOpen) * 100).toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: `1px solid ${COLORS.border}` }}>
          {btcData && (
            <>
              <span style={{ fontSize: 10, color: COLORS.muted, fontWeight: 600 }}>EMA50:</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: btcData.price > btcData.ema50 ? COLORS.green : COLORS.red }}>
                {btcData.price > btcData.ema50 ? '✓' : '✗'}
              </span>
              <span style={{ fontSize: 10, color: COLORS.muted, fontWeight: 600 }}>EMA200:</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: btcData.price > btcData.ema200 ? COLORS.green : COLORS.red }}>
                {btcData.price > btcData.ema200 ? '✓' : '✗'}
              </span>
              <span style={{ fontSize: 10, color: COLORS.muted, fontWeight: 600 }}>EMA800:</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: btcData.price > btcData.ema800 ? COLORS.green : COLORS.red }}>
                {btcData.price > btcData.ema800 ? '✓' : '✗'}
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: 4, fontSize: 11, color: COLORS.muted }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: syncing ? COLORS.amber : COLORS.green, animation: syncing ? 'pulse 1.5s infinite' : 'none' }} />
            {syncing ? 'SCANNING...' : lastSync}
          </div>
          <button onClick={() => fetchMain()} style={{ padding: '6px 10px', background: COLORS.card, border: `1px solid ${COLORS.border}`, color: COLORS.blue, cursor: 'pointer', fontSize: 11, fontWeight: 700, borderRadius: 4, transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.blue; e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.background = COLORS.card; }}>
            ↻ SYNC
          </button>
        </div>
      </div>

      {/* SIGNAL QUALITY STRIP */}
      <div style={{ background: 'rgba(255,255,255,0.01)', borderBottom: `1px solid ${COLORS.border}`, padding: '12px 20px', display: 'flex', gap: 20, alignItems: 'center', fontSize: 12, flexWrap: 'wrap', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: COLORS.muted }}>SIGNALS SCANNED:</span>
          <span style={{ fontWeight: 700, color: COLORS.text }}>{signals.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: COLORS.muted }}>ABOVE 65%:</span>
          <span style={{ fontWeight: 700, color: COLORS.green }}>{signalsAboveThreshold}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: COLORS.muted }}>TOP SIGNAL:</span>
          {topSignal ? (
            <>
              <span style={{ fontWeight: 700, color: COLORS.text }}>{topSignal.symbol}</span>
              <span style={{ fontWeight: 700, color: getConfidenceColor(topSignal.confidence) }}>{topSignal.confidence.toFixed(0)}%</span>
            </>
          ) : (
            <span style={{ color: COLORS.muted }}>IDLE</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: COLORS.muted }}>AVG CONFIDENCE:</span>
          <span style={{ fontWeight: 700, color: getConfidenceColor(avgConfidence) }}>{avgConfidence.toFixed(1)}%</span>
        </div>
      </div>

      <div style={{ padding: '20px', maxWidth: 1920, margin: '0 auto' }}>

        {/* ACTIVE SIGNALS TABLE */}
        <div style={{ marginBottom: 20, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '14px 20px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>ACTIVE SIGNALS ({sortedSignals.length}) <SectorInfo title="Active Signals" description="Real-time token screening. The ML ensemble (momentum + mean-reversion + volatility-regime learners) scores each token and the LLM Syndicate validates the signal direction." dataSource="MEXC/Binance market data, 3 ML weak learners, LLM Syndicate consensus" output="Ranked signals by confidence. BUY/SELL direction, edge score, risk level, syndicate vote" role="Primary decision engine. Only signals above 65% confidence are actionable. Walk-forward validated." /></span>
            <div style={{ display: 'flex', gap: 12 }}>
              {(['confidence', 'edge', 'risk'] as const).map(col => (
                <button key={col} onClick={() => { setSortBy(col); setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); }}
                  style={{ background: sortBy === col ? 'rgba(255,255,255,0.05)' : 'transparent', border: sortBy === col ? `1px solid ${COLORS.border}` : 'none', color: sortBy === col ? COLORS.blue : COLORS.muted, cursor: 'pointer', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, transition: 'all 0.2s' }}>
                  {col.toUpperCase()} {sortBy === col && (sortDir === 'desc' ? '▼' : '▲')}
                </button>
              ))}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: '5%' }}>RANK</th>
                <th style={{ width: '12%' }}>SYMBOL</th>
                <th style={{ width: '12%' }}>SIGNAL</th>
                <th style={{ width: '15%' }}>CONFIDENCE</th>
                <th style={{ width: '12%' }}>EDGE SCORE</th>
                <th style={{ width: '12%' }}>RISK</th>
                <th style={{ width: '15%' }}>VOL 24H</th>
                <th style={{ width: '10%' }}>REGIME</th>
                <th style={{ width: '7%' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {sortedSignals.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: COLORS.muted, fontSize: 12 }}>NO SIGNALS ACTIVE</td>
                </tr>
              ) : (
                sortedSignals.slice(0, 30).map((sig, idx) => {
                  const isSignalBull = sig.direction?.toUpperCase().includes('BUY');
                  const signalColor = isSignalBull ? COLORS.green : COLORS.red;
                  const row = idx + 1;
                  return (
                    <tr key={idx} style={{ animation: `fadeIn 0.3s ease ${idx * 30}ms both` }}>
                      <td style={{ fontWeight: 700, color: COLORS.blue }}>{row}</td>
                      <td style={{ fontWeight: 700 }}>{sig.symbol}</td>
                      <td>
                        <span style={{ padding: '3px 8px', background: isSignalBull ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: signalColor, borderRadius: 4, fontSize: 11, fontWeight: 700, border: `1px solid ${signalColor}40` }}>
                          {isSignalBull ? '▲ BUY' : '▼ SELL'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${sig.confidence}%`, height: '100%', background: getConfidenceColor(sig.confidence) }} />
                          </div>
                          <span style={{ fontWeight: 700, color: getConfidenceColor(sig.confidence), minWidth: 40 }}>{sig.confidence.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace", color: sig.edgeScore ? (sig.edgeScore > 0 ? COLORS.green : COLORS.red) : COLORS.muted }}>
                        {sig.edgeScore ? (sig.edgeScore > 0 ? '+' : '') + sig.edgeScore.toFixed(2) : '—'}
                      </td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace", color: sig.risk ? (sig.risk < 2 ? COLORS.green : sig.risk < 5 ? COLORS.amber : COLORS.red) : COLORS.muted }}>
                        {sig.risk ? sig.risk.toFixed(2) : '—'}
                      </td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>$—</td>
                      <td>
                        <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 3, color: COLORS.muted }}>{isSignalBull ? 'BULL' : 'BEAR'}</span>
                      </td>
                      <td style={{ textAlign: 'center', fontSize: 12, color: COLORS.blue, cursor: 'pointer', fontWeight: 700 }}>→</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>

          {/* SYNDICATE CONSENSUS */}
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, background: 'rgba(255,255,255,0.01)', overflow: 'hidden' }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>■ SYNDICATE CONSENSUS <SectorInfo title="Syndicate Consensus" description="3 LLM agents (DeepSeek Architect 60% weight + OpenAI Oracle 40%) debate each signal. Consensus = final direction + confidence. Anti-hallucination filters active." dataSource="DeepSeek, OpenAI GPT-4o, Gemini — cascade fallback" output="BULL/BEAR/NEUTRAL vote per agent, weighted consensus %, final direction" role="Second brain. Prevents the ML ensemble from acting alone. Catches false signals through adversarial debate." /></div>
            <div style={{ padding: '14px 16px' }}>
              {latestAudit?.opinions && latestAudit.opinions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {latestAudit.opinions.slice(0, 3).map((op, idx) => (
                    <div key={idx} style={{ borderLeft: `2px solid ${op.direction?.toUpperCase().includes('BUY') ? COLORS.green : COLORS.red}`, paddingLeft: 10, fontSize: 11 }}>
                      <div style={{ fontWeight: 700, color: COLORS.text, marginBottom: 2 }}>{op.seat}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
                        <span style={{ color: op.direction?.toUpperCase().includes('BUY') ? COLORS.green : COLORS.red, fontWeight: 700 }}>
                          {op.direction?.toUpperCase()}
                        </span>
                        <span style={{ color: COLORS.muted }}>●</span>
                        <span style={{ color: getConfidenceColor(op.confidence), fontWeight: 600 }}>{op.confidence.toFixed(0)}%</span>
                      </div>
                      {op.reasoning && <div style={{ fontSize: 9, color: COLORS.muted, marginTop: 4, lineHeight: 1.3 }}>{op.reasoning.slice(0, 50)}</div>}
                    </div>
                  ))}
                  <div style={{ paddingTop: 8, borderTop: `1px solid ${COLORS.border}`, fontSize: 11, fontWeight: 700, color: getConfidenceColor(conf) }}>
                    AGGREGATE: {conf.toFixed(0)}% {conf >= 70 ? '✓' : conf >= 50 ? '◐' : '✗'}
                  </div>
                </div>
              ) : (
                <div style={{ color: COLORS.muted, fontSize: 12, textAlign: 'center', padding: '20px 0' }}>AWAITING CONSENSUS</div>
              )}
            </div>
          </div>

          {/* MARKET REGIME */}
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, background: 'rgba(255,255,255,0.01)', overflow: 'hidden' }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>■ MARKET REGIME <SectorInfo title="Market Regime" description="Omega Engine detects the current market state: BULL, BEAR, RANGE, or HIGH_VOL. Strategy parameters adapt automatically to each regime." dataSource="BTC EMA50/200/800 crossovers, volatility metrics, volume analysis" output="Current regime classification, BTC dominance %, regime duration" role="Strategic context. A signal that works in BULL may fail in BEAR. Regime detection prevents strategy mismatch." /></span></div>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4 }}>REGIME</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: btcRegime === 'BULL' ? COLORS.green : btcRegime === 'BEAR' ? COLORS.red : COLORS.amber }}>
                    {btcRegime}
                  </div>
                </div>
                <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4 }}>BTC DOMINANCE</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>—</div>
                </div>
                <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4 }}>FEAR & GREED</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.amber }}>NEUTRAL</div>
                </div>
              </div>
            </div>
          </div>

          {/* SCAN STATUS */}
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, background: 'rgba(255,255,255,0.01)', overflow: 'hidden' }}>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>■ SCAN STATUS <SectorInfo title="Scan Status" description="Monitors the automated market scanning process. Shows when the last scan ran, how long it took, and how many tokens were evaluated." dataSource="Internal cron scheduler, API health probes" output="Last scan timestamp, duration in seconds, markets scanned count, API health" role="Operational heartbeat. If scans stop running, the system is blind to new opportunities." /></span></div>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: COLORS.muted }}>LAST SCAN:</span>
                  <span style={{ fontWeight: 700 }}>{lastSync}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: COLORS.muted }}>DURATION:</span>
                  <span style={{ fontWeight: 700, color: COLORS.cyan }}>{scanDuration}ms</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: COLORS.muted }}>MARKETS:</span>
                  <span style={{ fontWeight: 700 }}>3</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: COLORS.muted }}>API HEALTH:</span>
                  <span style={{ fontWeight: 700, color: COLORS.green }}>●</span>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>

      <BottomNav />
    </div>
  );
}
