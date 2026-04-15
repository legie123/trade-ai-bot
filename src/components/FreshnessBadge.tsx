// ============================================================
// FreshnessBadge — tiny pill showing how old a data point is.
// ADDITIVE. Reusable across widgets. Ticks every second.
//
// Colors map:
//   fresh (<freshMs)       → green
//   aging (<staleMs)       → amber
//   stale (>=staleMs)      → red
//   never / null timestamp → gray
// ============================================================
'use client';

import { useEffect, useState } from 'react';

interface Props {
  /** Unix ms timestamp of data point, or null/undefined for "never". */
  timestamp: number | null | undefined;
  /** Below this age the pill shows green. Default 30s. */
  freshMs?: number;
  /** At/above this age the pill shows red. Default 120s. */
  staleMs?: number;
  /** Optional source label: prepended inside the pill. */
  label?: string;
  /** Inline style override. */
  style?: React.CSSProperties;
}

function fmtAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function FreshnessBadge({ timestamp, freshMs = 30_000, staleMs = 120_000, label, style }: Props) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!timestamp) {
    const base: React.CSSProperties = {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 10,
      fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
      background: '#37415122',
      color: '#9ca3af',
      border: '1px solid #37415155',
      ...style,
    };
    return <span style={base}>{label ? `${label}: ` : ''}no data</span>;
  }

  const age = now - timestamp;
  let color = '#10b981';
  let text = 'fresh';
  if (age >= staleMs) {
    color = '#ef4444';
    text = 'stale';
  } else if (age >= freshMs) {
    color = '#f59e0b';
    text = 'aging';
  }

  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
    background: color + '22',
    color,
    border: `1px solid ${color}55`,
    ...style,
  };

  return (
    <span style={base} title={new Date(timestamp).toISOString()}>
      {label ? `${label}: ` : ''}
      {text} · {fmtAge(age)}
    </span>
  );
}

export default FreshnessBadge;
