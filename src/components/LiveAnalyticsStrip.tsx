/**
 * LiveAnalyticsStrip — native React display of Grafana-indexed Prometheus
 * metrics for /crypto-radar. Pure SVG, zero chart-lib deps.
 *
 * Data source: /api/live-metrics (proxies Grafana Cloud Prom API).
 * Polls every 30s; silently degrades to last-known on fetch failure.
 *
 * Sections:
 *   1. Live KPI grid (4 cards): Net PnL 24h, Profit Factor, LLM Burn, Pool Lift%
 *   2. Cumulative PnL sparkline (24h, 1h step)
 *   3. Pool health strip: alive / killed / lift / popPF / popWR
 *
 * Added 2026-04-19 (Path B — Grafana data surfaced natively on site).
 */
'use client';

import { useEffect, useState } from 'react';

type Instant = { value: number | null; ts: number | null };
type LiveMetrics = {
  ok: boolean;
  fetchedAt: number;
  instant: Record<string, Instant>;
  range: Record<string, { points: Array<[number, number]> }>;
};

const C = {
  text: '#f3f0e8',
  mutedLight: '#a89a8a',
  muted: '#6a5f52',
  green: '#4ade80',
  red: '#ef4444',
  blue: '#DAA520',
  border: 'rgba(218,165,32,0.15)',
  borderLight: 'rgba(218,165,32,0.25)',
};

