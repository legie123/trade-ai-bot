'use client';

import { useEffect, useState } from 'react';
import BottomNav from '@/components/BottomNav';

interface Gladiator {
  id: string;
  name: string;
  isLive: boolean;
  winRate: string;
  totalTrades: number;
  profitFactor: string;
  maxDrawdown: string;
  sharpeRatio: string;
  status: string;
  rankReason: string;
}

interface SuperAiOmega {
  rank: string;
  trainingProgress: number;
  winRate: string;
  status: string;
}

interface ArenaData {
  activeFighters: number;
  superAiOmega: SuperAiOmega | null;
  leaderboard: Gladiator[];
}

type SortKey = 'winRate' | 'totalTrades' | 'profitFactor' | 'maxDrawdown' | 'sharpeRatio';

const C = {
  bg: '#07080d',
  surface: '#0c0f1a',
  surfaceAlt: '#0f1220',
  border: '#1a2035',
  green: '#00e676',
  greenDim: 'rgba(0,230,118,0.10)',
  red: '#ff3d57',
  redDim: 'rgba(255,61,87,0.10)',
  blue: '#29b6f6',
  blueDim: 'rgba(41,182,246,0.10)',
  yellow: '#ffd740',
  purple: '#c084fc',
  purpleDim: 'rgba(192,132,252,0.10)',
  text: '#e8ecf4',
  muted: '#6b7891',
  mutedLight: '#9aa5be',
};

function winColor(wr: string) {
  const n = parseFloat(wr);
  if (n >= 60) return C.green;
  if (n >= 45) return C.yellow;
  return C.red;
}

function statusStyle(status: string): { color: string; bg: string; border: string } {
  switch (status) {
    case 'LIVE':      return { color: C.green,      bg: C.greenDim,  border: `${C.green}60` };
    case 'SHADOW':    return { color: C.blue,       bg: C.blueDim,   border: `${C.blue}60` };
    case 'STANDBY':   return { color: C.mutedLight, bg: 'rgba(155,165,190,0.08)', border: '#6b789130' };
    case 'ELIMINATED':return { color: C.red,        bg: C.redDim,    border: `${C.red}60` };
    default:          return { color: C.mutedLight, bg: 'transparent', border: C.border };
  }
}

