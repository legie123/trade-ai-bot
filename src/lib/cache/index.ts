// ============================================================
// Cache Layer — in-memory with TTL and stale flags
// ============================================================
import { DataFreshness } from '@/lib/types';

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  freshness: DataFreshness;
}

const DEFAULT_TTL_MS = 30_000;        // 30 seconds = LIVE
const DEFAULT_STALE_MS = 60_000;      // 60 seconds = CACHED
const DEFAULT_EXPIRY_MS = 300_000;    // 5 minutes = evict

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
}

// Singleton cache
export const cache = new MemoryCache();
