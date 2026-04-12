'use client';
/**
 * MoltbookSwarmFeed — Faza 6 Agentic Dashboard
 * Swarm Intelligence panel: shows what the agent read from Moltbook,
 * derived sentiment, and last broadcast messages.
 */

interface MoltbookPost {
  id?: string;
  content: string;
  timestamp: string;
  sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence?: number;
  source?: string;
}

interface Props {
  posts?: MoltbookPost[];
  swarmSentiment?: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    score: number; // 0-100
    insightsProcessed: number;
    lastUpdated?: string;
  };
  broadcastLog?: string[];
  broadcastMessages?: string[];
}

function SentimentBar({ score, direction }: { score: number; direction: string }) {
  const isBull = direction === 'BULLISH';
  const isBear = direction === 'BEARISH';
  const color = isBull ? '#00e676' : isBear ? '#ff3d57' : '#ffd740';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 3,
          width: `${score}%`,
          background: `linear-gradient(90deg, ${color}80, ${color})`,
          boxShadow: `0 0 6px ${color}60`,
          transition: 'width 0.8s ease',
        }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace', color, minWidth: 40 }}>
        {score.toFixed(0)}%
      </span>
    </div>
  );
}

const SENTIMENT_COLOR = { BULLISH: '#00e676', BEARISH: '#ff3d57', NEUTRAL: '#ffd740' };

function PostCard({ post }: { post: MoltbookPost }) {
  const sentColor = post.sentiment ? SENTIMENT_COLOR[post.sentiment] : '#9aa5be';
  const ts = new Date(post.timestamp);
  const timeStr = isNaN(ts.getTime()) ? '' : ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 8,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid rgba(255,255,255,0.06)`,
      borderLeft: `3px solid ${sentColor}50`,
      marginBottom: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {post.sentiment && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              color: sentColor, padding: '1px 6px',
              background: `${sentColor}18`, borderRadius: 3,
            }}>
              {post.sentiment}
            </span>
          )}
          {post.source && (
            <span style={{ fontSize: 9, color: '#4b5568', fontWeight: 600 }}>{post.source}</span>
          )}
        </div>
        <span style={{ fontSize: 9, color: '#4b5568', fontFamily: 'monospace' }}>{timeStr}</span>
      </div>
      <p style={{
        margin: 0, fontSize: 11, color: '#9aa5be', lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {post.content}
      </p>
      {post.confidence != null && (
        <div style={{ marginTop: 5 }}>
          <div style={{ height: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${post.confidence * 100}%`,
              background: sentColor, opacity: 0.6,
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function MoltbookSwarmFeed({ posts = [], swarmSentiment, broadcastLog = [], broadcastMessages }: Props) {
  // Support both prop names for compatibility
  const effectiveBroadcastLog = broadcastMessages ?? broadcastLog;
  const hasSentiment = !!swarmSentiment;
  const sentDir = swarmSentiment?.direction ?? 'NEUTRAL';
  const sentColor = SENTIMENT_COLOR[sentDir];

  return (
    <div style={{
      background: 'rgba(12,15,26,0.85)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.2)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: hasSentiment ? 10 : 0 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#7b2cf5',
            boxShadow: '0 0 6px #7b2cf5, 0 0 12px #7b2cf580',
            animation: 'swarmPulse 3s infinite',
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#7b2cf5' }}>
            SWARM INTELLIGENCE
          </span>
          {posts.length > 0 && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 3,
              background: 'rgba(123,44,245,0.15)', color: '#7b2cf5', fontWeight: 700,
              marginLeft: 'auto',
            }}>
              {posts.length} SIGNALS
            </span>
          )}
        </div>

        {hasSentiment && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 9, color: '#6b7891', fontWeight: 700, letterSpacing: '0.06em' }}>
                MARKET SENTIMENT
              </span>
              <span style={{ fontSize: 10, fontWeight: 800, color: sentColor }}>
                {sentDir} · {swarmSentiment!.insightsProcessed} insights
              </span>
            </div>
            <SentimentBar score={swarmSentiment!.score} direction={sentDir} />
          </div>
        )}

        {!hasSentiment && (
          <div style={{ fontSize: 11, color: '#4b5568', marginTop: 4 }}>
            Awaiting Moltbook swarm data...
          </div>
        )}
      </div>

      {/* Posts feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {posts.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 8,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '2px solid rgba(123,44,245,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(123,44,245,0.5)' }} />
            </div>
            <span style={{ fontSize: 11, color: '#4b5568' }}>No swarm activity yet</span>
          </div>
        ) : (
          posts.slice(0, 10).map((p, i) => <PostCard key={p.id ?? i} post={p} />)
        )}
      </div>

      {/* Broadcast log */}
      {effectiveBroadcastLog.length > 0 && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.05)',
          padding: '8px 12px',
          flexShrink: 0,
          maxHeight: 80,
          overflowY: 'auto',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <div style={{ fontSize: 9, color: '#4b5568', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>
            BROADCAST LOG
          </div>
          {effectiveBroadcastLog.slice(0, 4).map((msg, i) => (
            <div key={i} style={{ fontSize: 10, color: '#6b7891', fontFamily: 'monospace', lineHeight: 1.4 }}>
              <span style={{ color: '#7b2cf5', marginRight: 4 }}>›</span>{msg}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes swarmPulse {
          0%,100%{opacity:1;box-shadow:0 0 6px #7b2cf5,0 0 12px #7b2cf580}
          50%{opacity:0.5;box-shadow:0 0 3px #7b2cf5}
        }
      `}</style>
    </div>
  );
}
