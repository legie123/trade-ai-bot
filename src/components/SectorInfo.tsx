'use client';

import { useState } from 'react';

interface SectorInfoProps {
  title: string;
  description: string;
  dataSource: string;
  output: string;
  role: string;
}

export default function SectorInfo({ title, description, dataSource, output, role }: SectorInfoProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={`Info about ${title}`}
        style={{
          width: 22, height: 22, borderRadius: '50%',
          border: '1px solid #2d3748',
          background: open ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
          color: open ? '#3b82f6' : '#64748b',
          fontSize: 11, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s', flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          />
          <div style={{
            position: 'absolute', top: 28, right: 0, zIndex: 9999,
            width: 320, maxWidth: '90vw',
            background: '#0f1419', border: '1px solid #1e293b',
            borderRadius: 8, padding: 14,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            fontSize: 12, lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13, marginBottom: 10, letterSpacing: '0.03em' }}>
              {title}
            </div>
            <div style={{ color: '#94a3b8', marginBottom: 10 }}>{description}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <span style={{ color: '#64748b', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>DATA SOURCE</span>
                <div style={{ color: '#cbd5e1', fontSize: 11 }}>{dataSource}</div>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>OUTPUT</span>
                <div style={{ color: '#cbd5e1', fontSize: 11 }}>{output}</div>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>SYSTEM ROLE</span>
                <div style={{ color: '#cbd5e1', fontSize: 11 }}>{role}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
