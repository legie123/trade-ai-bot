// ============================================================
// IntelligencePanel — read-only consumer of /api/v2/intelligence/*
//
// ADDITIVE UI. Collapsible, self-contained. Zero layout impact on the
// hosting page. Drops in under existing panels without mutating them.
//
// Consumers: /polymarket page + /dashboard page.
// ============================================================
'use client';

import { useEffect, useRef, useState } from 'react';

interface RankedItem {
  id: string;
  symbol: string;
  sector?: string;
  score: number;
  direction: 'up' | 'down' | 'neutral';
  reasons: string[];
  penalties: string[];
  inputs: {
    momentum: number | null;
    sentimentScore: number | null;
    imbalance: number | null;
    liquidity: number | null;
    volumeZ: number | null;
    regime: string | null;
  };
  generatedAt: number;
}

interface RankingResponse {
  status: string;
  count: number;
  totalCandidates: number;
  sector: string;
  ranked: RankedItem[];
  timestamp: number;
}

interface OverallSentiment {
  aggScore: number;
  label: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  count: number;
}

interface SentimentResponse {
  status: string;
  adapter: string;
  overall: OverallSentiment;
  totalItems: number;
  bySymbol: Array<{
    symbol: string;
    aggScore: number;
    bullish: number;
    bearish: number;
    neutral: number;
    mixed: number;
    count: number;
  }>;
  generatedAt: number;
}

interface FeedHealthResponse {
  generatedAt: number;
  summary: {
    newsAdapters: { enabled: number; configured: number; total: number };
    sentimentAdapter: { name: string; configured: boolean };
    wsAnyConnected: boolean;
  };
  ws: {
    polymarket: { connected: boolean; stale: boolean; totalReconnects: number; eventsReceived: number };
    mexc: { connected: boolean; stale: boolean; totalReconnects: number; activeStreams: number };
  };
}

type SectorFilter = 'ALL' | 'CRYPTO' | 'POLYMARKET';

interface Props {
  defaultSector?: SectorFilter;
  defaultLimit?: number;
  pollMs?: number;
  compact?: boolean;
  title?: string;
}

const directionColor: Record<string, string> = {
  up: '#10b981',
  down: '#ef4444',
  neutral: '#6b7280',
};

const sentimentColor: Record<string, string> = {
  bullish: '#10b981',
  bearish: '#ef4444',
  neutral: '#6b7280',
  mixed: '#f59e0b',
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    // our responses wrap in { status, data? } or flat — handle both
    return (body?.data as T) || (body as T);
  } catch {
    return null;
  }
}

