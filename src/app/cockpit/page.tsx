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
import HelpTooltip from '@/components/HelpTooltip';

/* ═══ COCKPIT HELP ═══ */
const COCKPIT_HELP = {
  hero: {
    title: 'Agent Status Hero',
    description: 'Visualizes the AI agent brain in real time — cortex state, memory usage, active positions, and synapse pulse animation reflecting live activity.',
    details: [
      'IDLE: no open trades, waiting for signals',
      'PROCESSING: AI is evaluating signals or building decisions',
      'ACTIVE: live positions open, agent managing trades',
      'HALTED: kill switch engaged — no new actions until disengaged',
    ],
    tip: 'Synapse pulse frequency increases with activity. A flat line means the agent is truly idle or the data feed is disconnected.',
  },
  matrix: {
    title: 'Decision Matrix',
    description: 'Live feed of AI decisions — confidence scores, signal sources, syndicate audit results, and reasoning chain for each trade evaluated.',
    details: [
      'Confidence % shows how certain the AI is about the signal',
      'Syndicate audit shows votes from individual AI agents',
      'Win Rate tracks accuracy of the full decision pipeline',
      'Decisions with <60% confidence are usually rejected',
    ],
    tip: 'High daily PnL with low signal count = quality over quantity. That\'s the ideal pattern.',
  },
  swarm: {
    title: 'Moltbook Swarm Feed',
    description: 'Social intelligence layer — aggregated sentiment from monitored accounts, swarm direction, and broadcast messages from the intelligence network.',
    details: [
      'BULLISH / BEARISH / NEUTRAL shows consensus swarm direction',
      'Score 0–1 shows strength of the sentiment signal',
      'Posts are filtered for crypto-relevant content before scoring',
      'Broadcast messages are high-priority alerts from the swarm',
    ],
    tip: 'Swarm sentiment alone does not trigger trades — it\'s one input into the multi-agent decision pipeline.',
  },
  killSwitch: {
    title: 'PANIC / Kill Switch',
    description: 'Emergency stop button. Halts all trading operations instantly — no new positions opened, existing positions can still close naturally.',
    details: [
      'First click: arms the button (turns red, 4-second window)',
      'Second click within 4s: confirms and engages kill switch',
      'HALT state shown when already engaged',
      'Disengage via Control Room → Command Center → Disengage Kill Switch',
    ],
    tip: 'Use during extreme market events, API errors, or if you see abnormal trading behavior. Disengage only after verifying the root cause.',
  },
} as const;

import { C, CockpitAccent } from '@/lib/theme';
// Cockpit-specific panel overrides layered on unified theme
const CP = { ...C, ...CockpitAccent };

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
            linear-gradient(135deg, ${CP.bgDeep}, ${CP.bgViolet});
          color: ${C.text};
          font-family: ${C.font};
          padding: 14px 14px 80px 14px;
          background-size: 200% 200%, 200% 200%, 100% 100%;
          animation: cockpitSynapseBg 30s ease-in-out infinite;
        }
        .glass {
          background: ${CP.panelBg};
          border: 1px solid ${CP.panelBorder};
          border-radius: 14px;
          backdrop-filter: blur(14px) saturate(140%);
          -webkit-backdrop-filter: blur(14px) saturate(140%);
          box-shadow: 0 6px 36px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.02);
        }
        .glass.accent {
          border-color: ${CP.panelBorderAccent};
          box-shadow: 0 6px 36px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,229,255,0.06) inset;
        }
        .kill-cover {
          position: fixed;
          right: 18px; top: 18px;
          z-index: 90;
        }
        @media (max-width: 768px) {
          .kill-cover {
            top: auto;
            bottom: 80px; /* above BottomNav */
            right: 14px;
          }
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
      <div className="kill-cover" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <button
          onClick={killSwitch}
          disabled={killing || killEngaged}
          className={`kill-btn ${killArmed ? 'armed' : ''}`}
          title={killEngaged ? 'Kill switch already engaged' : killArmed ? 'Confirm KILL' : 'Kill Switch (click twice to engage)'}
        >
          {killing ? '...' : killEngaged ? 'HALT' : killArmed ? 'CONFIRM' : 'PANIC'}
        </button>
        <div style={{ opacity: 0.7 }}>
          <HelpTooltip section={COCKPIT_HELP.killSwitch} position="left" size={12} />
        </div>
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
          <span style={{ width: 1, height: 12, background: CP.panelBorder }} />
          <a href="/dashboard" style={{ fontSize: 9, color: C.cyan, textDecoration: 'none', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Operational →</a>
        </div>
      </div>

      <div className="cockpit-grid" style={{ maxWidth: 1600, margin: '0 auto' }}>
        {/* ── HERO: AgentStatusHero (canvas synapse + cortex state) ── */}
        <div className="glass accent area-hero section-wrap">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.18em', color: C.cyan, fontWeight: 700, textTransform: 'uppercase' }}>Agent Cortex</span>
            <HelpTooltip section={COCKPIT_HELP.hero} position="left" />
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.18em', color: C.violet, fontWeight: 700, textTransform: 'uppercase' }}>Decision Matrix</span>
            <HelpTooltip section={COCKPIT_HELP.matrix} position="left" />
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.18em', color: C.mutedLight, fontWeight: 700, textTransform: 'uppercase' }}>Swarm Intelligence</span>
            <HelpTooltip section={COCKPIT_HELP.swarm} position="left" />
          </div>
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
