// ============================================================
// BacktestTrendPanel — Phase 2 Batch 9
// Reads /api/v2/polymarket/backtest-snapshots and draws two SVG
// sparklines: total P&L and hit rate. Also shows current tune
// recommendation inline.
// ADDITIVE. Self-contained.
// ============================================================
'use client';

import { useEffect, useState, useCallback } from 'react';
import FreshnessBadge from './FreshnessBadge';

interface Snap {
  capturedAt: number;
  evaluated: number;
  hitRate: number;
  totalPnlUsd: number;
  avgPnlUsd: number;
  wins: number;
  losses: number;
  minEdgeScore: number;
}

interface TunePoint {
  minEdge: number;
  evaluated: number;
  hitRate: number;
  avgPnlUsd: number;
  totalPnlUsd: number;
}

interface TuneResult {
  generatedAt: number;
  points: TunePoint[];
  recommended: TunePoint | null;
  currentFloor: number;
  note: string;
}

const C = {
  surface: '#0d1018', surfaceAlt: '#111520', border: '#1a2133',
  green: '#00e676', red: '#ff3d57', yellow: '#ffd600',
  blue: '#29b6f6', muted: '#3a4558', mutedLight: '#5a6a85',
  text: '#c8d4e8', textDim: '#8899b0',
};

function Sparkline({ values, stroke, fill, height = 40, width = 200 }: {
  values: number[]; stroke: string; fill?: string; height?: number; width?: number;
}) {
  if (!values.length) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = points.join(' ');
  const area = fill ? `M0,${height} L${line.replace(/ /g, ' L')} L${((values.length - 1) * step).toFixed(1)},${height} Z` : '';
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      {area && <path d={area} fill={fill} opacity={0.15} />}
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

export default function BacktestTrendPanel() {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [tune, setTune] = useState<TuneResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [sR, tR] = await Promise.allSettled([
        fetch('/api/v2/polymarket/backtest-snapshots?limit=168').then(r => r.json()),
        fetch('/api/v2/polymarket/tune-threshold').then(r => r.json()),
      ]);
      if (sR.status === 'fulfilled' && sR.value?.success) {
        setSnaps((sR.value.data.snapshots || []) as Snap[]);
      }
      if (tR.status === 'fulfilled' && tR.value?.success) {
        setTune(tR.value.data.last as TuneResult | null);
      }
      setLastFetch(Date.now());
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  const runTune = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/v2/polymarket/tune-threshold', { method: 'POST' });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error?.message || 'tune failed');
      setTune(j.data as TuneResult);
      setLastFetch(Date.now());
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const pnls = snaps.map(s => s.totalPnlUsd);
  const hits = snaps.map(s => s.hitRate * 100);
  const latestPnl = pnls.length ? pnls[pnls.length - 1] : null;
  const latestHit = hits.length ? hits[hits.length - 1] : null;
  const pnlColor = (n: number | null) => n == null ? C.mutedLight : n > 0 ? C.green : n < 0 ? C.red : C.text;

  return (
    <div style={{ margin: '12px 12px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.mutedLight, textTransform: 'uppercase' }}>Backtest Trend (7d) &amp; Threshold Tuner</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FreshnessBadge timestamp={lastFetch} label="tr" freshMs={300000} staleMs={1800000} />
          <button onClick={fetchAll} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.blue, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            refresh
          </button>
          <button onClick={runTune} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.yellow, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            run tune
          </button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 12px', fontSize: 11, color: C.red }}>error: {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 1, background: C.border }}>
        <div style={{ background: C.surface, padding: '10px 12px' }}>
          <div style={{ fontSize: 9, color: C.mutedLight, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total P&amp;L ({snaps.length} snaps)</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: pnlColor(latestPnl) }}>
              {latestPnl != null ? `$${latestPnl.toFixed(2)}` : '—'}
            </span>
            <Sparkline values={pnls} stroke={pnlColor(latestPnl)} fill={pnlColor(latestPnl)} />
          </div>
        </div>
        <div style={{ background: C.surface, padding: '10px 12px' }}>
          <div style={{ fontSize: 9, color: C.mutedLight, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hit Rate</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: latestHit == null ? C.mutedLight : latestHit >= 55 ? C.green : latestHit >= 45 ? C.yellow : C.red }}>
              {latestHit != null ? `${latestHit.toFixed(1)}%` : '—'}
            </span>
            <Sparkline values={hits} stroke={C.blue} fill={C.blue} />
          </div>
        </div>
      </div>

      {tune && (
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, color: C.mutedLight, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Threshold Sweep · current floor: <span style={{ color: C.text }}>{tune.currentFloor}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {tune.points.map(p => {
              const isBest = tune.recommended?.minEdge === p.minEdge;
              return (
                <span key={p.minEdge} style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 999,
                  border: `1px solid ${isBest ? C.green : C.border}`,
                  background: isBest ? '#00e67614' : C.surfaceAlt,
                  color: p.avgPnlUsd > 0 ? C.green : p.avgPnlUsd < 0 ? C.red : C.mutedLight,
                  fontWeight: isBest ? 700 : 400,
                }}>
                  e≥{p.minEdge} · n={p.evaluated} · avg ${p.avgPnlUsd.toFixed(2)} · hit {(p.hitRate * 100).toFixed(0)}%
                </span>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: C.textDim }}>
            {tune.recommended
              ? <>→ <span style={{ color: C.green, fontWeight: 700 }}>set POLY_EDGE_THRESHOLD={tune.recommended.minEdge}</span> <span style={{ color: C.mutedLight }}>({tune.note})</span></>
              : <span style={{ color: C.yellow }}>{tune.note}</span>}
          </div>
        </div>
      )}

      {!tune && !loading && (
        <div style={{ padding: '10px 12px', fontSize: 11, color: C.mutedLight, borderTop: `1px solid ${C.border}` }}>
          No tune run yet. Click <code style={{ color: C.yellow }}>run tune</code> to sweep edge thresholds.
        </div>
      )}
    </div>
  );
}
