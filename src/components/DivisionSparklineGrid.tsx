// ============================================================
// DivisionSparklineGrid — Phase 2 Batch 13
// Per-division PnL sparklines from snapshots-by-division.
// ADDITIVE. Self-contained. Inline SVG.
// ============================================================
'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import FreshnessBadge from './FreshnessBadge';

interface Row {
  capturedAt: number;
  division: string;
  n: number;
  pnlUsd: number;
  minEdgeScore: number;
}

const C = {
  surface: '#0d1018', surfaceAlt: '#111520', border: '#1a2133',
  green: '#00e676', red: '#ff3d57', yellow: '#ffd600',
  blue: '#29b6f6', mutedLight: '#5a6a85', text: '#c8d4e8', textDim: '#8899b0',
};

function downsample(arr: number[], max = 200): number[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

function Sparkline({ values: rawValues, stroke, width = 140, height = 28 }: { values: number[]; stroke: string; width?: number; height?: number }) {
  const values = downsample(rawValues);
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = (max - min) || 1;
  const step = width / (values.length - 1);
  const line = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`).join(' ');
  // zero line
  const zeroY = height - ((0 - min) / span) * height;
  return (
    <svg width={width} height={height}>
      <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={C.border} strokeWidth={1} strokeDasharray="2,2" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

export default function DivisionSparklineGrid() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/v2/polymarket/snapshots-by-division?limit=1500');
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error?.message || 'fetch failed');
      setRows((j.data.rows || []) as Row[]);
      setLastFetch(Date.now());
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  const capture = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      await fetch('/api/v2/polymarket/snapshots-by-division?minEdge=50', { method: 'POST' });
      await fetchRows();
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [fetchRows]);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  const byDiv = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      if (!map.has(r.division)) map.set(r.division, []);
      map.get(r.division)!.push(r);
    }
    // Sort each by time ascending
    for (const arr of map.values()) arr.sort((a, b) => a.capturedAt - b.capturedAt);
    return map;
  }, [rows]);

  // Rank by cumulative P&L descending
  const ranked = useMemo(() => {
    const out: Array<{ division: string; series: number[]; cum: number; latest: number; n: number }> = [];
    for (const [div, arr] of byDiv.entries()) {
      const series = arr.map(r => r.pnlUsd);
      const cum = series.reduce((a, b) => a + b, 0);
      const latest = series[series.length - 1] ?? 0;
      const n = arr[arr.length - 1]?.n ?? 0;
      out.push({ division: div, series, cum, latest, n });
    }
    return out.sort((a, b) => b.cum - a.cum);
  }, [byDiv]);

  const pnlCol = (n: number) => n > 0 ? C.green : n < 0 ? C.red : C.text;

  return (
    <div style={{ margin: '12px 12px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.mutedLight, textTransform: 'uppercase' }}>Per-Division P&amp;L Trend</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FreshnessBadge timestamp={lastFetch} label="div-t" freshMs={600000} staleMs={3600000} />
          <button onClick={fetchRows} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.blue, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            refresh
          </button>
          <button onClick={capture} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.yellow, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            capture
          </button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 12px', fontSize: 11, color: C.red }}>error: {err}</div>}

      {ranked.length === 0 && !loading && (
        <div style={{ padding: '12px', fontSize: 11, color: C.mutedLight }}>
          No division snapshots yet. Click <code style={{ color: C.yellow }}>capture</code>.
        </div>
      )}

      {ranked.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 1, background: C.border }}>
          {ranked.map(d => (
            <div key={d.division} style={{ background: C.surface, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.text }}>{d.division}</span>
                <span style={{ fontSize: 9, color: C.mutedLight }}>n={d.n} · {d.series.length}pt</span>
              </div>
              <Sparkline values={d.series} stroke={pnlCol(d.cum)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 2 }}>
                <span style={{ color: C.mutedLight }}>cum</span>
                <span style={{ color: pnlCol(d.cum), fontWeight: 700 }}>${d.cum.toFixed(2)}</span>
                <span style={{ color: C.mutedLight }}>last</span>
                <span style={{ color: pnlCol(d.latest), fontWeight: 700 }}>${d.latest.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
