// ============================================================
// SentinelCouplingPanel — Phase 2 Batch 13
// Live status of sentinel→ranker floor coupling.
// ADDITIVE. Self-contained.
// ============================================================
'use client';

import { useEffect, useState, useCallback } from 'react';
import FreshnessBadge from './FreshnessBadge';

interface Report {
  enabled: boolean;
  autopromoteEnabled: boolean;
  metrics: { mdd: number; dailyLosses: number; isHalted: boolean; haltedUntil: string | null };
  decision: 'BASE' | 'WARN' | 'STRESS' | 'HALT' | 'IDLE';
  appliedFloor: number | null;
  activeGlobal: number | null;
  ownFloorActive: boolean;
  lastAppliedAt: number | null;
  timestamp: number;
}

const C = {
  surface: '#0d1018', surfaceAlt: '#111520', border: '#1a2133',
  green: '#00e676', red: '#ff3d57', yellow: '#ffd600',
  blue: '#29b6f6', mutedLight: '#5a6a85', text: '#c8d4e8', textDim: '#8899b0',
};

function decisionColor(d: Report['decision']): string {
  if (d === 'HALT') return C.red;
  if (d === 'STRESS') return C.red;
  if (d === 'WARN') return C.yellow;
  return C.green;
}

export default function SentinelCouplingPanel() {
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const run = useCallback(async (force = false) => {
    setLoading(true); setErr(null);
    try {
      const resp = await fetch('/api/v2/polymarket/sentinel-coupling', {
        method: force ? 'POST' : 'GET',
      });
      const j = await resp.json();
      if (!j?.success) throw new Error(j?.error?.message || 'coupling failed');
      setR(j.data.report as Report);
      setLastFetch(Date.now());
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void run();
    const t = setInterval(() => run(false), 60000);
    return () => clearInterval(t);
  }, [run]);

  const m = r?.metrics;
  const dColor = r ? decisionColor(r.decision) : C.mutedLight;

  return (
    <div style={{ margin: '12px 12px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.mutedLight, textTransform: 'uppercase' }}>Sentinel → Ranker Coupling</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FreshnessBadge timestamp={lastFetch} label="cpl" />
          <span style={{ fontSize: 9, color: r?.enabled ? C.green : C.mutedLight, fontWeight: 700 }}>coupling: {r?.enabled ? 'ON' : 'OFF'}</span>
          <span style={{ fontSize: 9, color: r?.autopromoteEnabled ? C.green : C.mutedLight, fontWeight: 700 }}>promote: {r?.autopromoteEnabled ? 'ON' : 'OFF'}</span>
          <button onClick={() => run(true)} disabled={loading}
            style={{ background: C.surfaceAlt, color: loading ? C.mutedLight : C.yellow, border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
            evaluate
          </button>
        </div>
      </div>

      {err && <div style={{ padding: '8px 12px', fontSize: 11, color: C.red }}>error: {err}</div>}

      {r && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 1, background: C.border }}>
          {[
            { l: 'Decision', v: r.decision, c: dColor },
            { l: 'MDD', v: `${(m!.mdd * 100).toFixed(2)}%`, c: m!.mdd >= 0.07 ? C.red : m!.mdd >= 0.05 ? C.yellow : C.green },
            { l: 'Losses Today', v: m!.dailyLosses.toString(), c: m!.dailyLosses >= 2 ? C.red : m!.dailyLosses >= 1 ? C.yellow : C.green },
            { l: 'Halt', v: m!.isHalted ? 'YES' : 'NO', c: m!.isHalted ? C.red : C.green },
            { l: 'Active Floor', v: r.activeGlobal != null ? r.activeGlobal.toString() : '—', c: C.yellow },
            { l: 'Own Floor', v: r.ownFloorActive ? 'YES' : 'NO', c: r.ownFloorActive ? C.blue : C.mutedLight },
            { l: 'Last Applied', v: r.lastAppliedAt ? new Date(r.lastAppliedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—', c: C.text },
          ].map(k => (
            <div key={k.l} style={{ background: C.surface, padding: '8px 10px' }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: C.mutedLight, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{k.l}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: k.c, marginTop: 2 }}>{k.v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
