'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface CommandItem {
  id: string;
  icon: string;
  label: string;
  description: string;
  category: 'nav' | 'action' | 'mode';
  action: () => void;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const commands: CommandItem[] = [
    // Navigation — top-level routes
    { id: 'nav-radar', icon: '🛰️', label: 'Go to Radar', description: 'Crypto Radar discovery', category: 'nav', action: () => router.push('/crypto-radar') },
    { id: 'nav-polymarket', icon: '🎯', label: 'Go to Polymarket', description: 'Prediction market trading', category: 'nav', action: () => router.push('/polymarket') },
    { id: 'nav-arena', icon: '🏆', label: 'Go to Arena', description: 'Gladiator battle arena', category: 'nav', action: () => router.push('/arena') },
    { id: 'nav-cockpit', icon: '🚀', label: 'Go to Cockpit', description: 'Orbital command dashboard', category: 'nav', action: () => router.push('/cockpit') },
    { id: 'nav-status', icon: '📊', label: 'Go to Status', description: 'System health dashboard', category: 'nav', action: () => router.push('/dashboard') },
    // Navigation — Polymarket audit suite (FAZA FE-2 extension)
    { id: 'nav-audit-overview', icon: '🧠', label: 'Audit Overview', description: 'Brain Scorecard + watchdog', category: 'nav', action: () => router.push('/polymarket/audit') },
    { id: 'nav-audit-flags', icon: '🚦', label: 'Audit · Flags', description: 'Ops kill-switches catalog (22 envs)', category: 'nav', action: () => router.push('/polymarket/audit/flags') },
    { id: 'nav-audit-graveyard', icon: '⚰️', label: 'Audit · Graveyard', description: 'Killed gladiators + popPF', category: 'nav', action: () => router.push('/polymarket/audit/graveyard') },
    { id: 'nav-audit-brain-history', icon: '📜', label: 'Audit · Brain History', description: 'GREEN/AMBER/RED transitions', category: 'nav', action: () => router.push('/polymarket/audit/brain-history') },
    { id: 'nav-audit-decisions', icon: '⚖️', label: 'Audit · Decisions', description: 'Decision drill-down list', category: 'nav', action: () => router.push('/polymarket/audit') },
    { id: 'nav-audit-scans', icon: '🔍', label: 'Audit · Scans', description: 'Scan run history', category: 'nav', action: () => router.push('/polymarket/audit') },
    { id: 'nav-audit-llm-cost', icon: '💸', label: 'Audit · LLM Cost', description: 'Per-market LLM spend drill-down', category: 'nav', action: () => router.push('/polymarket/audit/llm-cost') },
    { id: 'nav-audit-learning', icon: '🧬', label: 'Audit · Learning', description: 'Adaptation loop telemetry', category: 'nav', action: () => router.push('/polymarket/audit/learning') },
    { id: 'nav-audit-goldsky', icon: '🌐', label: 'Audit · Goldsky', description: 'On-chain pipeline health', category: 'nav', action: () => router.push('/polymarket/audit/goldsky') },
    // Actions
    { id: 'act-evaluate', icon: '▶', label: 'Evaluate Arena', description: 'Run trade evaluator', category: 'action', action: () => { fetch('/api/bot', { method: 'POST', body: JSON.stringify({ action: 'evaluate' }), headers: { 'Content-Type': 'application/json' } }); } },
    { id: 'act-sync', icon: '↻', label: 'Refresh', description: 'Refresh all data feeds', category: 'action', action: () => window.location.reload() },
    { id: 'act-optimize', icon: '🧠', label: 'Run Optimizer', description: 'Optimize strategy weights', category: 'action', action: () => { fetch('/api/bot', { method: 'POST', body: JSON.stringify({ action: 'optimize' }), headers: { 'Content-Type': 'application/json' } }); } },
    { id: 'act-recalc', icon: '📈', label: 'Recalculate Performance', description: 'Rebuild performance metrics', category: 'action', action: () => { fetch('/api/bot', { method: 'POST', body: JSON.stringify({ action: 'recalculate' }), headers: { 'Content-Type': 'application/json' } }); } },
    // Mode toggles
    { id: 'mode-kill', icon: '🛑', label: 'Kill Switch', description: 'Emergency stop all operations', category: 'mode', action: () => { fetch('/api/kill-switch', { method: 'POST', body: JSON.stringify({ action: 'activate', reason: 'Manual kill via command palette' }), headers: { 'Content-Type': 'application/json' } }); } },
  ];

  const filtered = commands.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.description.toLowerCase().includes(query.toLowerCase())
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // ⌘K or Ctrl+K to open
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setOpen(prev => !prev);
      setQuery('');
      setSelectedIndex(0);
    }
    if (e.key === 'Escape') setOpen(false);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const execute = (cmd: CommandItem) => {
    cmd.action();
    setOpen(false);
    setQuery('');
  };

  const handleItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIndex]) execute(filtered[selectedIndex]);
  };

  if (!open) return null;

  const categoryLabels: Record<string, string> = { nav: 'NAVIGATION', action: 'ACTIONS', mode: 'SYSTEM' };
  let lastCat = '';

  return (
    <div className="cmd-overlay" onClick={() => setOpen(false)}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <span className="cmd-search-icon">⌘</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleItemKeyDown}
          />
          <kbd className="cmd-esc">ESC</kbd>
        </div>

        <div className="cmd-results">
          {filtered.length === 0 && (
            <div className="cmd-empty">No commands found</div>
          )}
          {filtered.map((cmd, i) => {
            const showLabel = cmd.category !== lastCat;
            lastCat = cmd.category;
            return (
              <div key={cmd.id}>
                {showLabel && (
                  <div className="cmd-category">{categoryLabels[cmd.category]}</div>
                )}
                <div
                  className={`cmd-item ${i === selectedIndex ? 'cmd-item-active' : ''}`}
                  onClick={() => execute(cmd)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="cmd-item-icon">{cmd.icon}</span>
                  <div className="cmd-item-text">
                    <div className="cmd-item-label">{cmd.label}</div>
                    <div className="cmd-item-desc">{cmd.description}</div>
                  </div>
                  {cmd.category === 'mode' && cmd.id === 'mode-kill' && (
                    <span style={{ fontSize: 9, padding: '2px 6px', background: 'rgba(239,68,68,0.15)', color: 'var(--accent-red)', borderRadius: 4, fontWeight: 700 }}>DANGER</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
