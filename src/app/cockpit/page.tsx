'use client';
/**
 * COCKPIT — Faza 6 Agentic Dashboard (Batch 5: redesign layout global)
 *
 * Per MASTER_BLUEPRINT_V2.md §5:
 *   - Grid asimetric "Cockpit Spațial"
 *   - Cyan + Dark Violet theme, glassmorphism
 *   - Kill Switch repoziționat (Panic Button premium)
 *   - Mounts the 4 Faza 6 components built in Batches 1-4:
 *       AgentStatusHero   (header, canvas Synapse Pulse)
 *       DecisionMatrix    (center, live confidence + AI reasoning)
 *       MoltbookSwarmFeed (lateral, swarm intelligence)
 *       TerminalOverlay   (footer, hacker-console drawer)
 *
 * Data source: /api/dashboard (via useRealtimeData SSE hook).
 */
import { useState, useCallback } from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import AgentStatusHero from '@/components/AgentStatusHero';
import DecisionMatrix from '@/components/DecisionMatrix';
import MoltbookSwarmFeed from '@/components/MoltbookSwarmFeed';
import TerminalOverlay from '@/components/TerminalOverlay';
import BottomNav from '@/components/BottomNav';

const C = {
  bgDeep: '#05020d',
  bgViolet: '#0a0518',
  panelBg: 'rgba(18, 10, 36, 0.62)',
  panelBorder: 'rgba(138, 106, 255, 0.14)',
  panelBorderAccent: 'rgba(0, 229, 255, 0.22)',
  cyan: '#00e5ff',
  violet: '#8a6aff',
  gold: '#ffd740',
  red: '#ff3d57',
  mutedLight: '#7a82a0',
  text: '#dbe3ff',
  textDim: '#8a90b0',
  font: 'ui-monospace, "Segoe UI", -apple-system, sans-serif',
};

// ─── Derive agent state from system + trading telemetry ────
function deriveAgentState(
  killSwitchEngaged: boolean,
  openPositions: number,
  pendingDecisions: number,
  lastThinkMs?: number,
): 'IDLE' | 'PROCESSING' | 'ACTIVE' | 'HALTED' {
  if (killSwitchEngaged) return 'HALTED';
  if (openPositions > 0) return 'ACTIVE';
  if (pendingDecisions > 0 || (lastThinkMs != null && lastThinkMs < 4000)) return 'PROCESSING';
  return 'IDLE';
}

