'use client';
import React from 'react';

interface Audit {
  id: string;
  timestamp: string;
  symbol: string;
  decision: string;
  confidence: number;
  architect: { direction: string; confidence: number; reasoning: string };
  oracle: { direction: string; confidence: number; reasoning: string };
}

export function SyndicateFeed({ audits }: { audits: Audit[] }) {
  if (!audits || audits.length === 0) {
    return (
      <div style={{ color: '#6b7280', fontSize: '0.85rem', padding: '1rem', textAlign: 'center' }}>
        No Syndicate debates logged yet. Waiting for market signals...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem' }}>
      {audits.slice(0, 5).map((audit) => (
        <div 
          key={audit.id} 
          style={{ 
            background: 'rgba(0,0,0,0.4)', 
            border: '1px solid rgba(255,255,255,0.05)', 
            borderRadius: '12px',
            padding: '1rem',
            animation: 'fadeInUp 0.4s ease-out'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
            <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>$ {audit.symbol}</span>
            <span style={{ 
              color: audit.decision === 'BUY' ? '#10b981' : audit.decision === 'SELL' ? '#ef4444' : '#9ca3af',
              fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)'
            }}>
              {audit.decision} ({Math.round(audit.confidence * 100)}%)
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {/* Architect */}
            <div style={{ position: 'relative', paddingLeft: '1rem', borderLeft: '2px solid #22d3ee' }}>
              <div style={{ fontSize: '0.7rem', color: '#22d3ee', fontWeight: 600, textTransform: 'uppercase', marginBottom: '2px' }}>🏛️ Architect (Logic)</div>
              <div style={{ fontSize: '0.8rem', color: '#e5e7eb', lineHeight: 1.4, fontStyle: 'italic' }}>
                &quot;{audit.architect.reasoning.substring(0, 120)}...&quot;
              </div>
            </div>

            {/* Oracle */}
            <div style={{ position: 'relative', paddingLeft: '1rem', borderLeft: '2px solid #f59e0b' }}>
              <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase', marginBottom: '2px' }}>🔮 Oracle (Sentiment)</div>
              <div style={{ fontSize: '0.8rem', color: '#e5e7eb', lineHeight: 1.4, fontStyle: 'italic' }}>
                &quot;{audit.oracle.reasoning.substring(0, 120)}...&quot;
              </div>
            </div>
          </div>
          
          <div style={{ fontSize: '0.65rem', color: '#6b7280', marginTop: '0.8rem', textAlign: 'right' }}>
            {new Date(audit.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ))}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
