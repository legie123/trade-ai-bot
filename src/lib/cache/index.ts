// ============================================================
// Cache Layer — in-memory with TTL and stale flags
// ============================================================
import { DataFreshness } from '@/lib/types';

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  freshness: DataFreshness;
}

const DEFAULT_TTL_MS = 60_000;        // 60 seconds = LIVE (cost-optimized)
const DEFAULT_STALE_MS = 120_000;     // 120 seconds = CACHED
const DEFAULT_EXPIRY_MS = 600_000;    // 10 minutes = evict

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): { data: T; freshness: DataFreshness } | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const age = Date.now() - entry.fetchedAt;

    if (age > DEFAULT_EXPIRY_MS) {
      this.store.delete(key);
      return null;
    }

    let freshness: DataFreshness = 'LIVE';
    if (age > DEFAULT_STALE_MS) freshness = 'CACHED';
    else if (age > DEFAULT_TTL_MS) freshness = 'CACHED';

    return { data: entry.data, freshness };
  }

  set<T>(key: string, data: T, freshness: DataFreshness = 'LIVE'): void {
    this.store.set(key, {
      data,
      fetchedAt: Date.now(),
      freshness,
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  stats() {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
    };
  }
  /** Proactively evict expired entries */
  sweep(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.fetchedAt > DEFAULT_EXPIRY_MS) {
        this.store.delete(key);
        evicted++;
      }
    }
    return evicted;
  }
}

// Singleton cache (survives Next.js hot reload)
const globalForCache = globalThis as unknown as {
  __memoryCache?: MemoryCache;
  __cacheSweepId?: ReturnType<typeof setInterval>;
};
if (!globalForCache.__memoryCache) {
  globalForCache.__memoryCache = new MemoryCache();
}
// Proactive sweep every 60s
if (!globalForCache.__cacheSweepId) {
  globalForCache.__cacheSweepId = setInterval(() => {
    globalForCache.__memoryCache?.sweep();
  }, 60_000);
}
export const cache: MemoryCache = globalForCache.__memoryCache;
