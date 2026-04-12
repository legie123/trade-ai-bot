'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/crypto-radar', icon: '🛰️', label: 'Radar', shortcut: 'R' },
  { href: '/arena',         icon: '🏆', label: 'Arena', shortcut: 'A' },
  { href: '/dashboard',    icon: '📊', label: 'Status', shortcut: 'S' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className={`sidebar ${expanded ? 'sidebar-expanded' : ''}`}
      role="complementary"
      aria-label="Desktop sidebar navigation"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo */}
      <div className="sidebar-logo">
        <span className="sidebar-logo-icon">🐉</span>
        {expanded && <span className="sidebar-logo-text">TRADE AI</span>}
      </div>

      {/* Nav Items */}
      <nav className="sidebar-nav" aria-label="Sidebar navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
              title={item.label}
              aria-label={`${item.label} page`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="sidebar-item-icon" aria-hidden="true">{item.icon}</span>
              {expanded && (
                <span className="sidebar-item-label">{item.label}</span>
              )}
              {expanded && (
                <kbd className="sidebar-kbd">{item.shortcut}</kbd>
              )}
              {isActive && <span className="sidebar-active-bar" />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="sidebar-footer">
        <div className={`sidebar-item`} style={{ cursor: 'default', opacity: 0.5 }}>
          <span className="sidebar-item-icon">⚙️</span>
          {expanded && <span className="sidebar-item-label">Settings</span>}
        </div>
        <div className="sidebar-status">
          <span className="status-dot dot-green" />
          {expanded && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>PAPER MODE</span>}
        </div>
      </div>
    </aside>
  );
}
