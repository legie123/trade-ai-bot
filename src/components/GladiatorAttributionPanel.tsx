// ============================================================
// GladiatorAttributionPanel — Phase 2 Batch 16
// Per-gladiator P&L table from /api/v2/gladiator-attribution.
// ADDITIVE. Self-contained. No external state.
// ============================================================
'use client';

import { useEffect, useState, useCallback } from 'react';
import FreshnessBadge from './FreshnessBadge';

interface GladiatorStats {
  gladiatorId: string;
  trades: number;
  wins: number;
  losses: number;
  pending: number;
  hitRate: number;
  totalPnlPct: number;
  avgPnlPct: number;
  bestPnlPct: number;
  worstPnlPct: number;
  lastTradeAt: string;
}

const C = {
  surface: '#0d1018', surfaceAlt: '#111520', border: '#1a2133',
  green: '#00e676', red: '#ff3d57', yellow: '#ffd600',
  blue: '#29b6f6', mutedLight: '#5a6a85', text: '#c8d4e8', textDim: '#8899b0',
};

const pnlCol = (n: number) => n > 0 ? C.green : n < 0 ? C.red : C.text;
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

function HitBar({ rate, w = 60, h = 6 }: { rate: number; w?: number; h?: number }) {
  const fill = Math.max(0, Math.min(1, rate));
  const col = fill >= 0.55 ? C.green : fill >= 0.45 ? C.yellow : C.red;
  return (
    <svg width={w} height={h} style={{ verticalAlign: 'middle' }}>
      <rect x={0} y={0} width={w} height={h} rx={3} fill={C.border} />
      <rect x={0} y={0} width={w * fill} height={h} rx={3} fill={col} />
    </svg>
  );
}

export default function GladiatorAttributionPanel() {
  const [gladiators, setGladiators] = useState<GladiatorStats[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/v2/gladiator-attribution');
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error?.message || 'fetch failed');
      setGladiators(j.data.gladiators as GladiatorStats[]);
      setTotal(j.data.totalDecisions as number);
      setLastFetch(Date.now());
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetch_(); }, [fetch_]);

  return (
    <div style={{ margin: '12px 12px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.mutedLight, textTransform: 'uppercase' }}>
          Gladiator Attribution
          <span style={{ marginLeft: 8, fontWeight: 400, color: C.textDim }}>{total} decisions</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FreshnessBadge timestamp={lastFetch} label="attr" freshMs={120000} staleMs={600000} />
          <button onClick={fetch_} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.blue, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            refresh
          </button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 12px', fontSize: 11, color: C.red }}>error: {err}</div>}

      {gladiators.length === 0 && !loading && !err && (
        <div style={{ padding: '12px', fontSize: 11, color: C.mutedLight }}>
          No gladiator attribution data yet.
        </div>
      )}

      {gladiators.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Gladiator', 'Trades', 'W/L/P', 'Hit Rate', 'Total P&L', 'Avg', 'Best', 'Worst'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: C.mutedLight, textTransform: 'uppercase', fontSize: 8, letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gladiators.map(g => (
                <tr key={g.gladiatorId} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '6px 10px', color: C.text, fontWeight: 700 }}>{g.gladiatorId}</td>
                  <td style={{ padding: '6px 10px', color: C.textDim }}>{g.trades}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ color: C.green }}>{g.wins}</span>
                    <span style={{ color: C.mutedLight }}>/</span>
                    <span style={{ color: C.red }}>{g.losses}</span>
                    <span style={{ color: C.mutedLight }}>/</span>
                    <span style={{ color: C.yellow }}>{g.pending}</span>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <HitBar rate={g.hitRate} />
                    <span style={{ marginLeft: 4, color: C.textDim }}>{(g.hitRate * 100).toFixed(0)}%</span>
                  </td>
                  <td style={{ padding: '6px 10px', color: pnlCol(g.totalPnlPct), fontWeight: 700 }}>{fmtPct(g.totalPnlPct)}</td>
                  <td style={{ padding: '6px 10px', color: pnlCol(g.avgPnlPct) }}>{fmtPct(g.avgPnlPct)}</td>
                  <td style={{ padding: '6px 10px', color: C.green }}>{fmtPct(g.bestPnlPct)}</td>
                  <td style={{ padding: '6px 10px', color: C.red }}>{fmtPct(g.worstPnlPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
