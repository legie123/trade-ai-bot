'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/crypto-radar', label: 'Radar', shortcut: 'R' },
  { href: '/polymarket',   label: 'Poly', shortcut: 'P' },
  { href: '/arena',        label: 'Arena', shortcut: 'A' },
  { href: '/dashboard',    label: 'CMD', shortcut: 'C' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="bottom-nav"
      role="navigation"
      aria-label="Main navigation"
      style={{ paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))' }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`bottom-nav-item ${isActive ? 'active' : ''}`}
            aria-label={`${item.label} page`}
            aria-current={isActive ? 'page' : undefined}
            style={{ color: isActive ? '#3b82f6' : '#475569' }}
          >
            <span style={{
              width: 28, height: 28, borderRadius: 6,
              background: isActive ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
              border: `1px solid ${isActive ? 'rgba(59, 130, 246, 0.25)' : 'transparent'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            }}>
              {item.shortcut}
            </span>
            <span className="bottom-nav-label">{item.label}</span>
            {isActive && <span className="bottom-nav-indicator" style={{ background: '#3b82f6', boxShadow: '0 0 8px rgba(59, 130, 246, 0.6)' }} />}
          </Link>
        );
      })}
    </nav>
  );
}
