'use client';

// Sitewide PAPER MODE banner — anti-confuzie cu LIVE.
// Renders only when POLY_LIVE_TRADING_ENABLED is unset/0 (default).
// Hidden in LIVE mode (Phase 8 onwards).
//
// Wire into AppShell.tsx top-of-content in a follow-up commit (kept separate
// to avoid AppShell breakage on first push).
import { useEffect, useState } from 'react';

export default function PaperModeBanner() {
  const [show, setShow] = useState<boolean>(false);
  useEffect(() => {
    // Read public flag baked at build time.
    const liveEnabled = process.env.NEXT_PUBLIC_POLY_LIVE_TRADING_ENABLED === '1';
    setShow(!liveEnabled);
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-label="Paper trading mode active"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        background: 'linear-gradient(90deg, rgb(220 38 38), rgb(239 68 68))',
        color: 'white',
        padding: '6px 12px',
        fontSize: '12px',
        fontWeight: 700,
        textAlign: 'center',
        letterSpacing: '0.05em',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
      }}
    >
      ⚠ PAPER MODE — toate ordinele sunt simulate. Nu se mișcă fonduri reale.
    </div>
  );
}
