// ============================================================
// News Collector Agent — polls all enabled adapters, dedups, caches
//
// ADDITIVE. Exposes a singleton with an async getLatest() that pulls
// from every enabled adapter in parallel, deduplicates by id, sorts
// by freshness, and caches results for INTEL_NEWS_CACHE_MS (default 60s).
// ============================================================
import { createLogger } from '@/lib/core/logger';
import { NewsItem } from '../feeds/types';
import { getEnabledNewsAdapters } from '../feeds/registry';

const log = createLogger('NewsCollector');

const CACHE_MS_DEFAULT = 60_000;
const MAX_CACHE_ITEMS = 500;

export class NewsCollector {
  private static instance: NewsCollector;
  private cache: NewsItem[] = [];
  private cachedAt = 0;
  private inflight: Promise<NewsItem[]> | null = null;

  public static getInstance(): NewsCollector {
    if (!NewsCollector.instance) NewsCollector.instance = new NewsCollector();
    return NewsCollector.instance;
  }

  private cacheMs(): number {
    return Number(process.env.INTEL_NEWS_CACHE_MS || CACHE_MS_DEFAULT);
  }

  public async getLatest(force = false): Promise<NewsItem[]> {
    const now = Date.now();
    if (!force && this.cache.length > 0 && now - this.cachedAt < this.cacheMs()) {
      return this.cache;
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.refresh()
      .catch((e) => {
        log.error('news refresh failed', { error: String(e) });
        return this.cache; // serve stale on error
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async refresh(): Promise<NewsItem[]> {
    const adapters = getEnabledNewsAdapters();
    if (adapters.length === 0) {
      log.warn('no news adapters enabled/configured');
      this.cachedAt = Date.now();
      this.cache = [];
      return this.cache;
    }

    const settled = await Promise.allSettled(adapters.map((a) => a.fetch()));
    const items: NewsItem[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') items.push(...r.value);
    }

    // Dedup by id
    const byId = new Map<string, NewsItem>();
    for (const it of items) {
      const existing = byId.get(it.id);
      if (!existing || it.publishedAt > existing.publishedAt) {
        byId.set(it.id, it);
      }
    }
    const deduped = Array.from(byId.values()).sort((a, b) => b.publishedAt - a.publishedAt);
    const trimmed = deduped.slice(0, MAX_CACHE_ITEMS);

    this.cache = trimmed;
    this.cachedAt = Date.now();
    log.info(`news refreshed: ${items.length} raw → ${trimmed.length} deduped from ${adapters.length} adapters`);
    return this.cache;
  }

  public getCached(): { items: NewsItem[]; cachedAt: number } {
    return { items: [...this.cache], cachedAt: this.cachedAt };
  }
}

export const newsCollector = NewsCollector.getInstance();
