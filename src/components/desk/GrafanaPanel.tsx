'use client';

/**
 * GrafanaPanel — FAZA FE-3 (2026-04-26)
 *
 * Iframe wrapper for embedding individual Grafana panels in TRADE AI dashboards.
 * Reads base URL from NEXT_PUBLIC_GRAFANA_BASE_URL env. Adds:
 *  - auto-refresh via timer-driven `key` change (forces iframe reload)
 *  - theme propagation (dragon -> ?theme=dark, institutional -> ?theme=light if forced, else dark)
 *  - kill-switch GRAFANA_PANEL_ENABLED=0 -> renders fallback placeholder
 *  - loading skeleton on first mount + refresh
 *
 * Asumptii care, daca se rup, invalideaza componenta:
 * 1. Grafana instance allows iframe embedding (X-Frame-Options or auth cookies set).
 * 2. Anonymous viewer access is enabled OR the dashboard is publicly viewable.
 * 3. NEXT_PUBLIC_GRAFANA_BASE_URL is set at build time.
 *
 * Kill-switch:
 *  - NEXT_PUBLIC_GRAFANA_PANEL_ENABLED=0 -> renders disabled placeholder, no iframe load.
 */

import { useEffect, useState } from 'react';

type Props = {
  /** Grafana dashboard UID (e.g. "tradeai-premium"). */
  uid: string;
  /** Panel ID inside the dashboard (numeric, viewable in panel URL). */
  panelId: number;
  /** Display height in px. Default 240. */
  height?: number;
  /** Auto-refresh interval in seconds. 0 = no auto-refresh. Default 0. */
  refreshSec?: number;
  /** Time range. Default "now-6h". Grafana relative format. */
  from?: string;
  /** Default "now". */
  to?: string;
  /** Force theme. Default "auto" — resolves from data-ui at render. */
  theme?: 'dark' | 'light' | 'auto';
  /** Title shown above the panel (above iframe). */
  title?: string;
  className?: string;
};

const GRAFANA_BASE = process.env.NEXT_PUBLIC_GRAFANA_BASE_URL ?? '';
const PANEL_ENABLED = process.env.NEXT_PUBLIC_GRAFANA_PANEL_ENABLED !== '0';

function resolveTheme(forced: Props['theme']): 'dark' | 'light' {
  if (forced && forced !== 'auto') return forced;
  // Read from <html data-ui> if available (CSR only)
  if (typeof document !== 'undefined') {
    const ui = document.documentElement.dataset.ui;
    // Institutional palette has light variant in roadmap (TBD); for now both -> dark.
    return ui === 'institutional' ? 'dark' : 'dark';
  }
  return 'dark';
}

export default function GrafanaPanel({
  uid,
  panelId,
  height = 240,
  refreshSec = 0,
  from = 'now-6h',
  to = 'now',
  theme = 'auto',
  title,
  className = '',
}: Props) {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (refreshSec <= 0) return;
    const t = setInterval(() => setRefreshKey(k => k + 1), refreshSec * 1000);
    return () => clearInterval(t);
  }, [refreshSec]);

  if (!PANEL_ENABLED) {
    return (
      <div
        className={`card ${className}`}
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}
      >
        Grafana panels disabled (NEXT_PUBLIC_GRAFANA_PANEL_ENABLED=0)
      </div>
    );
  }

  if (!GRAFANA_BASE) {
    return (
      <div
        className={`card ${className}`}
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}
      >
        NEXT_PUBLIC_GRAFANA_BASE_URL not configured
      </div>
    );
  }

  const resolvedTheme = resolveTheme(theme);
  const params = new URLSearchParams({
    orgId: '1',
    panelId: String(panelId),
    from,
    to,
    theme: resolvedTheme,
    refresh: refreshSec > 0 ? `${refreshSec}s` : '',
  });
  const src = `${GRAFANA_BASE}/d-solo/${uid}?${params.toString()}`;

  return (
    <div className={className}>
      {title && (
        <div
          className="section-label"
          style={{ marginBottom: 6, padding: '4px 0' }}
        >
          {title}
        </div>
      )}
      <iframe
        key={refreshKey}
        src={src}
        width="100%"
        height={height}
        frameBorder={0}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-card)',
        }}
        title={title ?? `Grafana panel ${uid}/${panelId}`}
        loading="lazy"
      />
    </div>
  );
}
