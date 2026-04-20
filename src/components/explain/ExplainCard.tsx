/**
 * ExplainCard — reusable institutional-grade card with maieutic explain layer.
 *
 * CONTRACT (L1→L5 operational layer map):
 *   - value + unit      (L1 metric surface)
 *   - rationale         (L2 why-matters / why-this-number)
 *   - badges            (stale · partial · confidence · source · layer)
 *   - drillDownHref     (L3/L4 trace — expand to raw audit / trace view)
 *
 * Extends the previous plain KpiCard visual (monospace, glass-card, glow on non-zero).
 * Badges are additive — when props are omitted, card renders identical to legacy KPI.
 *
 * Kill-switch (soft hide of explain layer, keeps card value visible):
 *   NEXT_PUBLIC_EXPLAIN_BADGES === '0'
 *
 * Added 2026-04-20 (RUFLO Batch 3.1 — institutional orchestration center).
 */
'use client';

import React from 'react';
import {
  BadgeRow,
  ConfidenceBadge,
  ConfidenceLevel,
  LayerBadge,
  Layer,
  PartialBadge,
  SourceBadge,
} from './Badges';
import FreshnessBadge from '../FreshnessBadge';

const C = {
  text: '#f3f0e8',
  mutedLight: '#a89a8a',
  muted: '#6a5f52',
  green: '#4ade80',
  red: '#ef4444',
  blue: '#DAA520',
  border: 'rgba(218,165,32,0.15)',
};

export interface ExplainCardProps {
  /** Card label (shouted caps, letter-spaced). */
  label: string;
  /** Primary display value — already formatted string. */
  value: string;
  /** Value color (sign-coded or regime-coded). */
  color?: string;
  /** Optional glow shadow for high-signal cards. */
  glow?: string;
  /** Secondary line (sub-metric, context). */
  sub?: string;

  // ---- explain layer (all optional, undefined = hidden) ----

  /** Unix ms timestamp of underlying data point. Drives FreshnessBadge. */
  timestamp?: number | null;
  /** Freshness window for "fresh" pill. Default 30s. */
  freshMs?: number;
  /** Threshold above which "stale" triggers. Default 120s. */
  staleMs?: number;

  /** {failed, total} of upstream queries composing this card. */
  partial?: { failed: number; total: number };

  /** Statistical confidence — HIGH/MED/LOW with sample size. */
  confidence?: { level: ConfidenceLevel; sampleSize?: number; reason?: string };

  /** Source-of-truth pointer — shown as clickable pill. */
  source?: { label: string; href?: string; query?: string };

  /** Operational layer (L1 metrics → L5 learn). Default L1. */
  layer?: Layer;

  /** One-line maieutic rationale — what this number MEANS. */
  rationale?: string;

  /** Drill-down URL — opens deeper audit/trace view. */
  drillDownHref?: string;
  /** Drill-down link label override. */
  drillDownLabel?: string;

  /** Render override — lets callers inject custom body (e.g. sparkline). */
  children?: React.ReactNode;

  /** Compact variant (smaller padding/font — used in pool strip). */
  compact?: boolean;

  /** Center-align content (used by pool strip micro-metrics). */
  center?: boolean;
}

function badgesEnabled(): boolean {
  if (typeof process === 'undefined') return true;
  return process.env.NEXT_PUBLIC_EXPLAIN_BADGES !== '0';
}

export function ExplainCard({
  label,
  value,
  color = C.text,
  glow,
  sub,
  timestamp,
  freshMs,
  staleMs,
  partial,
  confidence,
  source,
  layer,
  rationale,
  drillDownHref,
  drillDownLabel,
  children,
  compact = false,
  center = false,
}: ExplainCardProps) {
  const showBadges = badgesEnabled();
  const hasAnyBadge =
    showBadges &&
    (timestamp != null ||
      (partial && partial.failed > 0) ||
      confidence ||
      source ||
      layer);

  const hasFooter = showBadges && (rationale || drillDownHref);

  return (
    <div
      className="glass-card"
      style={{
        padding: compact ? '12px 14px' : '16px 20px',
        textAlign: center ? 'center' : 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 4 : 6,
      }}
    >
      {/* Header row: label + badges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: center ? 'center' : 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          minHeight: 16,
        }}
      >
        <div
          style={{
            fontSize: compact ? 9 : 10,
            color: C.mutedLight,
            fontWeight: 700,
            letterSpacing: '0.15em',
          }}
        >
          {label}
        </div>
        {hasAnyBadge && !center && (
          <BadgeRow>
            {timestamp != null && (
              <FreshnessBadge timestamp={timestamp} freshMs={freshMs} staleMs={staleMs} />
            )}
            {partial && <PartialBadge failed={partial.failed} total={partial.total} />}
            {confidence && (
              <ConfidenceBadge
                level={confidence.level}
                sampleSize={confidence.sampleSize}
                reason={confidence.reason}
              />
            )}
            {source && <SourceBadge label={source.label} href={source.href} query={source.query} />}
            {layer && <LayerBadge layer={layer} />}
          </BadgeRow>
        )}
      </div>

      {/* Main value */}
      {children || (
        <div
          style={{
            fontSize: compact ? 20 : 24,
            fontWeight: 800,
            fontFamily: 'monospace',
            color,
            textShadow: glow || 'none',
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
      )}

      {/* Sub-line */}
      {sub && (
        <div
          style={{
            fontSize: compact ? 9 : 10,
            color: C.muted,
            fontFamily: 'monospace',
          }}
        >
          {sub}
        </div>
      )}

      {/* Compact / center variants — show badges in footer instead of header */}
      {hasAnyBadge && center && (
        <BadgeRow style={{ justifyContent: 'center', marginTop: 2 }}>
          {timestamp != null && (
            <FreshnessBadge timestamp={timestamp} freshMs={freshMs} staleMs={staleMs} />
          )}
          {partial && <PartialBadge failed={partial.failed} total={partial.total} />}
          {confidence && (
            <ConfidenceBadge
              level={confidence.level}
              sampleSize={confidence.sampleSize}
              reason={confidence.reason}
            />
          )}
          {source && <SourceBadge label={source.label} href={source.href} query={source.query} />}
          {layer && <LayerBadge layer={layer} />}
        </BadgeRow>
      )}

      {/* Explain footer — rationale + drill-down */}
      {hasFooter && (
        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            marginTop: compact ? 4 : 6,
            paddingTop: compact ? 6 : 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: 10,
            color: C.mutedLight,
            flexWrap: 'wrap',
          }}
        >
          {rationale && (
            <span
              style={{
                fontStyle: 'italic',
                lineHeight: 1.3,
                flex: 1,
                minWidth: 0,
              }}
              title={rationale}
            >
              {rationale}
            </span>
          )}
          {drillDownHref && (
            <a
              href={drillDownHref}
              style={{
                color: C.blue,
                textDecoration: 'none',
                fontWeight: 700,
                letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
              }}
            >
              {drillDownLabel || 'DRILL ↗'}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default ExplainCard;
