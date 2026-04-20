/**
 * BrainStatusPill — FAZA 3.14 compact nav pill.
 *
 * Server component. Renders a single dot + label (GREEN/AMBER/RED/UNKNOWN)
 * mounted in /polymarket/audit layout nav. Soft-fails to muted pill on error.
 *
 * Hover-title (via title attr) shows top reasons. Click drills into the
 * audit index where BrainScorecard + WatchdogBadge live.
 */
import Link from 'next/link';
import { getBrainStatus, BrainVerdict } from '@/lib/polymarket/brainStatus';

const C = {
  text: '#f3f0e8',
  muted: '#6a5f52',
  mutedLight: '#a89a8a',
  green: '#4ade80',
  red: '#ef4444',
  orange: '#fb923c',
  border: 'rgba(218,165,32,0.15)',
};

function dotColor(v: BrainVerdict): string {
  switch (v) {
    case 'GREEN':  return C.green;
    case 'AMBER':  return C.orange;
    case 'RED':    return C.red;
    default:       return C.mutedLight;
  }
}

export async function BrainStatusPill() {
  let status;
  try {
    status = await getBrainStatus();
  } catch {
    return (
      <div
        title="brain status unavailable"
        style={{
          padding: '4px 10px',
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          color: C.muted,
          fontSize: 10,
          fontFamily: 'monospace',
          letterSpacing: '0.12em',
        }}
      >
        BRAIN · ?
      </div>
    );
  }

  const color = dotColor(status.verdict);
  const tooltip = status.topReasons.length
    ? status.topReasons.join(' · ')
    : `verdict=${status.verdict}`;

  return (
    <Link
      href="/polymarket/audit"
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        border: `1px solid ${color}`,
        borderRadius: 12,
        background: `${color}11`,
        color,
        fontSize: 10,
        fontFamily: 'monospace',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textDecoration: 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px ${color}aa`,
        }}
      />
      BRAIN · {status.verdict}
    </Link>
  );
}
