/**
 * StatusChip — FAZA FE-3 (2026-04-26)
 *
 * Unified status pill. Replaces ad-hoc badge variants scattered across pages
 * (.badge-bullish, .badge-bearish, etc.). Uses .pill.pill-{variant} classes
 * from globals.css. Works under both themes — Dragon uses --green/red/amber-bg
 * fallbacks, Institutional uses dedicated --pill-*-bg/fg tokens.
 */

import type { ReactNode } from 'react';

export type ChipVariant = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

type Props = {
  variant: ChipVariant;
  label: string;
  /** Show leading dot indicator. Default true. */
  dot?: boolean;
  /** Optional trailing icon (Lucide) or emoji. */
  trailing?: ReactNode;
  className?: string;
  title?: string;
};

const dotColorVar: Record<ChipVariant, string> = {
  success: 'var(--pill-success-fg, var(--accent-green))',
  warn:    'var(--pill-warn-fg,    var(--accent-amber))',
  danger:  'var(--pill-danger-fg,  var(--accent-red))',
  info:    'var(--pill-info-fg,    var(--accent-blue))',
  neutral: 'var(--pill-neutral-fg, var(--text-secondary))',
};

export default function StatusChip({
  variant,
  label,
  dot = true,
  trailing,
  className = '',
  title,
}: Props) {
  return (
    <span className={`pill pill-${variant} ${className}`} title={title}>
      {dot && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColorVar[variant],
            boxShadow: `0 0 4px ${dotColorVar[variant]}`,
            flexShrink: 0,
          }}
        />
      )}
      <span>{label}</span>
      {trailing}
    </span>
  );
}
