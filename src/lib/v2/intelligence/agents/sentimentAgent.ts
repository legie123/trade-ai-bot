// ============================================================
// Sentiment Agent — scores latest news with configured adapter
//
// ADDITIVE. Caches per INTEL_SENTIMENT_CACHE_MS (default 90s). Serves
// stale on error. Aggregates per symbol and per topic for ranker.
// ============================================================
import { createLogger } from '@/lib/core/logger';
import { SentimentScore, decayRelevance } from '../feeds/types';
import { getSentimentAdapter } from '../feeds/registry';
import { newsCollector } from './newsCollector';

const log = createLogger('SentimentAgent');
const CACHE_MS_DEFAULT = 90_000;

export interface SymbolSentiment {
  symbol: string;
  aggScore: number;        // weighted by confidence × relevance
  bullish: number;
  bearish: number;
  neutral: number;
  mixed: number;
  count: number;
  lastUpdateAt: number;
}

export interface SentimentSnapshot {
  generatedAt: number;
  adapter: string;
  totalItems: number;
  scores: SentimentScore[];
  bySymbol: SymbolSentiment[];
  overall: {
    aggScore: number;
    label: 'bullish' | 'bearish' | 'neutral' | 'mixed';
    count: number;
  };
}

export class SentimentAgent {
  private static instance: SentimentAgent;
  private cache: SentimentSnapshot | null = null;
  private inflight: Promise<SentimentSnapshot> | null = null;

  public static getInstance(): SentimentAgent {
    if (!SentimentAgent.instance) SentimentAgent.instance = new SentimentAgent();
    return SentimentAgent.instance;
  }

  private cacheMs(): number {
    return Number(process.env.INTEL_SENTIMENT_CACHE_MS || CACHE_MS_DEFAULT);
  }

  public async getSnapshot(force = false): Promise<SentimentSnapshot> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.generatedAt < this.cacheMs()) {
      return this.cache;
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.build()
      .catch((e): SentimentSnapshot => {
        log.error('sentiment build failed', { error: String(e) });
        if (this.cache) return this.cache;
        const empty: SentimentSnapshot = {
          generatedAt: Date.now(),
          adapter: getSentimentAdapter().name,
          totalItems: 0,
          scores: [],
          bySymbol: [],
          overall: { aggScore: 0, label: 'neutral', count: 0 },
        };
        return empty;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async build(): Promise<SentimentSnapshot> {
    const news = await newsCollector.getLatest();
    const adapter = getSentimentAdapter();
    const scores = await adapter.scoreItems(news);

    const bySymbolMap = new Map<string, SymbolSentiment>();
    let totalAgg = 0;
    let totalWeight = 0;
    const counts = { bullish: 0, bearish: 0, neutral: 0, mixed: 0 };

    for (const s of scores) {
      const weight = s.confidence * s.relevance;
      totalAgg += s.score * weight;
      totalWeight += weight;
      counts[s.label]++;

      for (const sym of s.entities) {
        if (!/^[A-Z0-9]{2,6}$/.test(sym)) continue; // filter only ticker-like
        let slot = bySymbolMap.get(sym);
        if (!slot) {
          slot = {
            symbol: sym,
            aggScore: 0,
            bullish: 0,
            bearish: 0,
            neutral: 0,
            mixed: 0,
            count: 0,
            lastUpdateAt: 0,
          };
          bySymbolMap.set(sym, slot);
        }
        slot.aggScore += s.score * weight;
        slot.count++;
        slot[s.label]++;
        slot.lastUpdateAt = Math.max(slot.lastUpdateAt, s.scoredAt);
      }
    }

    // Normalize per-symbol
    const bySymbol = Array.from(bySymbolMap.values()).map((sym) => {
      const w = sym.count || 1;
      return { ...sym, aggScore: Number((sym.aggScore / w).toFixed(4)) };
    }).sort((a, b) => Math.abs(b.aggScore) - Math.abs(a.aggScore));

    const overallAgg = totalWeight > 0 ? totalAgg / totalWeight : 0;
    const overallLabel: 'bullish' | 'bearish' | 'neutral' | 'mixed' =
      overallAgg > 0.2 ? 'bullish' : overallAgg < -0.2 ? 'bearish' : Math.abs(overallAgg) < 0.05 ? 'neutral' : 'mixed';

    const snap: SentimentSnapshot = {
      generatedAt: Date.now(),
      adapter: adapter.name,
      totalItems: news.length,
      scores,
      bySymbol,
      overall: { aggScore: Number(overallAgg.toFixed(4)), label: overallLabel, count: scores.length },
    };
    this.cache = snap;
    return snap;
  }

  /**
   * Fast symbol lookup for ranker. Uses cached snapshot, null if absent.
   */
  public getSymbolScore(symbol: string): SymbolSentiment | null {
    if (!this.cache) return null;
    return this.cache.bySymbol.find((s) => s.symbol === symbol.toUpperCase()) || null;
  }
}

export const sentimentAgent = SentimentAgent.getInstance();

// Re-export for consumers
export { decayRelevance };
