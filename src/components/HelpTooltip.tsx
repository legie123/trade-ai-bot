'use client';

import { useState, useEffect, useRef } from 'react';

export interface HelpSection {
  title: string;
  description: string;
  details?: string[];
  tip?: string;
}

interface HelpTooltipProps {
  section: HelpSection;
  size?: number;        // icon size px, default 14
  position?: 'left' | 'right' | 'center'; // popup alignment
}

export default function HelpTooltip({ section, size = 14, position = 'right' }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const popupLeft =
    position === 'left' ? 'auto' :
    position === 'center' ? '50%' : '0';
  const popupRight = position === 'left' ? '0' : 'auto';
  const popupTransform = position === 'center' ? 'translateX(-50%)' : 'none';

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {/* "?" button */}
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        aria-label={`Help: ${section.title}`}
        style={{
          width: size + 4,
          height: size + 4,
          borderRadius: '50%',
          background: open ? 'rgba(41,182,246,0.25)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${open ? 'rgba(41,182,246,0.6)' : 'rgba(255,255,255,0.12)'}`,
          color: open ? '#29b6f6' : '#6b7891',
          fontSize: size - 3,
          fontWeight: 800,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s ease',
          flexShrink: 0,
          lineHeight: 1,
          padding: 0,
        }}
        onMouseEnter={e => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(41,182,246,0.15)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(41,182,246,0.4)';
            (e.currentTarget as HTMLButtonElement).style.color = '#29b6f6';
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.12)';
            (e.currentTarget as HTMLButtonElement).style.color = '#6b7891';
          }
        }}
      >
        ?
      </button>

      {/* Popup */}
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: popupLeft,
            right: popupRight,
            transform: popupTransform,
            zIndex: 9999,
            width: 300,
            background: 'rgba(10, 13, 24, 0.97)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(41,182,246,0.25)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(41,182,246,0.1)',
            overflow: 'hidden',
            animation: 'helpFadeIn 0.15s ease',
          }}
        >
          <style>{`
            @keyframes helpFadeIn {
              from { opacity: 0; transform: ${popupTransform === 'none' ? 'translateY(-4px)' : 'translateX(-50%) translateY(-4px)'}; }
              to   { opacity: 1; transform: ${popupTransform === 'none' ? 'translateY(0)' : 'translateX(-50%) translateY(0)'}; }
            }
          `}</style>

          {/* Header */}
          <div style={{
            padding: '12px 14px 10px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 3, height: 14, background: '#29b6f6', borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: '#e8ecf4', letterSpacing: '0.08em' }}>
                {section.title}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none', border: 'none', color: '#6b7891',
                cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px',
              }}
            >×</button>
          </div>

          {/* Body */}
          <div style={{ padding: '12px 14px' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#9aa5be', lineHeight: 1.65 }}>
              {section.description}
            </p>

            {section.details && section.details.length > 0 && (
              <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {section.details.map((d, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: '#29b6f6', fontSize: 10, marginTop: 3, flexShrink: 0 }}>▸</span>
                    <span style={{ fontSize: 11, color: '#8090b0', lineHeight: 1.5 }}>{d}</span>
                  </li>
                ))}
              </ul>
            )}

            {section.tip && (
              <div style={{
                marginTop: 10,
                padding: '8px 10px',
                background: 'rgba(255,215,64,0.06)',
                border: '1px solid rgba(255,215,64,0.18)',
                borderRadius: 7,
                display: 'flex',
                gap: 7,
                alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 11, flexShrink: 0 }}>💡</span>
                <span style={{ fontSize: 11, color: '#c8a840', lineHeight: 1.5 }}>{section.tip}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
