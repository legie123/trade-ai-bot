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
  bg: '#07080d',
  surface: '#0c0f1a',
  surfaceAlt: '#0f1220',
  border: '#1a2035',
  borderLight: '#242d44',
  green: '#00e676',
  greenDim: 'rgba(0,230,118,0.12)',
  red: '#ff3d57',
  redDim: 'rgba(255,61,87,0.12)',
  blue: '#29b6f6',
  blueDim: 'rgba(41,182,246,0.12)',
  yellow: '#ffd740',
  yellowDim: 'rgba(255,215,64,0.12)',
  text: '#e8ecf4',
  muted: '#6b7891',
  mutedLight: '#9aa5be',
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
  if (!d) return C.blueDim;
  const up = ['BUY', 'LONG'];
  const down = ['SELL', 'SHORT'];
  if (up.includes(d.toUpperCase())) return C.greenDim;
  if (down.includes(d.toUpperCase())) return C.redDim;
  return C.blueDim;
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

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
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

  const toggleSort = (col: typeof sortCol) => {
    if (col === sortCol) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const sortArrow = (col: typeof sortCol) =>
    sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif' }}>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        input::placeholder { color: ${C.muted}; }
        input:focus, select:focus { outline: none; border-color: ${C.blue} !important; }
      `}</style>

      {/* ── TOP BAR ─────────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: C.bg,
        borderBottom: `1px solid ${C.border}`, padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 16 }}>

        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', color: C.mutedLight }}>
          RADAR
        </span>

        {btcData && (
          <>
            <div style={{ width: 1, height: 16, background: C.border }} />
            <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700 }}>
              BTC&nbsp;
              <span style={{ color: btcData.price >= btcData.dailyOpen ? C.green : C.red }}>
                ${formatNum(btcData.price)}
              </span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {btcData.signals.slice(0, 2).map((sig, i) => (
                <span key={i} style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                  background: directionBg(sig.signal), color: directionColor(sig.signal),
                  border: `1px solid ${directionColor(sig.signal)}40`,
                }}>{sig.signal}</span>
              ))}
            </div>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: C.muted }}>
            {syncing ? 'Syncing...' : `${lastSync}`}
          </span>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: syncing ? C.yellow : C.green,
            animation: syncing ? 'blink 1s infinite' : 'none',
            display: 'inline-block',
          }} />
          <button onClick={() => fetchMain()} style={{
            padding: '5px 10px', background: 'transparent',
            border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.mutedLight, cursor: 'pointer', fontSize: 12,
            transition: 'border-color 0.2s',
          }}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ padding: '20px 20px 0', maxWidth: 1400, margin: '0 auto' }}>

        {/* ── KPI ROW ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'EQUITY', value: `$${formatNum(botStats.equity || 0)}`, color: C.text },
            {
              label: 'DAILY PnL', color: (botStats.todayPnlPercent || 0) >= 0 ? C.green : C.red,
              value: `${(botStats.todayPnlPercent || 0) >= 0 ? '+' : ''}${(botStats.todayPnlPercent || 0).toFixed(2)}%`,
            },
            { label: 'WIN RATE', value: `${(botStats.overallWinRate || 0).toFixed(1)}%`, color: C.green },
            { label: 'MAX DD', value: `${(botStats.maxDrawdown || 0).toFixed(2)}%`, color: C.red },
          ].map(kpi => (
            <div key={kpi.label} style={{ background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>
                {kpi.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: kpi.color }}>
                {kpi.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── MAIN GRID: consensus + signals ─────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, marginBottom: 20 }}>

          {/* Syndicate Consensus */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
              color: C.muted, marginBottom: 14 }}>SYNDICATE CONSENSUS</div>

            {latestAudit ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800,
                      color: directionColor(latestAudit.finalDirection || '') }}>
                      {latestAudit.finalDirection || 'NEUTRAL'}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {formatTime(latestAudit.timestamp)}
                    </div>
                  </div>
                  {/* Confidence ring */}
                  <div style={{ marginLeft: 'auto', position: 'relative', width: 72, height: 72,
                    flexShrink: 0 }}>
                    <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="36" cy="36" r="28" fill="none" stroke={C.border} strokeWidth="6" />
                      <circle cx="36" cy="36" r="28" fill="none"
                        stroke={conf > 70 ? C.green : conf > 50 ? C.blue : C.yellow}
                        strokeWidth="6"
                        strokeDasharray={`${(conf / 100) * 175.9} 175.9`}
                        strokeLinecap="round" />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 800, fontFamily: 'monospace' }}>
                      {conf.toFixed(0)}%
                    </div>
                  </div>
                </div>

                {/* Seat opinions */}
                {latestAudit.opinions && latestAudit.opinions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {latestAudit.opinions.slice(0, 4).map(op => (
                      <div key={op.seat} style={{ display: 'flex', alignItems: 'center',
                        gap: 8, padding: '7px 10px', borderRadius: 7,
                        background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 11, color: C.muted, minWidth: 70,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {op.seat}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700,
                          color: directionColor(op.direction),
                          background: directionBg(op.direction),
                          padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>
                          {op.direction}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'monospace',
                          color: C.mutedLight, flexShrink: 0 }}>
                          {op.confidence.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: C.muted, fontSize: 13, padding: '20px 0' }}>
                Awaiting signal...
              </div>
            )}
          </div>

          {/* Active Signals */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
              color: C.muted, marginBottom: 14 }}>
              ACTIVE SIGNALS
              {signals.length > 0 && (
                <span style={{ marginLeft: 8, padding: '2px 7px', borderRadius: 10,
                  background: C.blueDim, color: C.blue, fontSize: 10 }}>
                  {signals.length}
                </span>
              )}
            </div>

            {signals.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13, padding: '20px 0' }}>No signals yet</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                {signals.slice(0, 15).map((sig, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8,
                    background: C.surfaceAlt, border: `1px solid ${C.border}`,
                    animation: `slideUp 0.2s ease ${i * 30}ms both` }}>
                    <span style={{ fontWeight: 700, fontSize: 13, flex: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sig.symbol}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700,
                      color: directionColor(sig.direction),
                      background: directionBg(sig.direction),
                      padding: '2px 7px', borderRadius: 4, flexShrink: 0 }}>
                      {sig.direction}
                    </span>
                    <span style={{ fontSize: 10, color: C.muted,
                      fontFamily: 'monospace', flexShrink: 0 }}>
                      {sig.confidence.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── BTC EMAs (compact strip) ─────────────── */}
        {btcData && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '12px 20px', marginBottom: 20,
            display: 'flex', gap: 32, alignItems: 'center', overflowX: 'auto' }}>
            <div>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 2 }}>DAILY OPEN</div>
              <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600 }}>
                ${formatNum(btcData.dailyOpen)}
              </div>
            </div>
            {[['EMA 50', btcData.ema50], ['EMA 200', btcData.ema200], ['EMA 800', btcData.ema800]].map(([label, val]) => {
              const above = btcData.price >= (val as number);
              return (
                <div key={label as string}>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 2 }}>{label as string}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600,
                    color: above ? C.green : C.red }}>
                    ${formatNum(val as number)}
                  </div>
                </div>
              );
            })}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
              Price {btcData.price >= btcData.ema200 ? '▲ above' : '▼ below'} EMA 200
            </div>
          </div>
        )}

        {/* ── TOKEN SCANNER ────────────────────────── */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.muted }}>
              TOKEN SCANNER
            </span>
            <span style={{ fontSize: 10, color: C.muted }}>
              {filteredTokens.length} tokens
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Search..."
                value={tokenSearch}
                onChange={e => setTokenSearch(e.target.value)}
                style={{ width: 120, padding: '6px 10px', background: C.surfaceAlt,
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.text, fontSize: 12 }}
              />
              <select
                value={tokenChainFilter}
                onChange={e => setTokenChainFilter(e.target.value)}
                style={{ padding: '6px 10px', background: C.surfaceAlt,
                  border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.text, fontSize: 12 }}
              >
                <option value="">All Chains</option>
                <option value="solana">Solana</option>
                <option value="ethereum">Ethereum</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: C.surface }}>
                <tr>
                  {[
                    { label: 'Symbol', col: null },
                    { label: 'Price', col: 'price' as const },
                    { label: '1h Change', col: 'change24h' as const },
                    { label: 'Volume', col: 'volume24h' as const },
                    { label: 'Chain', col: null },
                    { label: 'Exchange', col: null },
                  ].map(th => (
                    <th key={th.label}
                      onClick={th.col ? () => toggleSort(th.col!) : undefined}
                      style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600,
                        color: th.col && sortCol === th.col ? C.blue : C.muted,
                        borderBottom: `1px solid ${C.border}`,
                        cursor: th.col ? 'pointer' : 'default', whiteSpace: 'nowrap',
                        userSelect: 'none', fontSize: 10, letterSpacing: '0.06em' }}>
                      {th.label}{th.col ? sortArrow(th.col) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTokens.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: C.muted }}>
                    No tokens match
                  </td></tr>
                ) : filteredTokens.slice(0, 40).map((t, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}22` }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.surfaceAlt)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '9px 8px', fontWeight: 600 }}>
                      <div>{t.symbol}</div>
                      {t.name && <div style={{ fontSize: 10, color: C.muted }}>{t.name.slice(0, 14)}</div>}
                    </td>
                    <td style={{ padding: '9px 8px', fontFamily: 'monospace' }}>
                      {t.price !== null ? `$${formatNum(t.price)}` : '—'}
                    </td>
                    <td style={{ padding: '9px 8px', fontFamily: 'monospace',
                      color: t.change24h !== null ? (t.change24h >= 0 ? C.green : C.red) : C.muted,
                      fontWeight: 600 }}>
                      {t.change24h !== null
                        ? `${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%`
                        : '—'}
                    </td>
                    <td style={{ padding: '9px 8px', fontFamily: 'monospace', color: C.mutedLight }}>
                      {t.volume24h !== null ? `$${formatCompact(t.volume24h)}` : '—'}
                    </td>
                    <td style={{ padding: '9px 8px', fontSize: 11, textTransform: 'capitalize', color: C.mutedLight }}>
                      {t.chain}
                    </td>
                    <td style={{ padding: '9px 8px', fontSize: 11, color: C.muted }}>
                      {t.exchange}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <BottomNav />
    </div>
  );
}
