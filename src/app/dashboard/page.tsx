'use client';
/**
 * Dashboard — AGENTIC MODE (Faza 6)
 * Cockpit Spațial layout: AgentStatusHero + 3-column asymmetric grid
 * Left: MoltbookSwarmFeed | Center: DecisionMatrix + EquityCurve | Right: Gladiators
 * Bottom: TerminalOverlay drawer
 */
import { useEffect, useState, useCallback } from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { LiveIndicator } from '@/components/LiveIndicator';
import BottomNav from '@/components/BottomNav';
import EquityCurve from '@/components/EquityCurve';
import AgentStatusHero from '@/components/AgentStatusHero';
import DecisionMatrix from '@/components/DecisionMatrix';
import MoltbookSwarmFeed from '@/components/MoltbookSwarmFeed';
import TerminalOverlay from '@/components/TerminalOverlay';

export default function DashboardPage() {
  const {
    dashboard: data,
    bot,
    connectionStatus,
    lastUpdate,
    updateCount,
    reconnect,
    forceRefresh,
  } = useRealtimeData();

  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [ksLoading, setKsLoading] = useState(false);
  const [ksOpen, setKsOpen] = useState(false);

  useEffect(() => {
    fetch('/api/cron').catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleKillSwitch = useCallback(async (engage: boolean) => {
    setKsLoading(true);
    setKsOpen(false);
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'killswitch', engage }),
      });
      const json = await res.json();
      if (json.status === 'ok') {
        setToast({ msg: engage ? '🔴 Kill Switch engaged — bot halted' : '🟢 Autonomy restored', type: 'ok' });
        await forceRefresh();
      } else {
        setToast({ msg: `Error: ${json.error}`, type: 'err' });
      }
    } catch {
      setToast({ msg: 'Network error', type: 'err' });
    } finally {
      setKsLoading(false);
    }
  }, [forceRefresh]);

  if (!data) {
    return (
      <div style={{
        background: '#07080d', minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16,
        color: '#6b7891', fontFamily: 'system-ui', fontSize: 14,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#00e5ff', opacity: 0.4,
              animation: `bootDot 1.2s ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
        <span style={{ fontSize: 12, letterSpacing: '0.15em', fontWeight: 700 }}>
          CORTEX INITIALIZING
        </span>
        <style>{`@keyframes bootDot{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.4)}}`}</style>
      </div>
    );
  }

  // ── Derive state ────────────────────────────────────────────────
  const system = data.system ?? { status: 'LOADING', uptime: 0, memoryUsageRssMB: 0 };
  const trading = data.trading ?? { totalSignals: 0, pendingDecisions: 0, executionsToday: 0, dailyPnlPercent: 0, openPositions: 0 };
  const killSwitch = data.killSwitch ?? { engaged: false, reason: null };
  const logsData = data.logs ?? { recent: [], errorCount1h: 0 };

  const halted = killSwitch.engaged;
  const status = system.status ?? '';
  const isCritical = halted || status.includes('CRITICAL') || status.includes('HALTED');
  const isWarning = !isCritical && (status.includes('WARNING') || status.includes('OBSERVATION'));
  const systemColor = isCritical ? '#ff3d57' : isWarning ? '#ffd740' : '#00e5ff';

  const agentState: string = halted ? 'HALTED'
    : trading.pendingDecisions > 0 ? 'PROCESSING'
    : trading.openPositions > 0 ? 'ACTIVE'
    : 'IDLE';

  const gladiators = bot?.gladiators ?? [];
  const nonOmegaGladiators = gladiators.filter(g => !g.isOmega);
  const liveCount = nonOmegaGladiators.filter(g => g.status === 'ACTIVE').length;

  const broadcastMessages: string[] = (bot?.syndicateAudits ?? [])
    .slice(0, 5)
    .map(a => `${a.symbol}: ${a.decision} @ ${(a.confidence * 100).toFixed(0)}% conf`);

  // Derive swarm sentiment from bot stats
  const todayWR = bot?.stats?.todayWinRate ?? 0;
  const swarmSentiment = bot?.stats ? {
    direction: (todayWR >= 0.5 ? 'BULLISH' : todayWR >= 0.35 ? 'NEUTRAL' : 'BEARISH') as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    score: Math.round(todayWR * 100),
    insightsProcessed: bot.stats.todayDecisions ?? 0,
  } : undefined;

  return (
    <div style={{
      minHeight: '100vh', background: '#07080d', color: '#e8ecf4',
      paddingBottom: 80,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
    }}>
      <style>{`
        @keyframes agentSlide { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes agentDot { 0%,100%{opacity:1} 50%{opacity:0.3} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>

      {/* ── TOAST ─────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: toast.type === 'ok' ? 'rgba(0,229,255,0.1)' : 'rgba(255,61,87,0.12)',
          border: `1px solid ${toast.type === 'ok' ? '#00e5ff' : '#ff3d57'}`,
          color: '#e8ecf4', backdropFilter: 'blur(12px)',
          animation: 'agentSlide 0.25s ease-out',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── KILL SWITCH CONFIRMATION OVERLAY ─────────── */}
      {ksOpen && !halted && (
        <div
          onClick={() => setKsOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 8000,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0c0f1a', border: '1px solid rgba(255,61,87,0.4)',
              borderRadius: 16, padding: '28px 32px', maxWidth: 340,
              textAlign: 'center', animation: 'agentSlide 0.2s ease-out',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔴</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#ff3d57', marginBottom: 8 }}>
              ACTIVATE KILL SWITCH?
            </div>
            <div style={{ fontSize: 12, color: '#9aa5be', marginBottom: 20, lineHeight: 1.6 }}>
              All trading halts. MEXC positions closed via emergency exit.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setKsOpen(false)} style={{
                flex: 1, padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#9aa5be', cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button onClick={() => handleKillSwitch(true)} disabled={ksLoading} style={{
                flex: 1, padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: 'rgba(255,61,87,0.15)', border: '1px solid rgba(255,61,87,0.5)',
                color: '#ff3d57', cursor: ksLoading ? 'wait' : 'pointer',
                opacity: ksLoading ? 0.6 : 1,
              }}>
                {ksLoading ? '...' : 'CONFIRM HALT'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOP BAR ──────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(7,8,13,0.95)', backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${systemColor}25`,
        padding: '10px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg, #7b2cf5, #00e5ff)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, boxShadow: '0 0 12px rgba(0,229,255,0.25)',
            color: '#fff', fontWeight: 800,
          }}>
            ◈
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: '#e8ecf4' }}>
              TRADE AI
            </div>
            <div style={{ fontSize: 9, color: '#4b5568', letterSpacing: '0.1em', fontWeight: 600 }}>
              PHOENIX V2
            </div>
          </div>
        </div>

        {/* State pill */}
        <div style={{
          padding: '4px 12px', borderRadius: 20,
          display: 'flex', alignItems: 'center', gap: 6,
          background: `${systemColor}12`, border: `1px solid ${systemColor}40`,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: systemColor,
            display: 'inline-block', flexShrink: 0,
            animation: halted ? 'none' : 'agentDot 2s infinite',
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: systemColor, letterSpacing: '0.08em' }}>
            {agentState}
          </span>
        </div>

        {bot?.config?.haltedUntil && new Date(bot.config.haltedUntil) > new Date() && (
          <div style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
            background: 'rgba(255,215,64,0.1)', border: '1px solid #ffd74050', color: '#ffd740',
          }} suppressHydrationWarning>
            COOLDOWN UNTIL {new Date(bot.config.haltedUntil).toLocaleTimeString()}
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <LiveIndicator status={connectionStatus} lastUpdate={lastUpdate}
            updateCount={updateCount} onReconnect={reconnect} />

          {halted ? (
            <button onClick={() => handleKillSwitch(false)} disabled={ksLoading} style={{
              padding: '6px 14px', background: 'rgba(0,230,118,0.1)',
              border: '1px solid #00e67650', borderRadius: 8, color: '#00e676',
              cursor: ksLoading ? 'wait' : 'pointer', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.05em', opacity: ksLoading ? 0.6 : 1,
            }}>
              {ksLoading ? '...' : '⚡ RESTORE AUTONOMY'}
            </button>
          ) : (
            <button
              onClick={() => setKsOpen(true)}
              title="Emergency halt — requires confirmation"
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                letterSpacing: '0.05em', cursor: 'pointer',
                background: 'rgba(255,61,87,0.07)',
                border: '1px solid rgba(255,61,87,0.25)',
                color: 'rgba(255,61,87,0.55)',
                transition: 'all 0.15s',
              }}
            >
              🔴 KILL SWITCH
            </button>
          )}
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────── */}
      <div style={{ padding: '16px 20px 0', maxWidth: 1600, margin: '0 auto' }}>

        {/* Full-width Agent Hero */}
        <AgentStatusHero
          agentState={agentState}
          memoryMB={system.memoryUsageRssMB ?? 0}
          dailyPnlPercent={trading.dailyPnlPercent ?? 0}
          openPositions={trading.openPositions ?? 0}
          pendingDecisions={trading.pendingDecisions ?? 0}
          uptime={system.uptime ?? 0}
          gladiatorCount={nonOmegaGladiators.length}
          isLiveCount={liveCount}
        />

        {/* 3-column Cockpit Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr 280px',
          gap: 14,
          marginBottom: 14,
          alignItems: 'start',
        }}>
          {/* LEFT — Swarm */}
          <div style={{ minHeight: 500 }}>
            <MoltbookSwarmFeed
              posts={[]}
              swarmSentiment={swarmSentiment}
              broadcastLog={broadcastMessages}
            />
          </div>

          {/* CENTER — Decision Matrix + Equity */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <DecisionMatrix
              decisions={bot?.decisions ?? []}
              syndicateAudits={bot?.syndicateAudits ?? []}
              winRate={bot?.stats?.overallWinRate ?? 0}
              totalDecisions={bot?.stats?.totalDecisions ?? 0}
              todayPnl={bot?.stats?.todayPnlPercent ?? 0}
            />
            <div style={{
              background: 'rgba(12,15,26,0.85)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12, padding: '14px 18px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6b7891', marginBottom: 12 }}>
                EQUITY TRAJECTORY
              </div>
              {bot?.equityCurve && bot?.config ? (
                <EquityCurve data={bot.equityCurve} initialBalance={bot.config.paperBalance} />
              ) : (
                <div style={{ color: '#4b5568', fontSize: 12, padding: '20px 0' }}>
                  No equity data yet — awaiting first phantom trades
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Gladiator Roster */}
          <div style={{
            background: 'rgba(12,15,26,0.85)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(0,0,0,0.2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>⚔️</span>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#ffd740' }}>
                  GLADIATOR ARENA
                </span>
              </div>
              <span style={{ fontSize: 9, color: '#6b7891' }}>{liveCount} LIVE</span>
            </div>

            <div style={{ padding: '10px 12px', maxHeight: 460, overflowY: 'auto' }}>
              {nonOmegaGladiators.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#4b5568', fontSize: 12 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>⚔️</div>
                  <div>Arena empty</div>
                  <div style={{ fontSize: 10, marginTop: 4, color: '#2d3748' }}>
                    Forge runs at next cron rotation
                  </div>
                </div>
              ) : (
                nonOmegaGladiators.map(g => {
                  const isActive = g.status === 'ACTIVE';
                  const wr = g.winRate ?? 0;
                  const wrColor = wr >= 45 ? '#00e676' : wr >= 35 ? '#ffd740' : '#ff3d57';
                  return (
                    <div key={g.id} style={{
                      padding: '10px 12px', marginBottom: 6, borderRadius: 8,
                      background: isActive ? 'rgba(255,215,64,0.05)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isActive ? 'rgba(255,215,64,0.2)' : 'rgba(255,255,255,0.04)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                          color: isActive ? '#ffd740' : '#9aa5be',
                          maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {g.id}
                        </span>
                        <span style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                          background: isActive ? 'rgba(255,215,64,0.15)' : 'rgba(255,255,255,0.05)',
                          color: isActive ? '#ffd740' : '#6b7891',
                        }}>
                          {g.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 9, color: '#4b5568', minWidth: 16 }}>WR</span>
                        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                          <div style={{ height: '100%', borderRadius: 2, width: `${Math.min(wr, 100)}%`, background: wrColor }} />
                        </div>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: wrColor, minWidth: 32 }}>
                          {wr.toFixed(0)}%
                        </span>
                      </div>
                      <div style={{ fontSize: 9, color: '#4b5568' }}>{g.arena}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Terminal Overlay */}
        <TerminalOverlay
          logs={logsData.recent}
          errorCount1h={logsData.errorCount1h}
          defaultOpen={false}
        />
      </div>

      <BottomNav />
    </div>
  );
}
