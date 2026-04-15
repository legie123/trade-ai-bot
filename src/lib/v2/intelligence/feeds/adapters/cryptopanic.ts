// ============================================================
// CryptoPanic adapter — OPTIONAL, requires CRYPTOPANIC_KEY
// Silently disabled when key missing — pluggable, drop-in ready.
// ============================================================
import { createLogger } from '@/lib/core/logger';
import { FeedAdapter, FeedHealth, NewsItem, newsIdFor } from '../types';

const log = createLogger('Adapter-CryptoPanic');
const BASE = 'https://cryptopanic.com/api/v1/posts/';
const FETCH_TIMEOUT_MS = 8000;
const SOURCE_CREDIBILITY = 0.7;

interface CpPost {
  id: number;
  title: string;
  url: string;
  published_at: string;
  currencies?: Array<{ code: string }>;
  source?: { title?: string };
  votes?: { positive?: number; negative?: number; important?: number };
}

export class CryptoPanicAdapter implements FeedAdapter<NewsItem> {
  readonly name = 'cryptopanic';
  private health: FeedHealth = {
    adapter: this.name,
    enabled: true,
    configured: !!process.env.CRYPTOPANIC_KEY,
    lastFetchAt: null,
    lastFetchOk: false,
    lastError: null,
    totalFetches: 0,
    totalItems: 0,
  };

  isConfigured(): boolean {
    return !!process.env.CRYPTOPANIC_KEY;
  }

  freshnessWindowMs(): number | null {
    return 5 * 60_000;
  }

  async fetch(): Promise<NewsItem[]> {
    this.health.configured = this.isConfigured();
    if (!this.health.configured) {
      this.health.lastError = 'CRYPTOPANIC_KEY missing';
      return [];
    }
    this.health.totalFetches++;
    this.health.lastFetchAt = Date.now();
    try {
      const url = `${BASE}?auth_token=${encodeURIComponent(process.env.CRYPTOPANIC_KEY!)}&public=true&kind=news`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'TradeAI-Intel/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { results?: CpPost[] };
      const posts = body.results || [];
      const now = Date.now();
      const items: NewsItem[] = posts.map((p) => ({
        id: newsIdFor(p.url, p.title),
        title: p.title,
        url: p.url,
        source: this.name,
        sourceCredibility: SOURCE_CREDIBILITY,
        publishedAt: Date.parse(p.published_at) || now,
        fetchedAt: now,
        summary: null,
        topics: ['crypto'],
        symbols: (p.currencies || []).map((c) => c.code.toUpperCase()),
        language: 'en',
        raw: p,
      }));
      this.health.lastFetchOk = true;
      this.health.lastError = null;
      this.health.totalItems = items.length;
      return items;
    } catch (err) {
      this.health.lastFetchOk = false;
      this.health.lastError = (err as Error).message;
      log.warn('cryptopanic fetch failed', { error: this.health.lastError });
      return [];
    }
  }

  getHealth(): FeedHealth {
    this.health.configured = this.isConfigured();
    return { ...this.health };
  }
}

export const cryptoPanicAdapter = new CryptoPanicAdapter();
