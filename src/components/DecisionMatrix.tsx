'use client';
/**
 * DecisionMatrix — Faza 6 Agentic Dashboard
 * Live confidence display per coin + AI reasoning trail.
 * Shows last N decisions with direction, confidence bar, architect/oracle reasoning.
 */

interface Decision {
  id: string;
  symbol: string;
  direction: string;
  confidence: number;
  timestamp: string;
  outcome: string;
  pnlPercent: number | null;
}

interface SyndicateAudit {
  id: string;
  timestamp: string;
  symbol: string;
  decision: string;
  confidence: number;
  architect: { direction: string; confidence: number; reasoning: string };
  oracle: { direction: string; confidence: number; reasoning: string };
}

interface Props {
  decisions: Decision[];
  syndicateAudits?: SyndicateAudit[];
  winRate?: number;
  totalDecisions?: number;
  todayPnl?: number;
}

function DirectionBadge({ direction }: { direction: string }) {
  const isLong = direction === 'LONG';
  const isFlat = direction === 'FLAT';
  const color = isFlat ? '#6b7891' : isLong ? '#00e676' : '#ff3d57';
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700,
      background: `${color}18`, border: `1px solid ${color}40`, color,
    }}>
      {direction}
    </span>
  );
}

function ConfidenceBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${Math.min(value * 100, 100)}%`,
          background: color,
          boxShadow: `0 0 4px ${color}80`,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color, minWidth: 36 }}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function OutcomePill({ outcome, pnl }: { outcome: string; pnl: number | null }) {
  if (outcome === 'PENDING') {
    return <span style={{ fontSize: 10, color: '#ffd740', fontWeight: 700, animation: 'matrixPulse 2s infinite' }}>LIVE</span>;
  }
  if (outcome === 'WIN') {
    return <span style={{ fontSize: 10, color: '#00e676', fontWeight: 700 }}>+{pnl?.toFixed(2)}%</span>;
  }
  if (outcome === 'LOSS') {
    return <span style={{ fontSize: 10, color: '#ff3d57', fontWeight: 700 }}>{pnl?.toFixed(2)}%</span>;
  }
  return <span style={{ fontSize: 10, color: '#6b7891' }}>{outcome}</span>;
}

export default function DecisionMatrix({ decisions, syndicateAudits = [], winRate = 0, totalDecisions = 0, todayPnl = 0 }: Props) {
  // Build a map of latest audit per symbol for the reasoning panel
  const latestAuditBySymbol: Record<string, SyndicateAudit> = {};
  syndicateAudits.forEach(a => {
    if (!latestAuditBySymbol[a.symbol] || a.timestamp > latestAuditBySymbol[a.symbol].timestamp) {
      latestAuditBySymbol[a.symbol] = a;
    }
  });

  // Latest syndicate audit (for reasoning display)
  const latestAudit = syndicateAudits[0];

  // Aggregate confidence per symbol from recent decisions
  const symbolStats: Record<string, { count: number; totalConf: number; lastDir: string; lastConf: number }> = {};
  decisions.slice(0, 20).forEach(d => {
    if (!symbolStats[d.symbol]) symbolStats[d.symbol] = { count: 0, totalConf: 0, lastDir: d.direction, lastConf: d.confidence };
    symbolStats[d.symbol].count++;
    symbolStats[d.symbol].totalConf += d.confidence;
  });

  const symbolList = Object.entries(symbolStats)
    .sort((a, b) => b[1].lastConf - a[1].lastConf)
    .slice(0, 6);

  const pnlColor = todayPnl >= 0 ? '#00e676' : '#ff3d57';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>

      {/* ── Header stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[
          { label: 'WIN RATE', value: `${(winRate * 100).toFixed(1)}%`, color: winRate >= 0.5 ? '#00e676' : winRate >= 0.4 ? '#ffd740' : '#ff3d57' },
          { label: 'TOTAL DECISIONS', value: totalDecisions.toString(), color: '#29b6f6' },
          { label: 'TODAY P&L', value: `${todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}%`, color: pnlColor },
        ].map(s => (
          <div key={s.label} style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 10, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 9, color: '#4b5568', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: 'monospace', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Live confidence per symbol ── */}
      <div style={{
        background: 'rgba(12,15,26,0.8)', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12, padding: '14px 16px',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6b7891', marginBottom: 12 }}>
          CONVICTION ENGINE — LIVE
        </div>
        {symbolList.length === 0 ? (
          <div style={{ color: '#4b5568', fontSize: 12 }}>No signal data yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {symbolList.map(([sym, st]) => {
              const confColor = st.lastConf >= 0.75 ? '#00e5ff' : st.lastConf >= 0.60 ? '#ffd740' : '#9aa5be';
              return (
                <div key={sym} style={{ display: 'grid', gridTemplateColumns: '90px 70px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#e8ecf4' }}>{sym}</span>
                  <DirectionBadge direction={st.lastDir} />
                  <ConfidenceBar value={st.lastConf} color={confColor} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Live Logic Engine (latest reasoning) ── */}
      {latestAudit && (
        <div style={{
          background: 'rgba(0,229,255,0.03)', border: '1px solid rgba(0,229,255,0.15)',
          borderRadius: 12, padding: '14px 16px',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#00e5ff', marginBottom: 10 }}>
            LIVE LOGIC ENGINE
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 800, color: '#e8ecf4' }}>
              {latestAudit.symbol}
            </span>
            <DirectionBadge direction={latestAudit.decision} />
            <span style={{ fontSize: 10, color: '#6b7891' }}>
              conf: <span style={{ color: '#00e5ff', fontWeight: 700 }}>{(latestAudit.confidence * 100).toFixed(0)}%</span>
            </span>
          </div>

          {/* Architect reasoning */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#7b2cf5', letterSpacing: '0.08em', marginBottom: 3 }}>
              ARCHITECT [{latestAudit.architect.direction} · {(latestAudit.architect.confidence * 100).toFixed(0)}%]
            </div>
            <div style={{
              fontSize: 11, color: '#9aa5be', lineHeight: 1.5,
              borderLeft: '2px solid rgba(123,44,245,0.4)', paddingLeft: 8,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {latestAudit.architect.reasoning}
            </div>
          </div>

          {/* Oracle reasoning */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#00e5ff', letterSpacing: '0.08em', marginBottom: 3 }}>
              ORACLE [{latestAudit.oracle.direction} · {(latestAudit.oracle.confidence * 100).toFixed(0)}%]
            </div>
            <div style={{
              fontSize: 11, color: '#9aa5be', lineHeight: 1.5,
              borderLeft: '2px solid rgba(0,229,255,0.3)', paddingLeft: 8,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {latestAudit.oracle.reasoning}
            </div>
          </div>
        </div>
      )}

      {/* ── Recent decisions list ── */}
      <div style={{
        background: 'rgba(12,15,26,0.8)', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12, padding: '14px 16px', flex: 1,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#6b7891', marginBottom: 10 }}>
          DECISION TRAIL
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
          {decisions.length === 0 ? (
            <div style={{ color: '#4b5568', fontSize: 12 }}>Awaiting first decision...</div>
          ) : (
            decisions.slice(0, 12).map(d => (
              <div key={d.id} style={{
                display: 'grid', gridTemplateColumns: '80px 1fr 70px 60px',
                gap: 8, alignItems: 'center', padding: '5px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: '#e8ecf4' }}>{d.symbol}</span>
                <DirectionBadge direction={d.direction} />
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#6b7891' }}>
                  {(d.confidence * 100).toFixed(0)}%
                </span>
                <OutcomePill outcome={d.outcome} pnl={d.pnlPercent} />
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes matrixPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}
