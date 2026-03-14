// ============================================================
// Base Provider Utilities — retry, timeout, rate-limit, health
// ============================================================
import { DataFreshness, ProviderHealth, ProviderName, ProviderResponse } from '@/lib/types';

interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1_000;

/**
 * Fetch with exponential-backoff retry, timeout, and error wrapping.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY,
    headers = {},
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...headers,
        },
      });
      clearTimeout(timer);

      // Rate-limited — wait and retry
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const wait = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : retryDelayMs * Math.pow(2, attempt);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
      }
    }
  }

  throw lastError ?? new Error('fetchWithRetry failed');
}

/**
 * Wrap a provider fetch into a standard ProviderResponse.
 */
export async function providerFetch<T>(
  provider: ProviderName,
  url: string,
  options?: FetchOptions
): Promise<ProviderResponse<T>> {
  try {
    const res = await fetchWithRetry(url, options);
    const data = (await res.json()) as T;
    return {
      data,
      provider,
      freshness: 'LIVE' as DataFreshness,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      data: null,
      provider,
      freshness: 'UNAVAILABLE' as DataFreshness,
      fetchedAt: new Date().toISOString(),
      error: (err as Error).message,
    };
  }
}

/**
 * Quick health-check: tries to reach an endpoint and returns status.
 */
export async function checkHealth(
  name: ProviderName,
  url: string,
  headers?: Record<string, string>
): Promise<ProviderHealth> {
  const start = Date.now();
  try {
    const res = await fetchWithRetry(url, { retries: 1, timeoutMs: 5_000, headers });
    const latency = Date.now() - start;
    return {
      name,
      status: res.ok ? 'healthy' : 'degraded',
      lastCheck: new Date().toISOString(),
      latencyMs: latency,
    };
  } catch {
    return {
      name,
      status: 'down',
      lastCheck: new Date().toISOString(),
      latencyMs: null,
      message: 'Health check failed',
    };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
