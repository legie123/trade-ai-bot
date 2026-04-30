/**
 * SectionHeader — FAZA FE-3 (2026-04-26)
 *
 * Institutional uppercase tracking label. Uses --label-* tokens declared in
 * globals.css. Works under both Dragon and Institutional themes (Dragon
 * silently falls back to defaults defined in the .section-label CSS rule).
 *
 * Props are intentionally minimal — keep it a pure label primitive.
 */

import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Optional right-side adornment (count badge, action button, etc.) */
  trailing?: ReactNode;
  className?: string;
};

export default function SectionHeader({ children, trailing, className = '' }: Props) {
  return (
    <div
      className={`section-label ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '4px 0',
      }}
    >
      <span>{children}</span>
      {trailing && <span style={{ textTransform: 'none', letterSpacing: 0 }}>{trailing}</span>}
    </div>
  );
}