export default function CockpitPage() {
  const { dashboard: dash, bot } = useRealtimeData();
  const [killArmed, setKillArmed] = useState(false);
  const [killing, setKilling] = useState(false);

  const killSwitch = useCallback(async () => {
    if (!killArmed) { setKillArmed(true); setTimeout(() => setKillArmed(false), 4000); return; }
    setKilling(true);
    try {
      await fetch('/api/kill-switch', { method: 'POST' }).catch(() => null);
    } finally { setKilling(false); setKillArmed(false); }
  }, [killArmed]);

  // Pull fields defensively — data may be partial on first render
  const systemMem = dash?.system?.memoryUsageRssMB ?? 0;
  const uptime = dash?.system?.uptime ?? 0;
  const openPositions = dash?.trading?.openPositions ?? 0;
  const pendingDecisions = dash?.trading?.pendingDecisions ?? 0;
  const killEngaged = dash?.killSwitch?.engaged ?? false;
  const totalSignals = dash?.trading?.totalSignals ?? 0;
  const decisions = (bot?.decisions || []) as Parameters<typeof DecisionMatrix>[0]['decisions'];
  const syndicateAudits = (bot?.syndicateAudits || []);
  const gladiatorCount = bot?.gladiators?.length ?? 0;
  const isLiveCount = (bot?.gladiators || []).filter((g) => (g.status || '').toUpperCase() === 'LIVE').length;
  const winRate = (bot?.stats?.overallWinRate ?? 0) / 100;
  const dailyPnl = bot?.stats?.todayPnlPercent ?? 0;
  const lastThinkMs = (dash?.heartbeat as unknown as { lastThinkMs?: number })?.lastThinkMs;

  const agentState = deriveAgentState(killEngaged, openPositions, pendingDecisions, lastThinkMs);

  // Moltbook telemetry (available on dash if wired; fallback empty)
  const moltbook = (dash as unknown as { moltbook?: {
    posts?: { content: string; timestamp: string; sentiment?: 'BULLISH'|'BEARISH'|'NEUTRAL'; confidence?: number; source?: string }[];
    swarmSentiment?: { direction: 'BULLISH'|'BEARISH'|'NEUTRAL'; score: number; insightsProcessed: number; lastUpdated?: string };
    broadcastMessages?: string[];
  } })?.moltbook;

  const logs = (dash?.logs?.recent || []).map(l => ({ ts: l.ts, level: l.level, msg: l.msg }));
  const errorCount1h = logs.filter(l => l.level === 'ERROR' || l.level === 'FATAL').length;

  return (
    <div className="cockpit-root">
      <style jsx global>{`
        @keyframes cockpitSynapseBg {
          0%   { background-position: 0% 0%, 100% 100%; }
          100% { background-position: 100% 50%, 0% 50%; }
        }
        @keyframes killPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,61,87,0.55); }
          50%      { box-shadow: 0 0 0 12px rgba(255,61,87,0); }
        }
        @keyframes matrixPulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.5; }
        }
        .cockpit-root {
          min-height: 100vh;
          background:
            radial-gradient(1200px 800px at 18% 12%, rgba(0,229,255,0.07), transparent 60%),
            radial-gradient(1000px 700px at 82% 88%, rgba(138,106,255,0.09), transparent 60%),
            linear-gradient(135deg, ${C.bgDeep}, ${C.bgViolet});
          color: ${C.text};
          font-family: ${C.font};
          padding: 14px 14px 80px 14px;
          background-size: 200% 200%, 200% 200%, 100% 100%;
          animation: cockpitSynapseBg 30s ease-in-out infinite;
        }
        .glass {
          background: ${C.panelBg};
          border: 1px solid ${C.panelBorder};
          border-radius: 14px;
          backdrop-filter: blur(14px) saturate(140%);
          -webkit-backdrop-filter: blur(14px) saturate(140%);
          box-shadow: 0 6px 36px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.02);
        }
        .glass.accent {
          border-color: ${C.panelBorderAccent};
          box-shadow: 0 6px 36px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,229,255,0.06) inset;
        }
        .kill-cover {
          position: fixed;
          right: 18px; top: 18px;
          z-index: 90;
        }
        .kill-btn {
          width: 54px; height: 54px; border-radius: 14px;
          border: 1px solid ${C.red};
          background: linear-gradient(145deg, #3a0008, #1a0005);
          color: ${C.red};
          font-size: 10px; font-weight: 900; letter-spacing: 0.08em;
          cursor: pointer;
          transition: all 0.18s ease;
          animation: killPulse 2.4s ease-out infinite;
        }
        .kill-btn:hover { transform: scale(1.05); background: linear-gradient(145deg, #4a000a, #2a0008); }
        .kill-btn.armed {
          background: ${C.red};
          color: #fff;
          animation: none;
          box-shadow: 0 0 18px ${C.red};
        }
        .cockpit-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 980px) {
          .cockpit-grid {
            grid-template-columns: minmax(0, 2.2fr) minmax(260px, 1fr);
            grid-template-areas:
              "hero   swarm"
              "matrix swarm";
          }
          .area-hero   { grid-area: hero; }
          .area-matrix { grid-area: matrix; }
          .area-swarm  { grid-area: swarm; }
        }
        .section-wrap { padding: 10px 12px; }
      `}</style>

      {/* ── KILL SWITCH — Panic Button (repositioned, armed-on-hover pattern) ── */}
      <div className="kill-cover">
        <button
          onClick={killSwitch}
          disabled={killing || killEngaged}
          className={`kill-btn ${killArmed ? 'armed' : ''}`}
          title={killEngaged ? 'Kill switch already engaged' : killArmed ? 'Confirm KILL' : 'Kill Switch (click twice to engage)'}
        >
          {killing ? '...' : killEngaged ? 'HALT' : killArmed ? 'CONFIRM' : 'PANIC'}
        </button>
      </div>

      {/* ── Cockpit title strip ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 8px 10px', maxWidth: 1600, margin: '0 auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.28em', color: C.cyan, fontWeight: 700, textTransform: 'uppercase' }}>Cockpit</span>
          <span style={{ fontSize: 9, letterSpacing: '0.2em', color: C.mutedLight, textTransform: 'uppercase' }}>Agentic Mode · Faza 6</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, color: C.mutedLight }}>signals today</span>
          <span style={{ fontSize: 11, color: C.gold, fontWeight: 700, fontFamily: 'monospace' }}>{totalSignals}</span>
          <span style={{ width: 1, height: 12, background: C.panelBorder }} />
          <a href="/dashboard" style={{ fontSize: 9, color: C.cyan, textDecoration: 'none', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Operational →</a>
        </div>
      </div>

      <div className="cockpit-grid" style={{ maxWidth: 1600, margin: '0 auto' }}>
        {/* ── HERO: AgentStatusHero (canvas synapse + cortex state) ── */}
        <div className="glass accent area-hero section-wrap">
          <AgentStatusHero
            agentState={agentState}
            memoryMB={systemMem}
            dailyPnlPercent={dailyPnl}
            openPositions={openPositions}
            pendingDecisions={pendingDecisions}
            uptime={uptime}
            gladiatorCount={gladiatorCount}
            isLiveCount={isLiveCount}
            lastThinkMs={lastThinkMs}
          />
        </div>

        {/* ── CENTER: DecisionMatrix (live confidence + reasoning) ── */}
        <div className="glass area-matrix section-wrap">
          <DecisionMatrix
            decisions={decisions as Parameters<typeof DecisionMatrix>[0]['decisions']}
            syndicateAudits={syndicateAudits as Parameters<typeof DecisionMatrix>[0]['syndicateAudits']}
            winRate={winRate}
            totalDecisions={totalSignals}
            todayPnl={dailyPnl}
          />
        </div>

        {/* ── LATERAL: MoltbookSwarmFeed (swarm intelligence) ── */}
        <div className="glass area-swarm section-wrap">
          <MoltbookSwarmFeed
            posts={moltbook?.posts}
            swarmSentiment={moltbook?.swarmSentiment}
            broadcastMessages={moltbook?.broadcastMessages}
          />
        </div>
      </div>

      {/* ── FOOTER: TerminalOverlay (hacker console drawer) ── */}
      <TerminalOverlay
        logs={logs}
        errorCount1h={errorCount1h}
        defaultOpen={false}
      />

      <BottomNav />
    </div>
  );
}
