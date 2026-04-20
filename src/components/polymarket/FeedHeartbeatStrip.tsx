/**
 * FeedHeartbeatStrip — nav-bar liveness strip for /polymarket/audit/*.
 *
 * FAZA 3.4. Consumes /api/v2/polymarket/feed-health (30s poll). Renders
 * each critical feed as a pill badge. Aggregate color borrows worst-of
 * semantics so operators catch a dead feed without opening the goldsky
 * drill-down page.
 *
 * Contract:
 *   - Self-contained client component (no server-render dependency).
 *   - SSR-safe: renders placeholder skeletons until first fetch resolves.
 *   - Kill-switch: if NEXT_PUBLIC_EXPLAIN_BADGES='0', still renders
 *     (this IS operational, not decorative). Use NEXT_PUBLIC_HEARTBEAT_STRIP='0'
 *     to suppress entirely.
 *
 * Layer: L1 (metrics). Source: /api/v2/polymarket/feed-health.
 */
'use client';

import React, { useEffect, useState } from 'react';

type FeedStatus = 'fresh' | 'aging' | 'stale' | 'unconfigured' | 'error';

interface FeedSnapshot {
  name: string;
  status: FeedStatus;
  lastTick: number | null;
  lagSeconds: number | null;
  note: string;
  sourceHref?: string;
}

interface FeedHealthAggregate {
  generatedAt: number;
  aggregateStatus: FeedStatus;
  feeds: FeedSnapshot[];
  criticalFeeds: string[];
  staleFeeds: string[];
}

const COLORS: Record<FeedStatus, string> = {
  fresh: '#4ade80',
  aging: '#fb923c',
  stale: '#ef4444',
  error: '#ef4444',
  unconfigured: '#6a5f52',
};

const LABELS: Record<FeedStatus, string> = {
  fresh: 'OK',
  aging: 'SLOW',
  stale: 'STALE',
  error: 'ERR',
  unconfigured: 'N/C',
};

function fmtLag(s: number | null): string {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

const POLL_MS = 30_000;

export function FeedHeartbeatStrip() {
  const [data, setData] = useState<FeedHealthAggregate | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch('/api/v2/polymarket/feed-health', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as FeedHealthAggregate;
        if (!cancelled) {
          setData(json);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (process.env.NEXT_PUBLIC_HEARTBEAT_STRIP === '0') return null;

  if (!data && !err) {
    // First-paint skeleton (SSR-safe, no timestamp differences)
    return (
      <div style={wrapStyle}>
        <span style={labelStyle}>FEEDS</span>
        <span style={skeletonStyle}>· loading</span>
      </div>
    );
  }

  if (err && !data) {
    return (
      <div style={wrapStyle}>
        <span style={labelStyle}>FEEDS</span>
        <span style={{ ...pillStyle(COLORS.error), fontSize: 10 }}>probe failed</span>
      </div>
    );
  }

  const agg = data!;
  const aggColor = COLORS[agg.aggregateStatus];

  return (
    <div style={wrapStyle} title={buildAggTooltip(agg)}>
      <span style={labelStyle}>FEEDS</span>
      <span
        style={{
          ...pillStyle(aggColor),
          fontWeight: 700,
          letterSpacing: '0.1em',
        }}
      >
        {LABELS[agg.aggregateStatus]}
      </span>
      <span style={{ color: '#6a5f52', fontSize: 10 }}>·</span>
      {agg.feeds.map((f) => {
        const c = COLORS[f.status];
        const isCritical = agg.criticalFeeds.includes(f.name);
        const href = f.sourceHref;
        const content = (
          <span
            key={f.name}
            title={`${f.name} · ${f.status} · lag=${fmtLag(f.lagSeconds)}\n${f.note}`}
            style={{
              ...pillStyle(c),
              opacity: isCritical ? 1 : 0.7,
              cursor: href ? 'pointer' : 'default',
            }}
          >
            <span style={{ fontWeight: 600 }}>{f.name}</span>
            <span style={{ opacity: 0.7, marginLeft: 4 }}>{fmtLag(f.lagSeconds)}</span>
          </span>
        );
        if (!href) return <React.Fragment key={f.name}>{content}</React.Fragment>;
        return (
          <a
            key={f.name}
            href={href}
            style={{ textDecoration: 'none' }}
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}

function buildAggTooltip(agg: FeedHealthAggregate): string {
  const stale = agg.staleFeeds.length > 0 ? `\nstale: ${agg.staleFeeds.join(', ')}` : '';
  const ts = new Date(agg.generatedAt).toISOString();
  return `aggregate=${agg.aggregateStatus}\ncritical=${agg.criticalFeeds.join(
    ', '
  )}${stale}\nchecked=${ts}`;
}

// ---------- styling ----------

const wrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
};

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.2em',
  color: '#6a5f52',
  fontWeight: 700,
};

const skeletonStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#6a5f52',
  opacity: 0.7,
};

function pillStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    background: `${color}22`,
    color,
    border: `1px solid ${color}55`,
    lineHeight: 1.4,
  };
}
