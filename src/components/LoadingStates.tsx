'use client';

/** Skeleton shimmer for loading states */
export function Skeleton({ width = '100%', height = 16, radius = 6, style }: {
  width?: string | number;
  height?: number;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="loading-shimmer"
      role="status"
      aria-label="Loading"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** Card-level skeleton placeholder */
export function SkeletonCard({ lines = 3, title }: { lines?: number; title?: string }) {
  return (
    <div className="glass-card" role="status" aria-label={title ? `Loading ${title}` : 'Loading content'}>
      {title && (
        <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          <Skeleton width={120} height={14} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} width={`${90 - i * 15}%`} height={12} />
        ))}
      </div>
    </div>
  );
}

/** Error state with retry button and timestamp */
export function ErrorState({ message, onRetry, lastAttempt }: {
  message: string;
  onRetry?: () => void;
  lastAttempt?: string;
}) {
  return (
    <div className="glass-card" role="alert" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      padding: '24px 16px', textAlign: 'center',
    }}>
      <span style={{ fontSize: 28, opacity: 0.6 }}>⚠️</span>
      <span style={{ fontSize: 13, color: 'var(--accent-red)', fontWeight: 600 }}>{message}</span>
      {lastAttempt && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          Last attempt: {lastAttempt}
        </span>
      )}
      {onRetry && (
        <button
          className="btn"
          onClick={onRetry}
          aria-label="Retry loading data"
          style={{ marginTop: 4, background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: 'var(--accent-red)' }}
        >
          ↻ Retry
        </button>
      )}
    </div>
  );
}
