// ============================================================
// Feed Health Monitor — aggregates health of all intel feeds + WS
// Consumed by /api/v2/intelligence/feed-health and /api/live-stream.
// ============================================================
import { listAllAdapters, getEnabledNewsAdapters, getSentimentAdapter } from '../feeds/registry';
import { FeedHealth } from '../feeds/types';
import { polyWsClient } from '@/lib/polymarket/polyWsClient';
import { WsStreamManager } from '@/lib/providers/wsStreams';

export interface AggregateFeedHealth {
  generatedAt: number;
  adapters: {
    news: FeedHealth[];
    sentiment: FeedHealth[];
  };
  ws: {
    polymarket: ReturnType<typeof polyWsClient.getFeedHealth>;
    mexc: ReturnType<typeof WsStreamManager.prototype.getFeedHealth>;
  };
  summary: {
    newsAdapters: { enabled: number; configured: number; total: number };
    sentimentAdapter: { name: string; configured: boolean };
    wsAnyConnected: boolean;
  };
}

export function getAggregateFeedHealth(): AggregateFeedHealth {
  const all = listAllAdapters();
  const enabledNews = getEnabledNewsAdapters();
  const newsHealth = enabledNews.map((a) => a.getHealth());
  const sentAdapter = getSentimentAdapter();
  const sentimentHealth = [sentAdapter.getHealth()];

  const polyHealth = polyWsClient.getFeedHealth();
  const mexcHealth = WsStreamManager.getInstance().getFeedHealth();

  return {
    generatedAt: Date.now(),
    adapters: { news: newsHealth, sentiment: sentimentHealth },
    ws: { polymarket: polyHealth, mexc: mexcHealth },
    summary: {
      newsAdapters: {
        enabled: all.news.filter((a) => a.enabled).length,
        configured: all.news.filter((a) => a.configured).length,
        total: all.news.length,
      },
      sentimentAdapter: { name: sentAdapter.name, configured: sentAdapter.isConfigured() },
      wsAnyConnected: polyHealth.connected || mexcHealth.connected,
    },
  };
}
