'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Radar, Target, Trophy, Rocket, BarChart3 } from 'lucide-react';
import DragonLogo from './DragonLogo';

/**
 * Sidebar — FAZA FE-2 (2026-04-26)
 *
 * Each nav item carries BOTH an emoji (Dragon theme) and a Lucide icon
 * (Institutional theme). CSS in icons-fe2.css hides the inactive set based
 * on `:root[data-ui]` attr. Zero JS-side theme branching.
 *
 * Asumptie: Lucide icons render correctly when wrapped in <span class="icon-lucide">.
 * If Lucide tree-shaking breaks, fallback: drop the import and rely on emoji only.
 */
const NAV_ITEMS = [
  { href: '/crypto-radar', emoji: '🛰️', Icon: Radar,    label: 'Radar',      shortcut: 'R' },
  { href: '/polymarket',   emoji: '🎯', Icon: Target,   label: 'Polymarket', shortcut: 'P' },
  { href: '/arena',        emoji: '🏆', Icon: Trophy,   label: 'Arena',      shortcut: 'A' },
  { href: '/cockpit',      emoji: '🚀', Icon: Rocket,   label: 'Cockpit',    shortcut: 'C' },
  { href: '/dashboard',    emoji: '📊', Icon: BarChart3,label: 'Status',     shortcut: 'S' },
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
        <span className="sidebar-logo-icon"><DragonLogo size={expanded ? 56 : 44} /></span>
        {expanded && <span className="sidebar-logo-text">TRADE AI</span>}
      </div>

      {/* Nav Items */}
      <nav className="sidebar-nav" aria-label="Sidebar navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const { Icon } = item;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
              title={item.label}
              aria-label={`${item.label} page`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="sidebar-item-icon" aria-hidden="true">
                {/* Dragon: emoji visible. Institutional: Lucide visible. CSS toggles. */}
                <span className="icon-emoji">{item.emoji}</span>
                <span className="icon-lucide"><Icon size={18} strokeWidth={1.75} /></span>
              </span>
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
        <div className="sidebar-status">
          <span className="status-dot dot-green" />
          {expanded && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>PAPER MODE</span>}
        </div>
      </div>
    </aside>
  );
}
