/**
 * LiveAnalyticsStrip — institutional explainable telemetry strip.
 *
 * Data source: /api/live-metrics (proxies Grafana Cloud Prom API).
 * Polls every 30s; silently degrades to last-known on fetch failure.
 *
 * Upgraded 2026-04-20 (RUFLO Batch 3.1): every KPI card wrapped in <ExplainCard>
 * with maieutic layer — badges (stale, partial, confidence, source, layer),
 * rationale line, drill-down href.
 *
 * Sections:
 *   1. Live KPI grid (4 cards): Net PnL, Profit Factor, LLM Burn, Pool Lift
 *   2. Cumulative PnL sparkline
 *   3. Pool health strip: size, alive, killed, popPF, popWR, decisions24h
 */
'use client';

import { useEffect, useState } from 'react';
import ExplainCard from './explain/ExplainCard';
import type { ConfidenceLevel } from './explain/Badges';

type QueryStatus = 'ok' | 'error' | 'empty';
type Instant = { value: number | null; ts: number | null; status?: QueryStatus };
type Range = { points: Array<[number, number]>; status?: QueryStatus };
type LiveMetrics = {
  ok: boolean;
  fetchedAt: number;
  instant: Record<string, Instant>;
  range: Record<string, Range>;
  queryHealth?: { total: number; failed: number; empty: number };
};

const C = {
  text: '#f3f0e8',
  mutedLight: '#a89a8a',
  muted: '#6a5f52',
  green: '#4ade80',
  red: '#ef4444',
  blue: '#DAA520',
  border: 'rgba(218,165,32,0.15)',
};

const GRAFANA_STACK = process.env.NEXT_PUBLIC_GRAFANA_STACK_URL || 'https://legie123.grafana.net';
const GRAFANA_EXPLORE = (promql: string) =>
  `${GRAFANA_STACK}/explore?panes=${encodeURIComponent(
    JSON.stringify({
      a: {
        datasource: 'grafanacloud-prom',
        queries: [{ expr: promql, refId: 'A' }],
        range: { from: 'now-24h', to: 'now' },
      },
    }),
  )}`;

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