export default function ArenaPage() {
  const [data, setData] = useState<ArenaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('winRate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/v2/arena');
        const json = await res.json();
        setData(json);
        setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch { /* silent */ } finally {
        setLoading(false);
      }
    };
    fetch_();
    const t = setInterval(fetch_, 10_000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center', color: C.muted, fontFamily: 'system-ui' }}>
        Loading arena...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center', color: C.red, fontFamily: 'system-ui' }}>
        Failed to load arena data
      </div>
    );
  }

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...data.leaderboard].sort((a, b) => {
    const parse = (v: string | number) => typeof v === 'number' ? v : parseFloat(String(v)) || 0;
    const av = parse(a[sortKey]);
    const bv = parse(b[sortKey]);
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const liveCount = data.leaderboard.filter(g => g.status === 'LIVE').length;
  const avgWR = data.leaderboard.length
    ? (data.leaderboard.reduce((s, g) => s + parseFloat(g.winRate), 0) / data.leaderboard.length)
    : 0;
  const totalTrades = data.leaderboard.reduce((s, g) => s + g.totalTrades, 0);

  const top3 = [...data.leaderboard].sort((a, b) =>
    parseFloat(b.winRate) - parseFloat(a.winRate)).slice(0, 3);

  const arrow = (k: SortKey) => k === sortKey ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const omega = data.superAiOmega;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif' }}>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      `}</style>

      {/* ── TOP BAR ───────────────────────────────── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: C.bg,
        borderBottom: `1px solid ${C.border}`, padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', color: C.mutedLight }}>
          ARENA
        </span>
        <div style={{ width: 1, height: 16, background: C.border }} />
        <span style={{ fontSize: 12, color: C.muted }}>
          <span style={{ color: C.green, fontWeight: 700 }}>{liveCount}</span> live ·{' '}
          <span style={{ color: C.text, fontWeight: 600 }}>{data.leaderboard.length}</span> total fighters
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>
          {lastSync}
        </span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green,
          animation: 'pulse 2s infinite', display: 'inline-block' }} />
      </div>

      <div style={{ padding: '20px 20px 0', maxWidth: 1400, margin: '0 auto' }}>

        {/* ── ARENA STATS STRIP ─────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'ACTIVE FIGHTERS', value: liveCount, color: C.green },
            { label: 'AVG WIN RATE', value: `${avgWR.toFixed(1)}%`, color: winColor(avgWR.toFixed(1)) },
            { label: 'TOTAL FIGHTS', value: totalTrades.toLocaleString(), color: C.text },
            { label: 'TOTAL GLADIATORS', value: data.leaderboard.length, color: C.text },
          ].map(s => (
            <div key={s.label} style={{ background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700,
                letterSpacing: '0.1em', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace',
                color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── TOP 3 PODIUM ──────────────────────────── */}
        {top3.length > 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
              color: C.muted, marginBottom: 14 }}>TOP PERFORMERS</div>
            <div style={{ display: 'grid',
              gridTemplateColumns: `repeat(${top3.length}, 1fr)`, gap: 12 }}>
              {top3.map((g, i) => {
                const ss = statusStyle(g.status);
                const rank = i === 0 ? '#1' : i === 1 ? '#2' : '#3';
                const rankColor = i === 0 ? C.yellow : i === 1 ? C.mutedLight : '#cd7f32';
                return (
                  <div key={g.id} style={{ padding: '16px 18px',
                    background: i === 0 ? `${C.yellow}08` : C.surfaceAlt,
                    border: `1px solid ${i === 0 ? `${C.yellow}30` : C.border}`,
                    borderRadius: 10, position: 'relative' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: rankColor,
                      letterSpacing: '0.05em', marginBottom: 8 }}>{rank}</div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {g.name}
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'monospace',
                      color: winColor(g.winRate), marginBottom: 8 }}>
                      {g.winRate}%
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center',
                      flexWrap: 'wrap', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: C.muted }}>
                        P/F: <span style={{ color: C.text, fontWeight: 600 }}>{g.profitFactor}</span>
                      </span>
                      <span style={{ fontSize: 11, color: C.muted }}>
                        Trades: <span style={{ color: C.text, fontWeight: 600 }}>{g.totalTrades}</span>
                      </span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px',
                      borderRadius: 4, color: ss.color, background: ss.bg,
                      border: `1px solid ${ss.border}`,
                      animation: g.status === 'LIVE' ? 'pulse 1.5s infinite' : 'none' }}>
                      {g.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── OMEGA PROGRESS ────────────────────────── */}
        {omega && (
          <div style={{ background: C.surface,
            border: `1px solid ${C.purple}40`, borderRadius: 12,
            padding: '18px 20px', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.purple }}>
                SUPER AI OMEGA
              </div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4,
                background: C.purpleDim, color: C.purple, border: `1px solid ${C.purple}50`,
                fontWeight: 600 }}>
                {omega.status}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 12, fontFamily: 'monospace',
                fontWeight: 700, color: winColor(omega.winRate) }}>
                {omega.winRate}% win rate
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.06)',
                borderRadius: 4, overflow: 'hidden',
                border: `1px solid ${C.border}` }}>
                <div style={{ height: '100%',
                  width: `${omega.trainingProgress}%`,
                  background: `linear-gradient(90deg, ${C.purple}88, ${C.purple})`,
                  borderRadius: 4, transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                color: C.purple, minWidth: 44, textAlign: 'right' }}>
                {omega.trainingProgress}%
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>trained</div>
            </div>
          </div>
        )}

        {/* ── LEADERBOARD ───────────────────────────── */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
            color: C.muted, marginBottom: 14 }}>FULL LEADERBOARD</div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {[
                    { label: '#', key: null },
                    { label: 'Name', key: null },
                    { label: 'Status', key: null },
                    { label: 'Win Rate', key: 'winRate' as SortKey },
                    { label: 'P/F Ratio', key: 'profitFactor' as SortKey },
                    { label: 'Fights', key: 'totalTrades' as SortKey },
                    { label: 'Max DD', key: 'maxDrawdown' as SortKey },
                    { label: 'Sharpe', key: 'sharpeRatio' as SortKey },
                    { label: 'Notes', key: null },
                  ].map(col => (
                    <th key={col.label}
                      onClick={col.key ? () => toggleSort(col.key!) : undefined}
                      style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700,
                        fontSize: 10, letterSpacing: '0.08em',
                        color: col.key && sortKey === col.key ? C.blue : C.muted,
                        cursor: col.key ? 'pointer' : 'default',
                        userSelect: 'none', whiteSpace: 'nowrap' }}>
                      {col.label}{col.key ? arrow(col.key) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((g, i) => {
                  const ss = statusStyle(g.status);
                  return (
                    <tr key={g.id}
                      style={{ borderBottom: `1px solid ${C.border}18`, transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.surfaceAlt)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ padding: '10px 10px', color: C.muted, fontFamily: 'monospace', fontSize: 11 }}>
                        {i + 1}
                      </td>
                      <td style={{ padding: '10px 10px', fontWeight: 600 }}>
                        {g.name}
                        {g.isLive && (
                          <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700,
                            color: C.green, animation: 'pulse 1.5s infinite' }}>● LIVE</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px',
                          borderRadius: 4, color: ss.color, background: ss.bg,
                          border: `1px solid ${ss.border}`,
                          textDecoration: g.status === 'ELIMINATED' ? 'line-through' : 'none' }}>
                          {g.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', fontFamily: 'monospace',
                        fontWeight: 700, color: winColor(g.winRate) }}>
                        {g.winRate}%
                      </td>
                      <td style={{ padding: '10px 10px', fontFamily: 'monospace', color: C.text }}>
                        {g.profitFactor}
                      </td>
                      <td style={{ padding: '10px 10px', fontFamily: 'monospace', color: C.mutedLight }}>
                        {g.totalTrades.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 10px', fontFamily: 'monospace',
                        color: parseFloat(g.maxDrawdown) > 15 ? C.red : C.mutedLight }}>
                        {g.maxDrawdown}
                      </td>
                      <td style={{ padding: '10px 10px', fontFamily: 'monospace', color: C.mutedLight }}>
                        {g.sharpeRatio}
                      </td>
                      <td style={{ padding: '10px 10px', color: C.muted, fontSize: 11,
                        maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g.rankReason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <BottomNav />
    </div>
  );
}
