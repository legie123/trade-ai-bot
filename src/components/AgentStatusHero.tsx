'use client';
/**
 * AgentStatusHero — Faza 6 Agentic Dashboard
 * Central "consciousness" display with Synapse Pulse canvas animation.
 * Shows: agent state, memory usage, think latency, gladiator count, PnL.
 */
import { useEffect, useRef } from 'react';

interface Props {
  agentState: 'IDLE' | 'PROCESSING' | 'ACTIVE' | 'HALTED' | string;
  memoryMB: number;
  dailyPnlPercent: number;
  openPositions: number;
  pendingDecisions: number;
  uptime: number; // seconds
  gladiatorCount?: number;
  isLiveCount?: number;
  lastThinkMs?: number; // latency from last LLM call
}

const STATE_COLOR: Record<string, string> = {
  IDLE: '#29b6f6',
  PROCESSING: '#00e5ff',
  ACTIVE: '#ffd740',
  HALTED: '#ff3d57',
};

function getStateColor(state: string) {
  return STATE_COLOR[state] ?? '#9aa5be';
}

function getStateLabel(state: string) {
  const map: Record<string, string> = {
    IDLE: 'CORTEX IDLE — Awaiting Signal',
    PROCESSING: 'SYNTHESIZING — Dual Master Active',
    ACTIVE: 'EXECUTING — Position Open',
    HALTED: 'EMERGENCY HALT — Kill Switch Active',
  };
  return map[state] ?? state;
}

