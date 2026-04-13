'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/crypto-radar', label: 'Radar', shortcut: 'R', desc: 'Token scanning' },
  { href: '/polymarket',   label: 'Polymarket', shortcut: 'P', desc: 'Prediction markets' },
  { href: '/arena',        label: 'Arena', shortcut: 'A', desc: 'Gladiator battles' },
  { href: '/dashboard',    label: 'Command', shortcut: 'C', desc: 'System health' },
];

const C = {
  bg: '#070a10',
  card: '#0d1117',
  border: '#1b2332',
  borderActive: '#1d4ed8',
  text: '#e2e8f0',
  textMuted: '#64748b',
  textDim: '#475569',
  accent: '#3b82f6',
  accentCyan: '#06b6d4',
  green: '#10b981',
};

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className={`sidebar ${expanded ? 'sidebar-expanded' : ''}`}
      role="complementary"
      aria-label="Desktop sidebar navigation"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        background: C.bg,
        borderRight: `1px solid ${C.border}`,
      }}
    >
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 16px 18px', borderBottom: `1px solid ${C.border}`, marginBottom: 8,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'linear-gradient(135deg, #1d4ed8, #06b6d4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
          T
        </div>
        {expanded && (
          <div style={{ whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: '0.08em' }}>
              TRADE AI
            </div>
            <div style={{ fontSize: 9, color: C.textDim, letterSpacing: '0.1em', fontWeight: 500 }}>
              COMMAND CENTER
            </div>
          </div>
        )}
      </div>

      {/* Nav Items */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 6px', flex: 1 }}>
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
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 7,
                textDecoration: 'none', position: 'relative',
                color: isActive ? '#fff' : C.textMuted,
                background: isActive ? 'rgba(29, 78, 216, 0.12)' : 'transparent',
                borderLeft: isActive ? `2px solid ${C.accent}` : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 6,
                background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isActive ? 'rgba(59, 130, 246, 0.3)' : C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                color: isActive ? C.accent : C.textDim,
                flexShrink: 0,
              }}>
                {item.shortcut}
              </div>
              {expanded && (
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' }}>{item.label}</div>
                  <div style={{ fontSize: 9, color: C.textDim }}>{item.desc}</div>
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '10px 12px', borderTop: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px' }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: C.green, boxShadow: `0 0 6px ${C.green}`,
          }} />
          {expanded && (
            <span style={{ fontSize: 9, color: C.textDim, fontWeight: 600, letterSpacing: '0.1em' }}>
              PAPER MODE
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
