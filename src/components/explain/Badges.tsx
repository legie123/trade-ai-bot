/**
 * explain/Badges — composable pill primitives for ExplainCard layer.
 *
 * ADDITIVE. All badges render inline, muted by default, color-coded by semantic state.
 * Used by ExplainCard wrapper + any panel that needs per-surface explainability.
 *
 * Contract: each badge is informationally dense but <= 2 tokens of screen text.
 * Tooltip carries the long-form reason.
 *
 * Badges:
 *   - PartialBadge  — exposes "N of M queries failed" when backend is flaky
 *   - ConfidenceBadge — HIGH/MED/LOW with sample-size disclosure in tooltip
 *   - SourceBadge    — link icon + query URL (Prom, Supabase, API route)
 *   - LayerBadge     — L1/L2/L3/L4/L5 chip for operational transparency
 */
'use client';

import React from 'react';

const pillBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
};

function pillStyle(color: string): React.CSSProperties {
  return {
    ...pillBase,
    background: `${color}22`,
    color,
    border: `1px solid ${color}55`,
  };
}

// ---------- Partial (query failure) ----------

interface PartialProps {
  failed: number;
  total: number;
}

export function PartialBadge({ failed, total }: PartialProps) {
  if (failed <= 0 || total <= 0) return null;
  const color = failed >= total / 2 ? '#ef4444' : '#f59e0b';
  return (
    <span
      style={pillStyle(color)}
      title={`${failed} of ${total} data queries failed to return. Value may be partial or derived from last-known.`}
    >
      ⚠ {failed}/{total} fail
    </span>
  );
}

// ---------- Confidence ----------

export type ConfidenceLevel = 'HIGH' | 'MED' | 'LOW' | 'NONE';

interface ConfidenceProps {
  level: ConfidenceLevel;
  sampleSize?: number;
  reason?: string;
}

export function ConfidenceBadge({ level, sampleSize, reason }: ConfidenceProps) {
  const colors: Record<ConfidenceLevel, string> = {
    HIGH: '#4ade80',
    MED: '#DAA520',
    LOW: '#ef4444',
    NONE: '#6a5f52',
  };
  const label = level === 'NONE' ? 'n/a' : level.toLowerCase();
  const tooltip = [
    `Confidence: ${level}`,
    sampleSize != null ? `Sample size: n=${sampleSize}` : null,
    reason || null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span style={pillStyle(colors[level])} title={tooltip}>
      conf · {label}
      {sampleSize != null && sampleSize > 0 ? ` (n=${sampleSize})` : ''}
    </span>
  );
}

// ---------- Source of truth ----------

interface SourceProps {
  label: string; // e.g. "prom", "supabase", "grafana"
  href?: string;
  query?: string;
}

export function SourceBadge({ label, href, query }: SourceProps) {
  const style: React.CSSProperties = {
    ...pillStyle('#a89a8a'),
    textDecoration: 'none',
    cursor: href ? 'pointer' : 'default',
  };
  const content = (
    <>
      <span style={{ opacity: 0.7 }}>src:</span> {label}
    </>
  );
  if (href) {
    return (
      <a style={style} href={href} target="_blank" rel="noopener noreferrer" title={query || href}>
        {content} ↗
      </a>
    );
  }
  return (
    <span style={style} title={query || label}>
      {content}
    </span>
  );
}

// ---------- Layer (operational transparency L1→L5) ----------

export type Layer = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

const layerMeta: Record<Layer, { color: string; desc: string }> = {
  L1: { color: '#6a5f52', desc: 'L1 METRICS — time-series + health + SLO' },
  L2: { color: '#DAA520', desc: 'L2 EXPLAIN — why/what-next/confidence' },
  L3: { color: '#4ade80', desc: 'L3 TRACE — request → flow → outcome' },
  L4: { color: '#60a5fa', desc: 'L4 AUDIT — immutable decision trail' },
  L5: { color: '#c084fc', desc: 'L5 LEARN — drift, insights, retrospective' },
};

export function LayerBadge({ layer }: { layer: Layer }) {
  const m = layerMeta[layer];
  return (
    <span style={pillStyle(m.color)} title={m.desc}>
      {layer}
    </span>
  );
}

// ---------- Composite: status line used in ExplainCard footer ----------

export function BadgeRow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