const fmt = (v: number | null, digits = 2, suffix = '') =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${suffix}`;

const fmtUsd = (v: number | null, digits = 3) =>
  v == null || !Number.isFinite(v) ? '—' : `$${v.toFixed(digits)}`;

function signColor(v: number | null, good = C.green, bad = C.red, neutral = C.mutedLight) {
  if (v == null) return neutral;
  if (v > 0) return good;
  if (v < 0) return bad;
  return neutral;
}

function Sparkline({
  points,
  width = 240,
  height = 60,
  strokeWidth = 2,
}: {
  points: Array<[number, number]>;
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  if (points.length < 2) {
    return (
      <div
        style={{
          width, height, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.muted, fontSize: 10, letterSpacing: '0.1em',
        }}
      >
        NO DATA
      </div>
    );
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const PAD = 4;
  const px = (x: number) => PAD + ((x - minX) / spanX) * (width - PAD * 2);
  const py = (y: number) => height - PAD - ((y - minY) / spanY) * (height - PAD * 2);

  const lastY = ys[ys.length - 1];
  const firstY = ys[0];
  const isUp = lastY >= firstY;
  const stroke = isUp ? C.green : C.red;

  const path = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${px(x).toFixed(1)} ${py(y).toFixed(1)}`)
    .join(' ');
  const fill =
    `M ${px(points[0][0]).toFixed(1)} ${height - PAD} ` +
    points.map(([x, y]) => `L ${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join(' ') +
    ` L ${px(points[points.length - 1][0]).toFixed(1)} ${height - PAD} Z`;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#spark-grad)" />
      <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
}

function KpiCard({
  label,
  value,
  color,
  sub,
  glow,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
  glow?: string;
}) {
  return (
    <div className="glass-card" style={{ padding: '16px 20px' }}>
      <div
        style={{
          fontSize: 10,
          color: C.mutedLight,
          fontWeight: 700,
          letterSpacing: '0.15em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          fontFamily: 'monospace',
          color,
          textShadow: glow || 'none',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: 'monospace' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function LiveAnalyticsStrip() {
  const [data, setData] = useState<LiveMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/live-metrics', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as LiveMetrics;
        if (!alive) return;
        setData(j);
        setErr(null);
      } catch (e) {
        if (!alive) return;
        setErr((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const inst = data?.instant || {};
  const rng = data?.range || {};

  const netPnl = inst.netPnl24h?.value ?? null;
  const pf = inst.pf24h?.value ?? null;
  const llmBurn = inst.llmBurn24h?.value ?? null;
  const lift = inst.selectionLift?.value ?? null;
  const wins = inst.wins24h?.value ?? 0;
  const losses = inst.losses24h?.value ?? 0;
  const totalTrades = (wins || 0) + (losses || 0);
  const wrCalc = totalTrades > 0 ? ((wins || 0) / totalTrades) * 100 : null;
  const poolSize = inst.poolSize?.value ?? null;
  const alive = inst.alive?.value ?? null;
  const killed = inst.killed?.value ?? null;
  const popPf = inst.popPf?.value ?? null;
  const popWr = inst.popWr?.value ?? null;
  const llmErr = inst.llmErrorRate5m?.value ?? null;

  const pnlColor = signColor(netPnl);
  const pfColor = pf == null ? C.mutedLight : pf >= 1.3 ? C.green : pf >= 1.0 ? C.blue : C.red;
  const liftColor = lift == null ? C.mutedLight : lift >= 5 ? C.green : lift >= 0 ? C.blue : C.red;
  const llmBurnColor =
    llmBurn == null ? C.mutedLight : llmBurn > 15 ? C.red : llmBurn > 5 ? C.blue : C.green;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: -8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: C.mutedLight,
          }}
        >
          LIVE TELEMETRY · PROMETHEUS × GRAFANA
        </span>
        <span
          style={{
            fontSize: 10,
            color: err ? C.red : C.green,
            fontFamily: 'monospace',
            letterSpacing: '0.1em',
          }}
        >
          {err ? `● OFFLINE (${err})` : data ? `● LIVE · ${new Date(data.fetchedAt).toLocaleTimeString()}` : '● LOADING'}
        </span>
      </div>

      {/* Live KPI grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}
      >
        <KpiCard
          label="NET PnL 24h"
          value={`${netPnl != null && netPnl >= 0 ? '+' : ''}${fmt(netPnl, 2, '%')}`}
          color={pnlColor}
          glow={netPnl != null && netPnl !== 0 ? `0 0 20px ${pnlColor}40` : undefined}
          sub={`${wins || 0}W / ${losses || 0}L${wrCalc != null ? ` · WR ${wrCalc.toFixed(1)}%` : ''}`}
        />
        <KpiCard
          label="PROFIT FACTOR 24h"
          value={fmt(pf, 2)}
          color={pfColor}
          sub={pf != null ? (pf >= 1.3 ? 'Institutional bar' : pf >= 1 ? 'Above break-even' : 'Sub-BE') : ''}
        />
        <KpiCard
          label="LLM BURN 24h"
          value={fmtUsd(llmBurn)}
          color={llmBurnColor}
          sub={llmErr != null ? `Err rate 5m · ${(llmErr * 100).toFixed(2)}%` : ''}
        />
        <KpiCard
          label="POOL LIFT"
          value={fmt(lift, 1, '%')}
          color={liftColor}
          sub={alive != null && killed != null ? `alive ${alive.toFixed(0)} / killed ${killed.toFixed(0)}` : ''}
        />
      </div>

      {/* PnL sparkline */}
      <div
        className="glass-card"
        style={{
          padding: '20px 24px',
          display: 'grid',
          gridTemplateColumns: 'minmax(140px, auto) 1fr',
          gap: 24,
          alignItems: 'center',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              color: C.mutedLight,
              fontWeight: 700,
              letterSpacing: '0.15em',
            }}
          >
            CUMULATIVE NET PnL · 24h
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              fontFamily: 'monospace',
              color: pnlColor,
              marginTop: 6,
            }}
          >
            {netPnl != null && netPnl >= 0 ? '+' : ''}
            {fmt(netPnl, 2, '%')}
          </div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 4, letterSpacing: '0.1em' }}>
            Σ WINS − Σ |LOSSES|
          </div>
        </div>
        <div style={{ overflow: 'hidden' }}>
          <Sparkline
            points={rng.pnlCumulative?.points || []}
            width={640}
            height={80}
            strokeWidth={2.5}
          />
        </div>
      </div>

      {/* Pool health strip */}
      <div
        className="glass-card"
        style={{
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 16,
        }}
      >
        {[
          { label: 'POOL SIZE', v: fmt(poolSize, 0), c: C.text },
          { label: 'ALIVE (cum)', v: fmt(alive, 0), c: C.green },
          { label: 'KILLED (cum)', v: fmt(killed, 0), c: C.red },
          { label: 'POP PF', v: fmt(popPf, 2), c: popPf == null ? C.mutedLight : popPf >= 1.3 ? C.green : popPf >= 1 ? C.blue : C.red },
          { label: 'POP WR', v: popWr == null ? '—' : `${(popWr * 100).toFixed(1)}%`, c: popWr == null ? C.mutedLight : popWr >= 0.40 ? C.green : popWr >= 0.5 ? C.blue : C.red },
          { label: 'DECISIONS 24h', v: fmt(inst.decisions24h?.value ?? null, 0), c: C.blue },
        ].map((x) => (
          <div key={x.label} style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 9,
                color: C.mutedLight,
                fontWeight: 700,
                letterSpacing: '0.15em',
                marginBottom: 4,
              }}
            >
              {x.label}
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                fontFamily: 'monospace',
                color: x.c,
              }}
            >
              {x.v}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