/** Confidence from sample size — Wilson interval rough proxy. */
function confidenceFromSample(n: number): ConfidenceLevel {
  if (n >= 100) return 'HIGH';
  if (n >= 30) return 'MED';
  if (n >= 5) return 'LOW';
  return 'NONE';
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
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.muted,
          fontSize: 10,
          letterSpacing: '0.1em',
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
  const fetchedAt = data?.fetchedAt ?? null;
  const qh = data?.queryHealth;

  const netPnl = inst.netPnl24h?.value ?? null;
  const pf = inst.pf24h?.value ?? null;
  const llmBurn = inst.llmBurn24h?.value ?? null;
  const lift = inst.selectionLift?.value ?? null;
  const wins = inst.wins24h?.value ?? 0;
  const losses = inst.losses24h?.value ?? 0;
  const totalTrades = (wins || 0) + (losses || 0);
  const wrCalc = totalTrades > 0 ? ((wins || 0) / totalTrades) * 100 : null;
  const poolSize = inst.poolSize?.value ?? null;
  const aliveCnt = inst.alive?.value ?? null;
  const killed = inst.killed?.value ?? null;
  const popPf = inst.popPf?.value ?? null;
  const popWr = inst.popWr?.value ?? null;
  const llmErr = inst.llmErrorRate5m?.value ?? null;
  const decisions24h = inst.decisions24h?.value ?? null;

  const pnlColor = signColor(netPnl);
  const pfColor = pf == null ? C.mutedLight : pf >= 1.3 ? C.green : pf >= 1.0 ? C.blue : C.red;
  const liftColor = lift == null ? C.mutedLight : lift >= 5 ? C.green : lift >= 0 ? C.blue : C.red;
  const llmBurnColor =
    llmBurn == null ? C.mutedLight : llmBurn > 15 ? C.red : llmBurn > 5 ? C.blue : C.green;

  const globalPartial = qh && qh.failed > 0 ? { failed: qh.failed, total: qh.total } : undefined;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: -8,
          flexWrap: 'wrap',
          gap: 8,
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
          LIVE TELEMETRY · PROMETHEUS × GRAFANA · L1→L5 EXPLAIN LAYER
        </span>
        <span
          style={{
            fontSize: 10,
            color: err ? C.red : C.green,
            fontFamily: 'monospace',
            letterSpacing: '0.1em',
          }}
        >
          {err
            ? `● OFFLINE (${err})`
            : data
              ? `● LIVE · ${new Date(data.fetchedAt).toLocaleTimeString()}${
                  qh && qh.failed > 0 ? ` · ${qh.failed}/${qh.total} fail` : ''
                }`
              : '● LOADING'}
        </span>
      </div>

      {/* Live KPI grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16,
        }}
      >
        <ExplainCard
          label="NET PnL 24h"
          value={`${netPnl != null && netPnl >= 0 ? '+' : ''}${fmt(netPnl, 2, '%')}`}
          color={pnlColor}
          glow={netPnl != null && netPnl !== 0 ? `0 0 20px ${pnlColor}40` : undefined}
          sub={`${wins || 0}W / ${losses || 0}L${wrCalc != null ? ` · WR ${wrCalc.toFixed(1)}%` : ''}`}
          timestamp={inst.netPnl24h?.ts ?? fetchedAt}
          confidence={{
            level: confidenceFromSample(totalTrades),
            sampleSize: totalTrades,
            reason:
              totalTrades < 30
                ? 'Small sample — WR bounded by Wilson CI, treat with caution'
                : undefined,
          }}
          partial={inst.netPnl24h?.status === 'error' ? { failed: 1, total: 1 } : globalPartial}
          source={{
            label: 'prom',
            href: GRAFANA_EXPLORE(
              'sum(increase(tradeai_trade_pnl_positive_sum[24h])) - sum(increase(tradeai_trade_pnl_loss_abs_sum[24h]))',
            ),
            query: 'Σ wins_usd − Σ |losses_usd| over 24h',
          }}
          layer="L1"
          rationale="Σ pnl_positive − Σ |pnl_loss|. Source of truth = Prometheus counters."
          drillDownHref="/polymarket?view=decisions"
          drillDownLabel="AUDIT ↗"
        />

        <ExplainCard
          label="PROFIT FACTOR 24h"
          value={fmt(pf, 2)}
          color={pfColor}
          sub={pf != null ? (pf >= 1.3 ? 'Institutional bar' : pf >= 1 ? 'Above break-even' : 'Sub-BE') : ''}
          timestamp={inst.pf24h?.ts ?? fetchedAt}
          confidence={{
            level: confidenceFromSample(totalTrades),
            sampleSize: totalTrades,
            reason:
              totalTrades < 50
                ? 'PF<50 trades is noisy — promotion gate requires n≥50'
                : undefined,
          }}
          partial={inst.pf24h?.status === 'error' ? { failed: 1, total: 1 } : undefined}
          source={{
            label: 'prom',
            href: GRAFANA_EXPLORE(
              'sum(increase(tradeai_trade_pnl_positive_sum[24h])) / clamp_min(sum(increase(tradeai_trade_pnl_loss_abs_sum[24h])), 0.0001)',
            ),
            query: 'gross_wins / gross_losses, clamped',
          }}
          layer="L1"
          rationale={
            pf != null && pf < 1
              ? 'PF < 1.0 means losses > wins. Review regime filter + gladiator lineage.'
              : 'PF ≥ 1.3 = institutional-grade. QW-8 promotion gate requires ≥ 1.3 + n≥50.'
          }
          drillDownHref="/polymarket?view=decisions"
          drillDownLabel="AUDIT ↗"
        />

        <ExplainCard
          label="LLM BURN 24h"
          value={fmtUsd(llmBurn)}
          color={llmBurnColor}
          sub={
            llmErr != null
              ? `Err rate 5m · ${(llmErr * 100).toFixed(2)}%`
              : 'Error rate pending'
          }
          timestamp={inst.llmBurn24h?.ts ?? fetchedAt}
          partial={inst.llmBurn24h?.status === 'error' ? { failed: 1, total: 1 } : undefined}
          confidence={{
            level: llmBurn == null ? 'NONE' : llmBurn > 0 ? 'HIGH' : 'LOW',
            reason:
              llmBurn == null
                ? 'Counter not yet emitted — Batch 4b direct-fetch wiring pending'
                : undefined,
          }}
          source={{
            label: 'prom',
            href: GRAFANA_EXPLORE('sum(increase(tradeai_llm_cost_dollars_total[24h]))'),
            query: 'Σ cost per provider×model over 24h',
          }}
          layer="L1"
          rationale={
            llmBurn != null && llmBurn > 15
              ? 'Burn > $15/24h = review model routing. Consider Haiku for scanner tier.'
              : 'Model routing 70/20/10 (Haiku/Sonnet/Opus). Per-agent attribution in Batch 3.3.'
          }
          drillDownHref="/polymarket?view=cost"
          drillDownLabel="COST ↗"
        />

        <ExplainCard
          label="POOL LIFT"
          value={fmt(lift, 1, '%')}
          color={liftColor}
          sub={
            aliveCnt != null && killed != null
              ? `alive ${aliveCnt.toFixed(0)} / killed ${killed.toFixed(0)}`
              : ''
          }
          timestamp={inst.selectionLift?.ts ?? fetchedAt}
          partial={inst.selectionLift?.status === 'error' ? { failed: 1, total: 1 } : undefined}
          confidence={{
            level: lift == null ? 'NONE' : 'MED',
            reason:
              lift != null && lift < 0
                ? 'Negative lift = pool underperforming baseline. Butcher should rotate.'
                : undefined,
          }}
          source={{
            label: 'prom',
            href: GRAFANA_EXPLORE('tradeai_selection_lift_pct'),
            query: '(pool_pf − baseline_pf) / baseline_pf',
          }}
          layer="L1"
          rationale={
            lift != null && lift < 0
              ? `Lift ${lift.toFixed(1)}% < 0. Forge+butcher rotation signal. See /arena.`
              : 'Selection lift = pool PF vs. baseline. ≥5% = institutional. Audit in butcher.'
          }
          drillDownHref="/arena"
          drillDownLabel="ARENA ↗"
        />
      </div>

      {/* PnL sparkline with explain layer */}
      <ExplainCard
        label="CUMULATIVE NET PnL · 24h"
        value={`${netPnl != null && netPnl >= 0 ? '+' : ''}${fmt(netPnl, 2, '%')}`}
        color={pnlColor}
        sub="Σ WINS − Σ |LOSSES| · 1h step"
        timestamp={fetchedAt}
        partial={
          rng.pnlCumulative?.status === 'error'
            ? { failed: 1, total: 1 }
            : undefined
        }
        confidence={{
          level: confidenceFromSample(totalTrades),
          sampleSize: totalTrades,
        }}
        source={{
          label: 'prom range',
          href: GRAFANA_EXPLORE(
            'sum(tradeai_trade_pnl_positive_sum) - sum(tradeai_trade_pnl_loss_abs_sum)',
          ),
          query: 'PnL cumulative — range query 24h @ 1h',
        }}
        layer="L1"
        rationale={
          rng.pnlCumulative?.points && rng.pnlCumulative.points.length < 3
            ? 'Sparkline needs ≥3 data points — activity accumulating.'
            : 'Trend direction = sign(last − first). Gradient green=up, red=down.'
        }
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, auto) 1fr',
            gap: 24,
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              fontFamily: 'monospace',
              color: pnlColor,
              lineHeight: 1.1,
            }}
          >
            {netPnl != null && netPnl >= 0 ? '+' : ''}
            {fmt(netPnl, 2, '%')}
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
      </ExplainCard>

      {/* Pool health strip — each micro-metric wrapped in compact ExplainCard */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        <ExplainCard
          label="POOL SIZE"
          value={fmt(poolSize, 0)}
          color={C.text}
          compact
          center
          timestamp={inst.poolSize?.ts ?? fetchedAt}
          source={{
            label: 'prom',
            href: GRAFANA_EXPLORE('tradeai_arena_pool_size'),
          }}
          layer="L1"
          rationale="Active gladiators (forged − butchered)."
        />
        <ExplainCard
          label="ALIVE (cum)"
          value={fmt(aliveCnt, 0)}
          color={C.green}
          compact
          center
          timestamp={inst.alive?.ts ?? fetchedAt}
          source={{ label: 'prom', href: GRAFANA_EXPLORE('tradeai_arena_alive_total') }}
          layer="L1"
          rationale="Cumulative alive counter — lifetime, not current."
        />
        <ExplainCard
          label="KILLED (cum)"
          value={fmt(killed, 0)}
          color={C.red}
          compact
          center
          timestamp={inst.killed?.ts ?? fetchedAt}
          source={{ label: 'prom', href: GRAFANA_EXPLORE('tradeai_arena_killed_total') }}
          layer="L1"
          rationale="Cumulative butcher actions — see /arena for reasons."
          drillDownHref="/arena?view=graveyard"
          drillDownLabel="GRAVEYARD ↗"
        />
        <ExplainCard
          label="POP PF"
          value={fmt(popPf, 2)}
          color={popPf == null ? C.mutedLight : popPf >= 1.3 ? C.green : popPf >= 1 ? C.blue : C.red}
          compact
          center
          timestamp={inst.popPf?.ts ?? fetchedAt}
          source={{ label: 'prom', href: GRAFANA_EXPLORE('tradeai_pop_weighted_pf') }}
          layer="L1"
          rationale="Population-weighted PF = selection×execution quality."
        />
        <ExplainCard
          label="POP WR"
          value={popWr == null ? '—' : `${(popWr * 100).toFixed(1)}%`}
          color={
            popWr == null
              ? C.mutedLight
              : popWr >= 0.58
                ? C.green
                : popWr >= 0.5
                  ? C.blue
                  : C.red
          }
          compact
          center
          timestamp={inst.popWr?.ts ?? fetchedAt}
          source={{ label: 'prom', href: GRAFANA_EXPLORE('tradeai_pop_weighted_winrate') }}
          layer="L1"
          rationale="Pop-weighted WR. QW-8 promotion gate ≥ 58%."
        />
        <ExplainCard
          label="DECISIONS 24h"
          value={fmt(decisions24h, 0)}
          color={C.blue}
          compact
          center
          timestamp={inst.decisions24h?.ts ?? fetchedAt}
          confidence={{
            level: confidenceFromSample(decisions24h || 0),
            sampleSize: decisions24h || 0,
          }}
          source={{
            label: 'prom',
            href: GRAFANA_EXPLORE('sum(increase(tradeai_decisions_total[24h]))'),
          }}
          layer="L1"
          rationale="Unique scout+gladiator+market decisions. Audit in decision_audit."
          drillDownHref="/polymarket?view=decisions"
          drillDownLabel="AUDIT ↗"
        />
      </div>
    </section>
  );
}
