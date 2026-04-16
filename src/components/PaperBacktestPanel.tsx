// ============================================================
// PaperBacktestPanel — Phase 2 Batch 8
// Inline dashboard widget. Fetches /api/v2/polymarket/paper-backtest
// and renders hit rate, total P&L, per-division breakdown, top rows.
// ADDITIVE. Self-contained. No external state.
// ============================================================
'use client';

import { useEffect, useState, useCallback } from 'react';
import FreshnessBadge from './FreshnessBadge';

interface Row {
  signalId: string;
  marketId: string;
  marketTitle: string;
  recommendation: 'BUY_YES' | 'BUY_NO' | 'SKIP';
  edgeScore: number;
  entryPrice: number | null;
  exitPrice: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  emittedAt: number;
  ageSec: number;
  note?: string;
}

interface Summary {
  generatedAt: number;
  notionalPerSignal: number;
  feePctRoundTrip: number;
  totals: {
    evaluated: number;
    wins: number;
    losses: number;
    hitRate: number;
    totalPnlUsd: number;
    avgPnlUsd: number;
    bestPnlUsd: number;
    worstPnlUsd: number;
  };
  byDivision: Record<string, { n: number; pnlUsd: number }>;
  rows: Row[];
}

const C = {
  bg: '#07080d', surface: '#0d1018', surfaceAlt: '#111520',
  border: '#1a2133', green: '#00e676', red: '#ff3d57',
  yellow: '#ffd600', blue: '#29b6f6', muted: '#3a4558',
  mutedLight: '#5a6a85', text: '#c8d4e8', textDim: '#8899b0',
};

export default function PaperBacktestPanel({ division }: { division?: string } = {}) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [minEdge, setMinEdge] = useState(50);
  const [notional, setNotional] = useState(100);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams({
        limit: '100',
        minEdge: String(minEdge),
        notional: String(notional),
        ...(division ? { division } : {}),
      });
      const r = await fetch(`/api/v2/polymarket/paper-backtest?${qs}`);
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error?.message || 'backtest failed');
      setData(j.data as Summary);
      setLastFetch(Date.now());
    } catch (e) {
      setErr((e as Error).message);
    } finally { setLoading(false); }
  }, [minEdge, notional, division]);

  useEffect(() => { void run(); }, [run]);

  const t = data?.totals;
  const pnlColor = (n: number | undefined | null) =>
    n == null ? C.mutedLight : n > 0 ? C.green : n < 0 ? C.red : C.text;

  return (
    <div style={{ margin: '12px 12px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.mutedLight, textTransform: 'uppercase' }}>Paper Backtest (Ranker P&amp;L)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FreshnessBadge timestamp={lastFetch} label="bt" freshMs={60000} staleMs={300000} />
          <label style={{ fontSize: 9, color: C.mutedLight }}>
            edge≥
            <input type="number" min={0} max={100} value={minEdge}
              onChange={e => setMinEdge(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              style={{ width: 38, marginLeft: 4, background: C.surfaceAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 4px', fontSize: 10 }} />
          </label>
          <label style={{ fontSize: 9, color: C.mutedLight }}>
            $/sig
            <input type="number" min={1} max={100000} value={notional}
              onChange={e => setNotional(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 52, marginLeft: 4, background: C.surfaceAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 4px', fontSize: 10 }} />
          </label>
          <button onClick={run} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.blue, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? '…' : 'run'}
          </button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 12px', fontSize: 11, color: C.red }}>error: {err}</div>}

      {t && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 1, background: C.border }}>
            {[
              { l: 'Evaluated', v: t.evaluated.toString(), c: C.text },
              { l: 'Hit Rate', v: `${(t.hitRate * 100).toFixed(1)}%`, c: t.hitRate >= 0.55 ? C.green : t.hitRate >= 0.45 ? C.yellow : C.red },
              { l: 'Total P&L', v: `$${t.totalPnlUsd.toFixed(2)}`, c: pnlColor(t.totalPnlUsd) },
              { l: 'Avg P&L', v: `$${t.avgPnlUsd.toFixed(2)}`, c: pnlColor(t.avgPnlUsd) },
              { l: 'Best', v: `$${t.bestPnlUsd.toFixed(2)}`, c: C.green },
              { l: 'Worst', v: `$${t.worstPnlUsd.toFixed(2)}`, c: C.red },
              { l: 'W/L', v: `${t.wins}/${t.losses}`, c: C.text },
            ].map(k => (
              <div key={k.l} style={{ background: C.surface, padding: '8px 10px' }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: C.mutedLight, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{k.l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: k.c, marginTop: 2 }}>{k.v}</div>
              </div>
            ))}
          </div>

          {data && Object.keys(data.byDivision).length > 0 && (
            <div style={{ padding: '8px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(data.byDivision)
                .sort((a, b) => b[1].pnlUsd - a[1].pnlUsd)
                .map(([div, v]) => (
                  <span key={div} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 999, border: `1px solid ${C.border}`, background: C.surfaceAlt, color: pnlColor(v.pnlUsd) }}>
                    {div} · n={v.n} · ${v.pnlUsd.toFixed(2)}
                  </span>
                ))}
            </div>
          )}

          {data && data.rows.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.border}`, maxHeight: 220, overflowY: 'auto' }}>
              {data.rows
                .filter(r => r.pnlUsd != null)
                .sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))
                .slice(0, 10)
                .map(r => (
                  <div key={r.signalId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 10, gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }} title={r.marketTitle}>
                      <span style={{ color: r.recommendation === 'BUY_YES' ? C.green : C.red, fontWeight: 700, marginRight: 6 }}>{r.recommendation === 'BUY_YES' ? 'YES' : 'NO'}</span>
                      {r.marketTitle}
                    </div>
                    <span style={{ color: C.mutedLight }}>e:{r.edgeScore}</span>
                    <span style={{ color: C.textDim }}>{r.entryPrice?.toFixed(3)} → {r.exitPrice?.toFixed(3)}</span>
                    <span style={{ color: pnlColor(r.pnlUsd), fontWeight: 700, minWidth: 60, textAlign: 'right' }}>
                      ${(r.pnlUsd ?? 0).toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {!t && !loading && !err && (
        <div style={{ padding: '12px', fontSize: 11, color: C.mutedLight }}>
          No paper signals yet. Deploy with <code style={{ color: C.blue }}>POLY_PAPER_FEEDER=true</code> and let the scanner run.
        </div>
      )}
    </div>
  );
}
