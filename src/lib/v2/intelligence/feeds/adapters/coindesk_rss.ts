// ============================================================
// CoinDesk RSS adapter — key-less, crypto-focused, secondary source
// ============================================================
import { createLogger } from '@/lib/core/logger';
import { FeedAdapter, FeedHealth, NewsItem, newsIdFor } from '../types';

const log = createLogger('Adapter-CoinDesk');
const RSS_URL = 'https://www.coindesk.com/arc/outboundfeeds/rss/';
const FETCH_TIMEOUT_MS = 8000;
const SOURCE_CREDIBILITY = 0.8;

function parseRssItems(xml: string) {
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(itemRegex) || [];
  for (const block of matches) {
    const title = extract(block, 'title');
    const link = extract(block, 'link');
    const pubDate = extract(block, 'pubDate');
    const description = extract(block, 'description');
    if (title && link) items.push({ title, link, pubDate, description });
  }
  return items;
}

function extract(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

const SYMBOL_PATTERNS: Array<{ re: RegExp; sym: string }> = [
  { re: /\bbitcoin\b|\bbtc\b/i, sym: 'BTC' },
  { re: /\bethereum\b|\beth\b/i, sym: 'ETH' },
  { re: /\bsolana\b|\bsol\b/i, sym: 'SOL' },
  { re: /\bxrp\b|\bripple\b/i, sym: 'XRP' },
  { re: /\bdogecoin\b|\bdoge\b/i, sym: 'DOGE' },
];

function extractSymbols(text: string): string[] {
  const hits = new Set<string>();
  for (const { re, sym } of SYMBOL_PATTERNS) if (re.test(text)) hits.add(sym);
  return Array.from(hits);
}

export class CoindeskRssAdapter implements FeedAdapter<NewsItem> {
  readonly name = 'coindesk-rss';
  private health: FeedHealth = {
    adapter: this.name,
    enabled: true,
    configured: true,
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
    return 10 * 60_000;
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
          topics: ['crypto'],
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
      log.warn('coindesk fetch failed', { error: this.health.lastError });
      return [];
    }
  }

  getHealth(): FeedHealth {
    return { ...this.health };
  }
}

export const coindeskRssAdapter = new CoindeskRssAdapter();
