// ============================================================
// Cointelegraph RSS adapter — key-less, crypto-focused
//
// ADDITIVE. No API key required. Safe default adapter so the news
// pipeline has signal even when user hasn't wired NEWSAPI/CRYPTOPANIC.
// ============================================================
import { createLogger } from '@/lib/core/logger';
import { FeedAdapter, FeedHealth, NewsItem, newsIdFor } from '../types';

const log = createLogger('Adapter-Cointelegraph');
const RSS_URL = 'https://cointelegraph.com/rss';
const FETCH_TIMEOUT_MS = 8000;
const SOURCE_CREDIBILITY = 0.75;

// Very small, dependency-free RSS 2.0 parser (title + link + pubDate + description)
function parseRssItems(xml: string): Array<{
  title: string;
  link: string;
  pubDate: string;
  description: string;
}> {
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(itemRegex) || [];
  for (const block of matches) {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const description = extractTag(block, 'description');
    if (title && link) items.push({ title, link, pubDate, description });
  }
  return items;
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  let text = m[1];
  // Strip CDATA
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Strip HTML tags in description
  text = text.replace(/<[^>]+>/g, '');
  return text.trim();
}

const SYMBOL_PATTERNS: Array<{ re: RegExp; sym: string }> = [
  { re: /\bbitcoin\b|\bbtc\b/i, sym: 'BTC' },
  { re: /\bethereum\b|\beth\b/i, sym: 'ETH' },
  { re: /\bsolana\b|\bsol\b/i, sym: 'SOL' },
  { re: /\bxrp\b|\bripple\b/i, sym: 'XRP' },
  { re: /\bdogecoin\b|\bdoge\b/i, sym: 'DOGE' },
  { re: /\bcardano\b|\bada\b/i, sym: 'ADA' },
  { re: /\bavalanche\b|\bavax\b/i, sym: 'AVAX' },
  { re: /\bchainlink\b|\blink\b/i, sym: 'LINK' },
  { re: /\bpolkadot\b|\bdot\b/i, sym: 'DOT' },
  { re: /\bpolygon\b|\bmatic\b/i, sym: 'MATIC' },
];

function extractSymbols(text: string): string[] {
  const hits = new Set<string>();
  for (const { re, sym } of SYMBOL_PATTERNS) {
    if (re.test(text)) hits.add(sym);
  }
  return Array.from(hits);
}

const TOPIC_PATTERNS: Array<{ re: RegExp; topic: string }> = [
  { re: /regulation|sec\b|cftc|lawsuit|court/i, topic: 'regulation' },
  { re: /etf|spot etf/i, topic: 'etf' },
  { re: /hack|exploit|rug|scam/i, topic: 'security' },
  { re: /fed|rate cut|rate hike|cpi|inflation|macro/i, topic: 'macro' },
  { re: /election|trump|biden|politic/i, topic: 'politics' },
  { re: /defi|lending|dex/i, topic: 'defi' },
  { re: /stablecoin|usdt|usdc/i, topic: 'stablecoin' },
];

function extractTopics(text: string): string[] {
  const hits = new Set<string>(['crypto']);
  for (const { re, topic } of TOPIC_PATTERNS) {
    if (re.test(text)) hits.add(topic);
  }
  return Array.from(hits);
}

export class CointelegraphRssAdapter implements FeedAdapter<NewsItem> {
  readonly name = 'cointelegraph-rss';
  private health: FeedHealth = {
    adapter: this.name,
    enabled: true,
    configured: true, // key-less
    lastFetchAt: null,
    lastFetchOk: false,
    lastError: null,
    totalFetches: 0,
    totalItems: 0,
  };

  isConfigured(): boolean {
    return true;
  }

  freshnessWindowMs(): number | null {
    return 10 * 60_000; // 10 min is a decent poll interval for RSS
  }

  async fetch(): Promise<NewsItem[]> {
    this.health.totalFetches++;
    this.health.lastFetchAt = Date.now();
    try {
      const res = await fetch(RSS_URL, {
        method: 'GET',
        headers: { 'User-Agent': 'TradeAI-Intel/1.0', Accept: 'application/rss+xml, text/xml, */*' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const raw = parseRssItems(xml);
      const now = Date.now();
      const items: NewsItem[] = raw.map((r) => {
        const publishedMs = Date.parse(r.pubDate) || now;
        const text = `${r.title} ${r.description}`;
        return {
          id: newsIdFor(r.link, r.title),
          title: r.title,
          url: r.link,
          source: this.name,
          sourceCredibility: SOURCE_CREDIBILITY,
          publishedAt: publishedMs,
          fetchedAt: now,
          summary: r.description || null,
          topics: extractTopics(text),
          symbols: extractSymbols(text),
          language: 'en',
          raw: r,
        };
      });
      this.health.lastFetchOk = true;
      this.health.lastError = null;
      this.health.totalItems = items.length;
      return items;
    } catch (err) {
      this.health.lastFetchOk = false;
      this.health.lastError = (err as Error).message;
      log.warn('cointelegraph fetch failed', { error: this.health.lastError });
      return [];
    }
  }

  getHealth(): FeedHealth {
    return { ...this.health };
  }
}

export const cointelegraphRssAdapter = new CointelegraphRssAdapter();