export default function AgentStatusHero({
  agentState,
  memoryMB,
  dailyPnlPercent,
  openPositions,
  pendingDecisions,
  uptime,
  gladiatorCount = 0,
  isLiveCount = 0,
  lastThinkMs,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef(agentState);
  stateRef.current = agentState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1);
    const H = canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
    canvas.style.width = canvas.offsetWidth + 'px';
    canvas.style.height = canvas.offsetHeight + 'px';

    // Node graph / synapse data
    type Node = { x: number; y: number; vx: number; vy: number; r: number; pulse: number; phase: number };
    const nodes: Node[] = Array.from({ length: 22 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: 2 + Math.random() * 3,
      pulse: Math.random(),
      phase: Math.random() * Math.PI * 2,
    }));

    let t = 0;

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      const state = stateRef.current;
      const color = getStateColor(state);
      const speed = state === 'PROCESSING' ? 3.0 : state === 'ACTIVE' ? 1.8 : state === 'HALTED' ? 0.3 : 0.8;

      t += 0.016 * speed;

      // Move nodes
      nodes.forEach(n => {
        n.x += n.vx * speed;
        n.y += n.vy * speed;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
        n.pulse = 0.5 + 0.5 * Math.sin(t * 2 + n.phase);
      });

      // Draw connections
      const CONNECTION_DIST = W * 0.22;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.25 * nodes[i].pulse;
            ctx.strokeStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      nodes.forEach(n => {
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4);
        const alpha = Math.round(n.pulse * 180).toString(16).padStart(2, '0');
        glow.addColorStop(0, color + alpha);
        glow.addColorStop(1, color + '00');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 4, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.fillStyle = color + 'dd';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * n.pulse, 0, Math.PI * 2);
        ctx.fill();
      });

      // Central pulse ring
      const cx = W / 2, cy = H / 2;
      const ringR = 30 + 8 * Math.sin(t * 1.5);
      const ringAlpha = 0.12 + 0.08 * Math.sin(t * 1.5);
      const ring = ctx.createRadialGradient(cx, cy, ringR - 10, cx, cy, ringR + 10);
      ring.addColorStop(0, color + '00');
      ring.addColorStop(0.5, color + Math.round(ringAlpha * 255).toString(16).padStart(2, '0'));
      ring.addColorStop(1, color + '00');
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR + 10, 0, Math.PI * 2);
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const color = getStateColor(agentState);
  const pnlColor = dailyPnlPercent >= 0 ? '#00e676' : '#ff3d57';
  const uptimeH = Math.floor(uptime / 3600);
  const uptimeM = Math.floor((uptime % 3600) / 60);

  return (
    <div style={{
      position: 'relative',
      background: 'rgba(12,15,26,0.85)',
      border: `1px solid ${color}30`,
      borderRadius: 16,
      overflow: 'hidden',
      marginBottom: 16,
      minHeight: 130,
    }}>
      {/* Canvas synapse background */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          opacity: 0.5,
          pointerEvents: 'none',
        }}
      />

      {/* Gradient overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(135deg, ${color}08 0%, transparent 60%, rgba(123,44,245,0.05) 100%)`,
        pointerEvents: 'none',
      }} />

      {/* Content */}
      <div style={{
        position: 'relative', zIndex: 1,
        padding: '16px 24px',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 16,
        alignItems: 'center',
      }}>
        {/* Left: State + label */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            {/* Pulse dot */}
            <span style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
              background: color,
              boxShadow: `0 0 8px ${color}, 0 0 20px ${color}60`,
              animation: agentState === 'HALTED' ? 'none'
                : agentState === 'PROCESSING' ? 'cortexPulse 0.6s infinite'
                : 'cortexPulse 2s infinite',
            }} />
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '0.18em',
              color: color, textTransform: 'uppercase',
            }}>
              AGENT CORTEX
            </span>
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
              background: `${color}18`, border: `1px solid ${color}40`,
              color: color, letterSpacing: '0.05em',
            }}>
              {agentState}
            </span>
          </div>

          <div style={{ fontSize: 13, color: '#9aa5be', marginBottom: 12 }}>
            {getStateLabel(agentState)}
          </div>

          {/* Metric chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'MEM', value: `${memoryMB}MB`, warn: memoryMB > 400 },
              { label: 'UPTIME', value: `${uptimeH}h ${uptimeM}m` },
              { label: 'GLADIATORS', value: `${isLiveCount}/${gladiatorCount} LIVE` },
              ...(lastThinkMs != null
                ? [{ label: 'THINK', value: `${lastThinkMs}ms`, warn: lastThinkMs > 8000 }]
                : []),
            ].map(m => (
              <div key={m.label} style={{
                padding: '3px 10px', borderRadius: 6,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', gap: 5, alignItems: 'center',
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#4b5568' }}>
                  {m.label}
                </span>
                <span style={{
                  fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
                  color: (m as { warn?: boolean }).warn ? '#ffd740' : '#9aa5be',
                }}>
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: KPI block */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>
          {/* Daily PnL */}
          <div style={{
            background: `${pnlColor}0e`,
            border: `1px solid ${pnlColor}30`,
            borderRadius: 10,
            padding: '10px 16px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 9, color: '#4b5568', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 3 }}>
              DAILY P&L
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: pnlColor }}>
              {dailyPnlPercent >= 0 ? '+' : ''}{dailyPnlPercent.toFixed(2)}%
            </div>
          </div>

          {/* Positions + decisions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{
              background: openPositions > 0 ? 'rgba(41,182,246,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${openPositions > 0 ? '#29b6f680' : '#1a203560'}`,
              borderRadius: 8, padding: '8px 10px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, color: '#4b5568', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 2 }}>
                POSITIONS
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                color: openPositions > 0 ? '#29b6f6' : '#6b7891' }}>
                {openPositions}
              </div>
            </div>
            <div style={{
              background: pendingDecisions > 0 ? 'rgba(255,215,64,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${pendingDecisions > 0 ? '#ffd74080' : '#1a203560'}`,
              borderRadius: 8, padding: '8px 10px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, color: '#4b5568', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 2 }}>
                PENDING
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                color: pendingDecisions > 0 ? '#ffd740' : '#6b7891' }}>
                {pendingDecisions}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cortexPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px currentColor, 0 0 20px currentColor; }
          50% { opacity: 0.4; box-shadow: none; }
        }
      `}</style>
    </div>
  );
}