export function IntelligencePanel({
  defaultSector = 'ALL',
  defaultLimit = 10,
  pollMs = 20000,
  compact = false,
  title = 'Intelligence Panel',
}: Props) {
  const [collapsed, setCollapsed] = useState(compact);
  const [sector, setSector] = useState<SectorFilter>(defaultSector);
  const [limit] = useState(defaultLimit);
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [sentiment, setSentiment] = useState<SentimentResponse | null>(null);
  const [feedHealth, setFeedHealth] = useState<FeedHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const sectorParam = sector === 'ALL' ? '' : `&sector=${sector}`;
      const [r, s, h] = await Promise.all([
        fetchJson<RankingResponse>(`/api/v2/intelligence/ranking?limit=${limit}${sectorParam}`),
        fetchJson<SentimentResponse>('/api/v2/intelligence/sentiment'),
        fetchJson<FeedHealthResponse>('/api/v2/intelligence/feed-health'),
      ]);
      if (r) setRanking(r);
      if (s) setSentiment(s);
      if (h) setFeedHealth(h);
      if (!r && !s && !h) setError('All intelligence endpoints failed');
      setLastFetchAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (collapsed) return;
    load();
    timerRef.current = setInterval(load, pollMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, sector, pollMs]);

  const box: React.CSSProperties = {
    background: '#0b0f14',
    border: '1px solid #1f2937',
    borderRadius: 10,
    padding: 12,
    margin: '12px 0',
    color: '#e5e7eb',
    fontFamily: 'ui-monospace, Menlo, Monaco, monospace',
    fontSize: 12,
  };

  const header: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: collapsed ? 0 : 10,
    cursor: 'pointer',
    userSelect: 'none',
  };

  const pill = (text: string, color: string): React.CSSProperties => ({
    display: 'inline-block',
    background: color + '22',
    color,
    border: `1px solid ${color}55`,
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 11,
    marginRight: 6,
  });

  const row: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '30px 1.8fr 80px 90px 1fr',
    gap: 8,
    alignItems: 'center',
    padding: '6px 4px',
    borderBottom: '1px dashed #1f2937',
  };

  const feedBadge = (label: string, ok: boolean, stale?: boolean) => (
    <span style={pill(label, stale ? '#f59e0b' : ok ? '#10b981' : '#ef4444')}>
      {label}: {stale ? 'STALE' : ok ? 'OK' : 'DOWN'}
    </span>
  );

  return (
    <div style={box}>
      <div style={header} onClick={() => setCollapsed((c) => !c)}>
        <div>
          <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>🛰 {title}</span>
          {feedHealth && !collapsed && (
            <span style={{ marginLeft: 12 }}>
              {feedBadge('polyWS', feedHealth.ws.polymarket.connected, feedHealth.ws.polymarket.stale)}
              {feedBadge('mexcWS', feedHealth.ws.mexc.connected, feedHealth.ws.mexc.stale)}
              <span style={pill(`news ${feedHealth.summary.newsAdapters.enabled}/${feedHealth.summary.newsAdapters.total}`, '#06b6d4')}>
                news {feedHealth.summary.newsAdapters.enabled}/{feedHealth.summary.newsAdapters.total}
              </span>
              <span style={pill(feedHealth.summary.sentimentAdapter.name, '#8b5cf6')}>
                {feedHealth.summary.sentimentAdapter.name}
              </span>
            </span>
          )}
        </div>
        <div>
          {!collapsed && lastFetchAt && (
            <span style={{ opacity: 0.6, marginRight: 8 }}>
              {loading ? '…loading' : `updated ${Math.round((Date.now() - lastFetchAt) / 1000)}s ago`}
            </span>
          )}
          <span style={{ opacity: 0.7 }}>{collapsed ? '▸' : '▾'}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          {error && <div style={{ color: '#ef4444', marginBottom: 8 }}>⚠ {error}</div>}

          {/* Sentiment overall */}
          {sentiment && (
            <div style={{ marginBottom: 10 }}>
              <span style={pill('sentiment', sentimentColor[sentiment.overall.label])}>
                {sentiment.overall.label.toUpperCase()} {sentiment.overall.aggScore.toFixed(3)} (n={sentiment.overall.count})
              </span>
              <span style={{ opacity: 0.6, marginLeft: 8 }}>
                via {sentiment.adapter} · {sentiment.totalItems} items
              </span>
            </div>
          )}

          {/* Sector filter */}
          <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
            {(['ALL', 'CRYPTO', 'POLYMARKET'] as SectorFilter[]).map((s) => (
              <button
                key={s}
                onClick={(e) => {
                  e.stopPropagation();
                  setSector(s);
                }}
                style={{
                  background: sector === s ? '#1f2937' : 'transparent',
                  color: sector === s ? '#e5e7eb' : '#9ca3af',
                  border: '1px solid #1f2937',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                {s}
              </button>
            ))}
            <button
              onClick={(e) => {
                e.stopPropagation();
                load();
              }}
              style={{
                marginLeft: 'auto',
                background: '#1f2937',
                color: '#e5e7eb',
                border: '1px solid #374151',
                borderRadius: 6,
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              ↻ refresh
            </button>
          </div>

          {/* Ranking */}
          {ranking && ranking.ranked.length > 0 ? (
            <div>
              <div style={{ ...row, fontWeight: 700, color: '#9ca3af', borderBottom: '1px solid #374151' }}>
                <span>#</span>
                <span>Symbol / Market</span>
                <span>Score</span>
                <span>Dir</span>
                <span>Reasons · Penalties</span>
              </div>
              {ranking.ranked.map((r, i) => (
                <div key={r.id} style={row}>
                  <span style={{ opacity: 0.6 }}>{i + 1}</span>
                  <span title={r.id}>
                    <span style={{ opacity: 0.5, fontSize: 10 }}>{r.sector || '—'}</span>{' '}
                    <span style={{ color: '#e5e7eb' }}>{r.symbol}</span>
                  </span>
                  <span style={{ color: directionColor[r.direction], fontWeight: 700 }}>
                    {r.score.toFixed(3)}
                  </span>
                  <span style={pill(r.direction.toUpperCase(), directionColor[r.direction])}>
                    {r.direction === 'up' ? '▲' : r.direction === 'down' ? '▼' : '→'} {r.direction}
                  </span>
                  <span style={{ opacity: 0.85, fontSize: 11 }}>
                    {r.reasons.slice(0, 3).join(' · ')}
                    {r.penalties.length > 0 && (
                      <span style={{ color: '#f59e0b' }}> ⚠ {r.penalties.slice(0, 2).join(', ')}</span>
                    )}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: 6, opacity: 0.5, fontSize: 11 }}>
                {ranking.count} / {ranking.totalCandidates} candidates · sector {ranking.sector}
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.6 }}>No ranked items yet. Scanner + WS will populate this.</div>
          )}

          {/* Sentiment by symbol top-5 */}
          {sentiment && sentiment.bySymbol.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#9ca3af', marginBottom: 4 }}>Top symbol sentiment:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {sentiment.bySymbol.slice(0, 8).map((sy) => {
                  const label: 'bullish' | 'bearish' | 'neutral' | 'mixed' =
                    sy.aggScore > 0.2 ? 'bullish' : sy.aggScore < -0.2 ? 'bearish' : 'neutral';
                  return (
                    <span key={sy.symbol} style={pill(`${sy.symbol} ${sy.aggScore.toFixed(2)}`, sentimentColor[label])}>
                      {sy.symbol} {sy.aggScore > 0 ? '+' : ''}{sy.aggScore.toFixed(2)} · n={sy.count}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default IntelligencePanel;
