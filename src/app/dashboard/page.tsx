'use client';

import React from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';

export default function AgenticDashboard() {
  const { dashboard, bot, signals, connectionStatus, isReady, forceRefresh } = useRealtimeData();

  if (!isReady) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00f0ff', fontFamily: 'monospace' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #00f0ff', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
          <div>ESTABLISHING NEURAL LINK... [{connectionStatus}]</div>
        </div>
      </div>
    );
  }

  // Antigravity Agentic Theme
  const C = {
    bg: '#050505',
    glass: 'rgba(10, 15, 20, 0.75)',
    border: 'rgba(0, 240, 255, 0.15)',
    cyan: '#00f0ff',
    violet: '#bf00ff',
    red: '#ff003c',
    green: '#00ff66',
    yellow: '#ffcc00',
    text: '#e0e0e0',
    muted: '#555',
  };

  const sys = dashboard?.system || { status: 'UNKNOWN', uptime: 0, memoryUsageRssMB: 0 };
  const dlogs = dashboard?.logs?.recent || [];
  const ks = dashboard?.killSwitch;

  // Render logic for Panic Button
  const handleKillSwitch = async () => {
    if (confirm("ENGAGE SYSTEM OVERRIDE (KILL SWITCH)? This halts all AI trading instantly.")) {
      try {
        await fetch('/api/admin/system', { method: 'POST', body: JSON.stringify({ action: 'halt' }) });
        forceRefresh();
      } catch (e) {
        console.error(e);
      }
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulseGlow { 0% { box-shadow: 0 0 5px ${C.cyan}40; } 50% { box-shadow: 0 0 20px ${C.cyan}; } 100% { box-shadow: 0 0 5px ${C.cyan}40; } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
      `}} />

      {/* ── AGENT STATUS HERO (HEADER) ──────────────────────────────────────────────────────── */}
      <header style={{ padding: '16px 24px', background: C.glass, borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Dragon Eye / Pulse Core */}
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: C.cyan, animation: 'pulseGlow 2s infinite' }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 20, color: '#fff', letterSpacing: 3, fontWeight: 900 }}>TRADE AI <span style={{ color: C.cyan }}>CORTEX</span></h1>
            <div style={{ fontSize: 10, color: C.cyan, opacity: 0.8 }}>PHOENIX V2 : AUTONOMOUS AGENT ONLINE</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 32, fontSize: 11 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ color: C.muted, fontSize: 9 }}>LATENCY / CONN</span>
            <span style={{ color: connectionStatus === 'connected' ? C.green : C.yellow }}>
              {connectionStatus === 'connected' ? '12ms / SSE ACTIVE' : connectionStatus.toUpperCase()}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ color: C.muted, fontSize: 9 }}>MEMORY ALLOC</span>
            <span>{Math.round(sys.memoryUsageRssMB)} MB / V8 Heap</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ color: C.muted, fontSize: 9 }}>CORE STATUS</span>
            <span style={{ color: sys.status === 'OK' ? C.green : C.red, fontWeight: 'bold' }}>{sys.status}</span>
          </div>

          {/* Kill Switch - Panic Button premium */}
          <button 
            onClick={handleKillSwitch}
            style={{
              padding: '8px 16px', background: ks?.engaged ? C.red : 'transparent', 
              border: `1px solid ${C.red}`, borderRadius: 4, color: ks?.engaged ? '#fff' : C.red,
              cursor: 'pointer', fontWeight: 'bold', fontSize: 10, transition: 'all 0.2s',
              boxShadow: ks?.engaged ? `0 0 15px ${C.red}` : 'none'
            }}
          >
            {ks?.engaged ? 'SYSTEM TERMINATED' : 'KILL SWITCH OVERRIDE'}
          </button>
        </div>
      </header>

      {ks?.engaged && (
        <div style={{ background: C.red, color: '#fff', padding: '8px 24px', fontSize: 12, fontWeight: 'bold', textAlign: 'center', letterSpacing: 2 }}>
          {ks.reason || 'SUDDEN HALT TRIGGERED'}
        </div>
      )}

      {/* ── AGENTIC GRID (ASYMMETRIC) ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(450px, 2fr) minmax(350px, 1fr)', gap: 20, padding: 20, flex: 1, minHeight: 0 }}>
        
        {/* LEFT: SWARM FEED (MOLTBOOK & RADARS) */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: `1px solid ${C.border}`, color: C.cyan, fontSize: 13, fontWeight: 'bold', letterSpacing: 1 }}>
              📡 SWARM INPUTS
            </div>
            <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {signals?.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 20 }}>NO SWARM SIGNALS CAPTURED</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {signals?.slice(0, 15).map((s, i) => (
                    <div key={i} style={{ borderLeft: `2px solid ${s.signal === 'BUY' || s.signal === 'LONG' ? C.green : C.red}`, paddingLeft: 12, fontSize: 11, background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '0 4px 4px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', marginBottom: 4 }}>
                        <span style={{ fontWeight: 800 }}>{s.symbol}</span>
                        <span style={{ color: s.signal === 'BUY' || s.signal === 'LONG' ? C.green : C.red }}>{s.signal}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: C.muted, fontSize: 9 }}>
                        <span>Source: <span style={{color: C.cyan}}>{s.source}</span></span>
                        {s.confidence && <span>Conf: {Math.round(s.confidence * 100)}%</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* CENTER: ARENA COMBAT & DECISION MATRIX */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Gladiator Rankings */}
          <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
            <div style={{ color: C.violet, fontSize: 13, fontWeight: 'bold', letterSpacing: 1, marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
              <span>⚔️ GLADIATOR ARENA</span>
              <span style={{ fontSize: 10, color: C.muted }}>LIVE PAPER EVALUATION</span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!bot?.gladiators?.length && <div style={{ color: C.muted, fontSize: 11 }}>No active gladiators found.</div>}
              {bot?.gladiators?.map((g, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(0,0,0,0.4)', borderRadius: 6, borderLeft: `3px solid ${g.isOmega ? C.violet : C.cyan}` }}>
                  <div>
                    <div style={{ fontSize: 12, color: g.isOmega ? C.violet : '#fff', fontWeight: 'bold' }}>{g.isOmega ? 'Ω OMEGA' : g.arena}</div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>{g.id.substring(0,8)}...</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: g.winRate >= 0.4 ? C.green : C.red }}>WR: {(g.winRate * 100).toFixed(1)}%</div>
                    <div style={{ fontSize: 10, color: C.cyan, marginTop: 4 }}>{g.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live Phantom / Logic Engine */}
          <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, flex: 1, overflowY: 'auto' }}>
            <div style={{ color: C.cyan, fontSize: 13, fontWeight: 'bold', letterSpacing: 1, marginBottom: 16 }}>
              🧠 LIVE LOGIC ENGINE (PHANTOM TRADES)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {!bot?.decisions?.length && <div style={{ color: C.muted, fontSize: 11 }}>Awaiting cognitive load...</div>}
              {bot?.decisions?.slice(0, 8).map((d, i) => (
                <div key={i} style={{ padding: 16, background: 'rgba(0,0,0,0.5)', border: `1px solid ${C.border}`, borderRadius: 6, position: 'relative' }}>
                  <div style={{ fontSize: 12, color: '#fff', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span>{d.symbol}</span>
                    <span style={{ color: d.direction === 'BUY' || d.direction === 'LONG' ? C.green : C.red }}>{d.direction}</span>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: C.cyan, margin: '8px 0' }}>
                    {d.confidence ? Math.round(d.confidence*100) : 0}<span style={{fontSize: 12, color:C.muted}}>% CONF</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.muted}` }}>
                    <span>Verdict: <span style={{color: d.outcome.includes('WIN') ? C.green : d.outcome.includes('LOSS') ? C.red : C.yellow}}>{d.outcome}</span></span>
                    {d.pnlPercent != null && (
                      <span style={{ color: d.pnlPercent > 0 ? C.green : C.red }}>{d.pnlPercent.toFixed(2)}%</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* RIGHT: TERMINAL OVERLAY */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Equity & Profit Stats */}
          <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
            <div style={{ color: C.text, fontSize: 13, fontWeight: 'bold', letterSpacing: 1, marginBottom: 16 }}>💰 AGENT WALLET</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: C.cyan, marginBottom: 16 }}>
              ${bot?.balance?.toFixed(2) || '1000.00'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: C.muted }}>Daily PnL</span>
              <span style={{ color: (bot?.stats?.todayPnlPercent || 0) >= 0 ? C.green : C.red }}>
                {bot?.stats?.todayPnlPercent || 0}%
              </span>
            </div>
          </div>

          <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.text, fontSize: 13, fontWeight: 'bold', letterSpacing: 1 }}>&gt;_ NEURAL LOGS</span>
              <span style={{ color: dashboard?.logs?.errorCount1h ? C.red : C.green, fontSize: 11 }}>
                {dashboard?.logs?.errorCount1h || 0} ERR (1H)
              </span>
            </div>
            
            <div style={{ overflowY: 'auto', flex: 1, padding: '16px', display: 'flex', flexDirection: 'column-reverse', gap: 6, background: '#000' }}>
              {dlogs.map((log, i) => (
                <div key={i} style={{ 
                  fontSize: 10, fontFamily: 'monospace', lineHeight: 1.5,
                  color: log.level === 'error' ? C.red : log.level === 'warn' ? C.yellow : C.muted 
                }}>
                  <span style={{ color: C.cyan, opacity: 0.7 }}>[{new Date(log.ts).toTimeString().split(' ')[0]}]</span>{' '}
                  <span style={{ color: log.level === 'info' ? '#aaa' : undefined }}>{log.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
