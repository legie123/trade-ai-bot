'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Toast Notification System
 * Provides visual feedback for command execution, errors, and info.
 * Auto-dismisses after 3s. Stacks up to 5 toasts.
 * Fixed position — visible regardless of scroll.
 */

export interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  detail?: string;
}

let toastCounter = 0;

const COLORS = {
  success: { bg: 'rgba(0,230,118,0.12)', border: 'rgba(0,230,118,0.3)', text: '#00e676', icon: '✓' },
  error:   { bg: 'rgba(220,20,60,0.12)', border: 'rgba(220,20,60,0.3)', text: '#DC143C', icon: '✕' },
  warning: { bg: 'rgba(255,215,64,0.12)', border: 'rgba(255,215,64,0.3)', text: '#ffd740', icon: '⚠' },
  info:    { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', text: '#3b82f6', icon: 'ℹ' },
};

const MAX_TOASTS = 5;
const DISMISS_MS = 3500;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const toast = useCallback((type: ToastItem['type'], message: string, detail?: string) => {
    const id = ++toastCounter;
    setToasts(prev => {
      const next = [...prev, { id, type, message, detail }];
      // Keep only last N
      return next.slice(-MAX_TOASTS);
    });
    const timer = setTimeout(() => dismiss(id), DISMISS_MS);
    timersRef.current.set(id, timer);
  }, [dismiss]);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
    };
  }, []);

  return { toasts, toast, dismiss };
}

export function ToastContainer({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 60,
      right: 16,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      maxWidth: 360,
      width: '100%',
      pointerEvents: 'none',
    }}>
      {toasts.map(t => {
        const c = COLORS[t.type];
        return (
          <div key={t.id} style={{
            background: c.bg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: `1px solid ${c.border}`,
            borderRadius: 10,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            animation: 'slideInRight 0.25s ease-out',
            pointerEvents: 'auto',
            cursor: 'pointer',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }} onClick={() => dismiss(t.id)}>
            <span style={{ fontSize: 14, color: c.text, fontWeight: 700, lineHeight: 1, marginTop: 1 }}>
              {c.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: c.text, lineHeight: 1.3 }}>
                {t.message}
              </div>
              {t.detail && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, lineHeight: 1.3 }}>
                  {t.detail}
                </div>
              )}
            </div>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1, flexShrink: 0 }}>✕</span>
          </div>
        );
      })}
    </div>
  );
}
