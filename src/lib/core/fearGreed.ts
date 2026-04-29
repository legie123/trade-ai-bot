// ============================================================
// Fear & Greed Index — Live feed from Alternative.me API
// Caches result for 30 minutes (index updates every 12h)
// ============================================================
import { createLogger } from '@/lib/core/logger';

const log = createLogger('FearGreed');

export interface FearGreedData {
  value: number;           // 0-100
  classification: string;  // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  timestamp: string;
  cached: boolean;
}

// Cache with 30-min TTL (index only updates every 12 hours)
const gfg = globalThis as unknown as {
  __fearGreed?: { data: FearGreedData; fetchedAt: number };
};
const CACHE_TTL = 30 * 60_000;

// Canonical URL — import from here to avoid duplication across modules.
export const FEAR_GREED_API_URL =
  process.env.FEAR_GREED_URL || 'https://api.alternative.me/fng/?limit=1';

/**
 * Fetch live Fear & Greed Index from Alternative.me
 * Falls back to neutral (50) on error
 */
export async function getFearGreedIndex(): Promise<FearGreedData> {
  // Return cache if fresh
  if (gfg.__fearGreed && Date.now() - gfg.__fearGreed.fetchedAt < CACHE_TTL) {
    return { ...gfg.__fearGreed.data, cached: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(FEAR_GREED_API_URL, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const json = await res.json();
    const entry = json?.data?.[0];

    if (!entry) throw new Error('No data in response');

    const data: FearGreedData = {
      value: parseInt(entry.value) || 50,
      classification: entry.value_classification || 'Neutral',
      timestamp: new Date(parseInt(entry.timestamp) * 1000).toISOString(),
      cached: false,
    };

    gfg.__fearGreed = { data, fetchedAt: Date.now() };
    log.info(`Fear & Greed: ${data.value} (${data.classification})`);
    return data;
  } catch (err) {
    log.warn('Fear & Greed fetch failed, using neutral default', {
      error: (err as Error).message,
    });

    return {
      value: 50,
      classification: 'Neutral',
      timestamp: new Date().toISOString(),
      cached: false,
    };
  }
}

/**
 * Get Fear & Greed signal for trading decisions
 * - Extreme Fear (0-25): Contrarian BUY signal (market oversold)
 * - Fear (25-40): Mild BUY bias
 * - Neutral (40-60): No bias
 * - Greed (60-75): Mild SELL bias
 * - Extreme Greed (75-100): Contrarian SELL signal (market overheated)
 */
export function fearGreedToSignal(value: number): {
  bias: 'BUY' | 'SELL' | 'NEUTRAL';
  strength: number; // 0-1
  reason: string;
} {
  if (value <= 25) {
    return { bias: 'BUY', strength: 0.8, reason: `Extreme Fear (${value}) — contrarian BUY` };
  } else if (value <= 40) {
    return { bias: 'BUY', strength: 0.4, reason: `Fear (${value}) — mild BUY bias` };
  } else if (value >= 75) {
    return { bias: 'SELL', strength: 0.8, reason: `Extreme Greed (${value}) — contrarian SELL` };
  } else if (value >= 60) {
    return { bias: 'SELL', strength: 0.4, reason: `Greed (${value}) — mild SELL bias` };
  }
  return { bias: 'NEUTRAL', strength: 0, reason: `Neutral (${value})` };
}
