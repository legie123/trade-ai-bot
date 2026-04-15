// ============================================================
// Intelligence Feed Types — pluggable adapter contract
//
// ADDITIVE. Phase 2 Batch 3 foundation. Every feed adapter (news,
// sentiment, social) implements FeedAdapter<T>. Consumers (agents,
// routes) only talk to the adapter interface — keys are wired later
// without touching consumers.
// ============================================================

export interface FeedHealth {
  adapter: string;
  enabled: boolean;
  configured: boolean;    // has creds/env needed
  lastFetchAt: number | null;
  lastFetchOk: boolean;
  lastError: string | null;
  totalFetches: number;
  totalItems: number;
}

export interface FeedAdapter<T> {
  readonly name: string;
  /**
   * True if the adapter has everything it needs to fetch (keys, endpoint).
   * Adapters without keys but with public endpoints (RSS) return true.
   */
  isConfigured(): boolean;
  /**
   * Optional freshness window hint in ms. null = no opinion.
   */
  freshnessWindowMs(): number | null;
  /**
   * Pull fresh items. Must be idempotent and cheap-failing.
   */
  fetch(): Promise<T[]>;
  /**
   * Expose health for /api/v2/intelligence/feed-health.
   */
  getHealth(): FeedHealth;
}

// ─── News item canonical shape ─────────────────────────
export interface NewsItem {
  id: string;                  // stable id (hash of URL + title)
  title: string;
  url: string;
  source: string;              // adapter name
  sourceCredibility: number;   // 0..1 heuristic
  publishedAt: number;         // unix ms
  fetchedAt: number;
  summary: string | null;
  topics: string[];            // coarse tags (crypto, macro, politics, election, etc.)
  symbols: string[];           // best-effort extracted tickers (BTC, ETH, SOL, ...)
  language: string;            // 'en' default
  raw: unknown;                // original payload for debugging
}

// ─── Sentiment score ───────────────────────────────────
export type SentimentLabel = 'bullish' | 'bearish' | 'neutral' | 'mixed';

export interface SentimentScore {
  itemId: string;
  label: SentimentLabel;
  /** signed score in [-1, +1]; negative = bearish, positive = bullish */
  score: number;
  /** confidence in [0, 1] */
  confidence: number;
  /** entities referenced (symbols, companies, tokens) */
  entities: string[];
  /** decay-adjusted relevance in [0, 1] — drops with age */
  relevance: number;
  adapter: string;
  scoredAt: number;
}

// ─── Sentiment adapter contract ────────────────────────
export interface SentimentAdapter extends FeedAdapter<SentimentScore> {
  /**
   * Score a specific list of news items. Adapters may batch internally.
   */
  scoreItems(items: NewsItem[]): Promise<SentimentScore[]>;
}

// ─── Utility: sentiment decay ──────────────────────────
/**
 * Exponential decay for news relevance. Half-life configurable via
 * INTEL_SENTIMENT_HALF_LIFE_MIN (default 60 minutes).
 */
export function decayRelevance(ageMs: number, halfLifeMin?: number): number {
  const hl = halfLifeMin ?? Number(process.env.INTEL_SENTIMENT_HALF_LIFE_MIN || 60);
  if (hl <= 0) return 1;
  const halfLifeMs = hl * 60_000;
  const factor = Math.pow(0.5, ageMs / halfLifeMs);
  return Math.max(0, Math.min(1, factor));
}

/**
 * Stable id for a news item from URL + title. Avoids dup between adapters.
 */
export function newsIdFor(url: string, title: string): string {
  const s = `${url.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'n_' + Math.abs(h).toString(36);
}
