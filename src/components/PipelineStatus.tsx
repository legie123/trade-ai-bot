'use client';

interface PipelineStep {
  id: string;
  label: string;
  icon: string;
  status: 'ok' | 'degraded' | 'down' | 'idle';
  detail?: string;
}

interface PipelineStatusProps {
  steps?: PipelineStep[];
  signalCount?: number;
  lastScan?: string | null;
}

const DEFAULT_PIPELINE: PipelineStep[] = [
  { id: 'scan', label: 'Scan', icon: '🔍', status: 'ok', detail: 'DexScreener + Birdeye' },
  { id: 'aggregate', label: 'Aggregate', icon: '📡', status: 'ok', detail: 'Signal Aggregator' },
  { id: 'rank', label: 'Rank', icon: '🏅', status: 'ok', detail: 'Rank Engine' },
  { id: 'score', label: 'Score', icon: '🎯', status: 'ok', detail: 'Conviction + ML' },
  { id: 'risk', label: 'Risk', icon: '⚖️', status: 'ok', detail: 'Kill Switch + Risk Mgr' },
  { id: 'execute', label: 'Execute', icon: '⚡', status: 'idle', detail: 'Paper mode' },
];

export default function PipelineStatus({ steps, signalCount = 0, lastScan }: PipelineStatusProps) {
  const pipeline = steps || DEFAULT_PIPELINE;

  const statusColor = (s: string) =>
    s === 'ok' ? 'var(--accent-green)'
    : s === 'degraded' ? 'var(--accent-amber)'
    : s === 'down' ? 'var(--accent-red)'
    : 'var(--text-muted)';

  const statusGlow = (s: string) =>
    s === 'ok' ? '0 0 6px rgba(16,185,129,0.4)'
    : s === 'degraded' ? '0 0 6px rgba(245,158,11,0.4)'
    : s === 'down' ? '0 0 6px rgba(239,68,68,0.4)'
    : 'none';

  return (
    <div className="glass-card" style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--accent-purple)' }}>
          🔄 DECISION PIPELINE
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastScan && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Last: {lastScan}
            </span>
          )}
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
            background: signalCount > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
            color: signalCount > 0 ? 'var(--accent-green)' : 'var(--text-muted)',
          }}>
            {signalCount} signals
          </span>
        </div>
      </div>

      <div className="pipeline-track">
        {pipeline.map((step, i) => (
          <div key={step.id} className="pipeline-step">
            <div className="pipeline-node" style={{
              borderColor: statusColor(step.status),
              boxShadow: statusGlow(step.status),
            }}>
              <span style={{ fontSize: 14 }}>{step.icon}</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: statusColor(step.status), marginTop: 4 }}>
              {step.label}
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)', maxWidth: 70, textAlign: 'center' }}>
              {step.detail}
            </div>
            {i < pipeline.length - 1 && (
              <div className="pipeline-connector" style={{
                background: statusColor(pipeline[i + 1].status === 'idle' ? 'idle' : step.status),
              }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
