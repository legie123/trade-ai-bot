// ============================================================
// Heuristic Sentiment Adapter — key-less, rule-based
//
// ADDITIVE. Zero-key default so sentiment pipeline is ALWAYS functional.
// When user wires OPENAI/DEEPSEEK/GEMINI, swap via SENTIMENT_ADAPTER env.
// This heuristic is a baseline, not a final product.
// ============================================================
import {
  FeedHealth,
  NewsItem,
  SentimentAdapter,
  SentimentLabel,
  SentimentScore,
  decayRelevance,
} from '../types';

// Positive words → bullish
const POS = [
  'surge', 'surges', 'rally', 'rallies', 'soar', 'soars', 'jump', 'jumps',
  'gains', 'gain', 'bull', 'bullish', 'approval', 'approved', 'breakout',
  'ath', 'all-time high', 'adopt', 'adopts', 'partnership', 'acquire',
  'acquires', 'launch', 'launches', 'beats', 'record', 'positive',
  'green', 'upgrade', 'upgraded', 'institutional', 'inflow', 'inflows',
  'demand', 'accumulate', 'accumulation', 'recovery', 'rebound',
];

// Negative words → bearish
const NEG = [
  'crash', 'crashes', 'plunge', 'plunges', 'tumble', 'tumbles', 'dump',
  'sell-off', 'selloff', 'bear', 'bearish', 'hack', 'hacked', 'exploit',
  'exploited', 'rug', 'rugpull', 'scam', 'lawsuit', 'sue', 'sues',
  'banned', 'ban', 'reject', 'rejects', 'rejection', 'downgrade',
  'outflow', 'outflows', 'fud', 'fear', 'panic', 'liquidation',
  'liquidated', 'bankruptcy', 'bankrupt', 'delisted', 'delist',
  'halt', 'halts', 'probe', 'investigation', 'fine', 'fined',
];

function scoreText(text: string): { score: number; confidence: number } {
  const lower = text.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POS) if (lower.includes(w)) pos++;
  for (const w of NEG) if (lower.includes(w)) neg++;
  const total = pos + neg;
  if (total === 0) return { score: 0, confidence: 0.1 };
  const score = (pos - neg) / total;
  // Confidence grows with hit density, capped at 0.8 (heuristic ≠ certainty)
  const confidence = Math.min(0.8, 0.2 + total * 0.1);
  return { score, confidence };
}

function labelOf(score: number, confidence: number): SentimentLabel {
  if (confidence < 0.2) return 'neutral';
  if (score > 0.25) return 'bullish';
  if (score < -0.25) return 'bearish';
  if (Math.abs(score) < 0.1) return 'neutral';
  return 'mixed';
}

export class HeuristicSentimentAdapter implements SentimentAdapter {
  readonly name = 'heuristic';
  private health: FeedHealth = {
    adapter: this.name,
    enabled: true,
    configured: true,
    lastFetchAt: null,
    lastFetchOk: true,
    lastError: null,
    totalFetches: 0,
    totalItems: 0,
  };

  isConfigured(): boolean {
    return true;
  }

  freshnessWindowMs(): number | null {
    return null;
  }

  async fetch(): Promise<SentimentScore[]> {
    // Not a primary fetcher. Use scoreItems.
    return [];
  }

  async scoreItems(items: NewsItem[]): Promise<SentimentScore[]> {
    this.health.totalFetches++;
    this.health.lastFetchAt = Date.now();
    const now = Date.now();
    const scores: SentimentScore[] = items.map((n) => {
      const text = `${n.title} ${n.summary || ''}`;
      const { score, confidence } = scoreText(text);
      const age = Math.max(0, now - n.publishedAt);
      const relevance = decayRelevance(age);
      return {
        itemId: n.id,
        label: labelOf(score, confidence),
        score,
        confidence,
        entities: [...n.symbols, ...n.topics],
        relevance,
        adapter: this.name,
        scoredAt: now,
      };
    });
    this.health.lastFetchOk = true;
    this.health.totalItems += scores.length;
    return scores;
  }

  getHealth(): FeedHealth {
    return { ...this.health };
  }
}

export const heuristicSentimentAdapter = new HeuristicSentimentAdapter();
