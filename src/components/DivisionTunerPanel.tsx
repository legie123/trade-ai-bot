// ============================================================
// DivisionTunerPanel — Phase 2 Batch 11
// Per-division threshold recommendation + active runtime config view.
// ADDITIVE. Self-contained.
// ============================================================
'use client';

import { useEffect, useState, useCallback } from 'react';
import FreshnessBadge from './FreshnessBadge';

interface TunePoint {
  minEdge: number; evaluated: number; hitRate: number;
  avgPnlUsd: number; totalPnlUsd: number;
}
interface Entry {
  division: string; bufferSize: number;
  recommended: TunePoint | null; currentFloor: number; note: string;
}
interface DivResult {
  generatedAt: number; band: number[]; divisions: Entry[];
}
interface ActiveCfg {
  global: number | null;
  perDivision: Record<string, number>;
  updatedAt: number;
}

const C = {
  surface: '#0d1018', surfaceAlt: '#111520', border: '#1a2133',
  green: '#00e676', red: '#ff3d57', yellow: '#ffd600',
  blue: '#29b6f6', mutedLight: '#5a6a85', text: '#c8d4e8', textDim: '#8899b0',
};

export default function DivisionTunerPanel() {
  const [div, setDiv] = useState<DivResult | null>(null);
  const [cfg, setCfg] = useState<ActiveCfg | null>(null);
  const [autopromote, setAutopromote] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [dR, cR] = await Promise.allSettled([
        fetch('/api/v2/polymarket/tune-by-division').then(r => r.json()),
        fetch('/api/v2/polymarket/ranker-config').then(r => r.json()),
      ]);
      if (dR.status === 'fulfilled' && dR.value?.success) setDiv(dR.value.data.last as DivResult | null);
      if (cR.status === 'fulfilled' && cR.value?.success) {
        setCfg(cR.value.data.active as ActiveCfg | null);
        setAutopromote(!!cR.value.data.autopromoteEnabled);
      }
      setLastFetch(Date.now());
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  const runSweep = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/v2/polymarket/tune-by-division', { method: 'POST' });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error?.message || 'sweep failed');
      setDiv(j.data as DivResult);
      // Reload cfg in case auto-promote kicked in
      const c = await fetch('/api/v2/polymarket/ranker-config').then(r => r.json());
      if (c?.success) { setCfg(c.data.active as ActiveCfg | null); setAutopromote(!!c.data.autopromoteEnabled); }
      setLastFetch(Date.now());
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const pnlCol = (n: number | undefined | null) =>
    n == null ? C.mutedLight : n > 0 ? C.green : n < 0 ? C.red : C.text;

  return (
    <div style={{ margin: '12px 12px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.mutedLight, textTransform: 'uppercase' }}>Per-Division Tuner &amp; Active Floors</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FreshnessBadge timestamp={lastFetch} label="div" freshMs={300000} staleMs={1800000} />
          <span style={{ fontSize: 9, color: autopromote ? C.green : C.mutedLight, fontWeight: 700 }}>
            auto-promote: {autopromote ? 'ON' : 'OFF'}
          </span>
          <button onClick={fetchAll} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.blue, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            refresh
          </button>
          <button onClick={runSweep} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.yellow, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            run sweep
          </button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 12px', fontSize: 11, color: C.red }}>error: {err}</div>}

      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.textDim, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ color: C.mutedLight, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active:</span>
        <span style={{ padding: '2px 8px', borderRadius: 999, background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text }}>
          global: <b style={{ color: cfg?.global != null ? C.yellow : C.mutedLight }}>{cfg?.global ?? '—'}</b>
        </span>
        {cfg?.perDivision && Object.entries(cfg.perDivision).map(([d, v]) => (
          <span key={d} style={{ padding: '2px 8px', borderRadius: 999, background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.text }}>
            {d}: <b style={{ color: C.yellow }}>{v}</b>
          </span>
        ))}
      </div>

      {div && div.divisions.length > 0 ? (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {div.divisions.map(e => {
            const r = e.recommended;
            const deltaClr = r == null ? C.mutedLight : r.minEdge > e.currentFloor ? C.red : r.minEdge < e.currentFloor ? C.green : C.text;
            return (
              <div key={e.division} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 10 }}>
                <div style={{ minWidth: 90, fontWeight: 700, color: C.text }}>{e.division}</div>
                <div style={{ minWidth: 50, color: C.mutedLight }}>n={e.bufferSize}</div>
                <div style={{ minWidth: 70, color: C.textDim }}>cur: <b style={{ color: C.text }}>{e.currentFloor}</b></div>
                {r ? (
                  <>
                    <div style={{ minWidth: 70, color: C.textDim }}>→ <b style={{ color: deltaClr }}>{r.minEdge}</b></div>
                    <div style={{ minWidth: 70, color: pnlCol(r.avgPnlUsd) }}>avg ${r.avgPnlUsd.toFixed(2)}</div>
                    <div style={{ minWidth: 55, color: C.mutedLight }}>hit {(r.hitRate * 100).toFixed(0)}%</div>
                    <div style={{ minWidth: 40, color: C.mutedLight }}>s={r.evaluated}</div>
                  </>
                ) : (
                  <div style={{ flex: 1, color: C.mutedLight, fontStyle: 'italic' }}>{e.note}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !loading && <div style={{ padding: '12px', fontSize: 11, color: C.mutedLight }}>
          No per-division tune yet. Click <code style={{ color: C.yellow }}>run sweep</code>.
        </div>
      )}
    </div>
  );
}
