// ============================================================
// Adapter Registry — pluggable wiring
//
// ADDITIVE. Controlled by env var NEWS_ADAPTERS (comma list).
// Default: cointelegraph-rss, coindesk-rss (both key-less).
// SENTIMENT_ADAPTER selects the sentiment scorer (default: heuristic).
// ============================================================
import { FeedAdapter, NewsItem, SentimentAdapter } from './types';
import { cointelegraphRssAdapter } from './adapters/cointelegraph_rss';
import { coindeskRssAdapter } from './adapters/coindesk_rss';
import { cryptoPanicAdapter } from './adapters/cryptopanic';
import { heuristicSentimentAdapter } from './adapters/heuristic_sentiment';

const ALL_NEWS: Record<string, FeedAdapter<NewsItem>> = {
  'cointelegraph-rss': cointelegraphRssAdapter,
  'coindesk-rss': coindeskRssAdapter,
  cryptopanic: cryptoPanicAdapter,
};

const ALL_SENTIMENT: Record<string, SentimentAdapter> = {
  heuristic: heuristicSentimentAdapter,
};

export function getEnabledNewsAdapters(): FeedAdapter<NewsItem>[] {
  const cfg = (process.env.NEWS_ADAPTERS || 'cointelegraph-rss,coindesk-rss,cryptopanic')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: FeedAdapter<NewsItem>[] = [];
  for (const name of cfg) {
    const a = ALL_NEWS[name];
    if (a && a.isConfigured()) out.push(a);
  }
  return out;
}

export function getSentimentAdapter(): SentimentAdapter {
  const chosen = (process.env.SENTIMENT_ADAPTER || 'heuristic').trim().toLowerCase();
  return ALL_SENTIMENT[chosen] || ALL_SENTIMENT.heuristic;
}

export function listAllAdapters(): {
  news: Array<{ name: string; configured: boolean; enabled: boolean }>;
  sentiment: Array<{ name: string; configured: boolean }>;
} {
  const cfgSet = new Set(
    (process.env.NEWS_ADAPTERS || 'cointelegraph-rss,coindesk-rss,cryptopanic')
      .split(',')
      .map((s) => s.trim().toLowerCase())
  );
  return {
    news: Object.entries(ALL_NEWS).map(([name, a]) => ({
      name,
      configured: a.isConfigured(),
      enabled: cfgSet.has(name),
    })),
    sentiment: Object.entries(ALL_SENTIMENT).map(([name, a]) => ({
      name,
      configured: a.isConfigured(),
    })),
  };
}
