// ============================================================
// LiveIndicator — Real-time connection status display
// Shows connection state with animated pulse, latency, and update count
// ============================================================
'use client';

import { useState, useEffect, useRef } from 'react';

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'polling' | 'error';

interface LiveIndicatorProps {
  status: ConnectionStatus;
  lastUpdate: Date | null;
  updateCount: number;
  onReconnect?: () => void;
}

const statusConfig: Record<ConnectionStatus, { color: string; glow: string; label: string; icon: string }> = {
  connecting: {
    color: '#f59e0b',
    glow: '0 0 10px rgba(245, 158, 11, 0.5)',
    label: 'CONNECTING',
    icon: '🔄',
  },
  connected: {
    color: '#10b981',
    glow: '0 0 12px rgba(16, 185, 129, 0.6)',
    label: 'LIVE',
    icon: '⚡',
  },
  reconnecting: {
    color: '#f59e0b',
    glow: '0 0 10px rgba(245, 158, 11, 0.5)',
    label: 'RECONNECTING',
    icon: '🔄',
  },
  polling: {
    color: '#06b6d4',
    glow: '0 0 10px rgba(6, 182, 212, 0.5)',
    label: 'POLLING',
    icon: '📡',
  },
  error: {
    color: '#ef4444',
    glow: '0 0 10px rgba(239, 68, 68, 0.5)',
    label: 'OFFLINE',
    icon: '🔴',
  },
};

export function LiveIndicator({ status, lastUpdate, updateCount, onReconnect }: LiveIndicatorProps) {
  const [timeSince, setTimeSince] = useState('—');
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(updateCount);

  // Update "time since" every second
  useEffect(() => {
    const update = () => {
      if (!lastUpdate) {
        setTimeSince('—');
        return;
      }
      const secs = Math.round((Date.now() - lastUpdate.getTime()) / 1000);
      if (secs < 2) setTimeSince('NOW');
      else if (secs < 60) setTimeSince(`${secs}s ago`);
      else setTimeSince(`${Math.floor(secs / 60)}m ago`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lastUpdate]);

  // Flash animation via DOM ref (avoids setState in effect)
  useEffect(() => {
    if (updateCount > prevCountRef.current && containerRef.current) {
      containerRef.current.style.background = 'rgba(16, 185, 129, 0.15)';
      containerRef.current.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      const timer = setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.style.background = 'rgba(0, 0, 0, 0.3)';
          containerRef.current.style.borderColor = 'var(--border)';
        }
      }, 600);
      prevCountRef.current = updateCount;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = updateCount;
  }, [updateCount]);

  const cfg = statusConfig[status];

  return (
    <div
      ref={containerRef}
      id="live-indicator"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        background: 'rgba(0, 0, 0, 0.3)',
        borderRadius: 20,
        border: '1px solid var(--border)',
        fontSize: 11,
        transition: 'all 0.3s ease',
        cursor: status === 'error' ? 'pointer' : 'default',
      }}
      onClick={status === 'error' ? onReconnect : undefined}
      title={`${cfg.label} · ${updateCount} updates · ${timeSince}`}
    >
      {/* Animated pulse dot */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: cfg.color,
          boxShadow: cfg.glow,
          animation: status === 'connected'
            ? 'liveIndicatorPulse 2s ease-in-out infinite'
            : status === 'connecting' || status === 'reconnecting'
            ? 'liveIndicatorSpin 1s linear infinite'
            : 'none',
          display: 'inline-block',
        }}
      />

      <span style={{ fontWeight: 600, letterSpacing: '0.05em', color: cfg.color }}>
        {cfg.label}
      </span>

      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
        {timeSince}
      </span>

      <style>{`
        @keyframes liveIndicatorPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        @keyframes liveIndicatorSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
