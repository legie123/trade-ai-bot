'use client';
/**
 * TerminalOverlay — Faza 6 Agentic Dashboard
 * Hacker-console style log drawer. Two tabs: EXECUTION | NEURAL (AI thoughts).
 * Compact, collapsible, styled as a DevTools drawer.
 */
import { useState, useRef, useEffect } from 'react';

interface LogEntry {
  ts: string;
  level: string;
  msg: string;
}

interface Props {
  logs: LogEntry[];
  errorCount1h?: number;
  defaultOpen?: boolean;
}

const LOG_LEVEL_COLOR: Record<string, string> = {
  ERROR: '#ff3d57',
  FATAL: '#ff3d57',
  WARN: '#ffd740',
  INFO: '#9aa5be',
  DEBUG: '#4b5568',
};

function isAILog(msg: string) {
  return msg.includes('🧠') || msg.includes('Syndicate') || msg.includes('Oracle')
    || msg.includes('Architect') || msg.includes('DualMaster') || msg.includes('FLAT')
    || msg.includes('LONG') || msg.includes('SHORT') || msg.includes('consensus')
    || msg.includes('confidence') || msg.includes('hallucination');
}

function isExecutionLog(msg: string) {
  return msg.includes('MEXC') || msg.includes('order') || msg.includes('position')
    || msg.includes('TP') || msg.includes('SL') || msg.includes('trade')
    || msg.includes('execution') || msg.includes('fill') || msg.includes('PnL')
    || msg.includes('Butcher') || msg.includes('Forge') || msg.includes('Sentinel');
}

function LogLine({ entry, compact }: { entry: LogEntry; compact?: boolean }) {
  const color = LOG_LEVEL_COLOR[entry.level] ?? '#9aa5be';
  const isAI = isAILog(entry.msg);
  const msgColor = isAI ? '#29b6f6' : color;
  const ts = new Date(entry.ts);
  const timeStr = isNaN(ts.getTime()) ? '' : ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      padding: compact ? '1px 0' : '2px 0',
      borderBottom: '1px solid rgba(255,255,255,0.025)',
    }}>
      <span style={{ color: '#2d3748', flexShrink: 0, fontFamily: 'monospace', fontSize: 10 }} suppressHydrationWarning>
        {timeStr}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 700, flexShrink: 0, minWidth: 32,
        color: LOG_LEVEL_COLOR[entry.level] ?? '#4b5568',
      }}>
        {entry.level.slice(0, 4)}
      </span>
      <span style={{
        color: msgColor, fontSize: 11, fontFamily: 'monospace',
        lineHeight: 1.4, wordBreak: 'break-word',
      }}>
        {entry.level === 'ERROR' || entry.level === 'FATAL' ? '✕ '
          : entry.level === 'WARN' ? '⚠ '
          : isAI ? '◈ ' : '› '}
        {entry.msg}
      </span>
    </div>
  );
}

export default function TerminalOverlay({ logs, errorCount1h = 0, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<'ALL' | 'EXECUTION' | 'NEURAL'>('ALL');
  const bottomRef = useRef<HTMLDivElement>(null);

  const filtered = logs.filter(l => {
    if (tab === 'EXECUTION') return isExecutionLog(l.msg);
    if (tab === 'NEURAL') return isAILog(l.msg);
    return true;
  });

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, open, tab]);

  return (
    <div style={{
      background: 'rgba(4,5,11,0.95)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Drawer handle */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer',
          background: 'rgba(0,0,0,0.3)',
          userSelect: 'none',
          borderBottom: open ? '1px solid rgba(255,255,255,0.06)' : 'none',
        }}
      >
        {/* Traffic-light style indicators */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff3d5760' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffd74060' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00e67660' }} />
        </div>

        <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700,
          color: '#6b7891', letterSpacing: '0.1em' }}>
          NEURAL LOGS
        </span>

        {errorCount1h > 0 && (
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 3,
            background: 'rgba(255,61,87,0.15)', color: '#ff3d57',
            border: '1px solid rgba(255,61,87,0.3)', fontWeight: 700,
            animation: 'termBlink 2s infinite',
          }}>
            {errorCount1h} ERR/H
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#4b5568', fontFamily: 'monospace' }}>
          {open ? '▼' : '▲'} {filtered.length} lines
        </span>
      </div>

      {open && (
        <>
          {/* Tab bar */}
          <div style={{
            display: 'flex', gap: 0,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            {(['ALL', 'EXECUTION', 'NEURAL'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '5px 14px', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                  background: tab === t ? 'rgba(0,229,255,0.08)' : 'transparent',
                  border: 'none', borderBottom: tab === t ? '2px solid #00e5ff' : '2px solid transparent',
                  color: tab === t ? '#00e5ff' : '#4b5568',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Log content */}
          <div style={{
            height: 180, overflowY: 'auto', padding: '8px 14px',
            fontFamily: 'monospace',
            scrollbarWidth: 'thin',
          }}>
            {filtered.length === 0 ? (
              <div style={{ color: '#2d3748', fontSize: 11, paddingTop: 8 }}>
                {tab === 'NEURAL' ? 'No AI reasoning logs yet...' : 'No logs yet...'}
              </div>
            ) : (
              <>
                {filtered.map((l, i) => <LogLine key={i} entry={l} compact />)}
                <div ref={bottomRef} />
              </>
            )}
          </div>
        </>
      )}

      <style>{`
        @keyframes termBlink { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}
