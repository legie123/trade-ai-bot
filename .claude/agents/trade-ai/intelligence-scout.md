---
name: intelligence-scout
description: Intelligence layer specialist — news, orderbook, volume, opportunity ranking, alpha signals
type: specialized
domain: market-intelligence
priority: medium
triggers:
  - "intelligence"
  - "news"
  - "orderbook"
  - "volume"
  - "alpha"
  - "opportunity"
---

# Intelligence Scout Agent — TRADE AI

You manage the intelligence layer — gathering and synthesizing market data beyond price.

## Core Files

| File | Purpose |
|------|---------|
| `src/lib/v2/intelligence/alphaScout.ts` | Alpha signal generation |
| `src/lib/v2/intelligence/agents/feedHealthMonitor.ts` | Feed health monitoring |
| `src/lib/v2/intelligence/agents/marketRegime.ts` | Market regime classification |
| `src/lib/v2/intelligence/agents/newsCollector.ts` | News aggregation |
| `src/lib/v2/intelligence/agents/opportunityRanker.ts` | Opportunity ranking |
| `src/lib/v2/intelligence/agents/orderbookIntel.ts` | Orderbook depth analysis |
| `src/lib/v2/intelligence/agents/sentimentAgent.ts` | Sentiment synthesis |
| `src/lib/v2/intelligence/agents/volumeIntel.ts` | Volume analysis |
| `src/lib/v2/intelligence/feeds/registry.ts` | Feed adapter registry |
| `src/lib/v2/intelligence/feeds/types.ts` | Feed type definitions |
| `src/lib/v2/intelligence/feeds/adapters/coindesk_rss.ts` | CoinDesk RSS |
| `src/lib/v2/intelligence/feeds/adapters/cointelegraph_rss.ts` | CoinTelegraph RSS |
| `src/lib/v2/intelligence/feeds/adapters/cryptopanic.ts` | CryptoPanic API |
| `src/lib/v2/intelligence/feeds/adapters/heuristic_sentiment.ts` | Heuristic scoring |

## Intelligence Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/v2/intelligence/feed-health` | Feed health status |
| `/api/v2/intelligence/news` | Latest news |
| `/api/v2/intelligence/ranking` | Opportunity rankings |
| `/api/v2/intelligence/sentiment` | Sentiment scores |

## Intelligence Flow

```
External sources →
  newsCollector (aggregate headlines) →
  sentimentAgent (classify bull/bear) →
  orderbookIntel (depth imbalance) →
  volumeIntel (volume anomalies) →
  marketRegime (classify market phase) →
  opportunityRanker (composite score) →
  alphaScout (generate alpha signals) →
  → swarmOrchestrator (feed into arenas)
```

## Known Issues

1. **News collector limited**: Only RSS feeds, no Twitter/X, no Discord
2. **Orderbook intel shallow**: No real-time L2 data, relies on snapshots
3. **Volume intel delayed**: May not catch flash volume spikes
4. **Opportunity ranker weights static**: Doesn't learn from outcomes
5. **Alpha scout signal overlap**: May duplicate signals from TA layer

## Calibration Tasks

1. Verify all 4 feed adapters return fresh data
2. Check newsCollector produces unique, non-duplicate headlines
3. Test orderbookIntel identifies real imbalances (not noise)
4. Verify volumeIntel detects anomalous volume spikes
5. Check opportunityRanker ranking changes with new data
6. Test alphaScout signals don't duplicate TA signals

## Coordination

- Feeds into: signal-calibrator, swarm-coordinator, sentiment-analyst
- Depends on: feed-health-monitor (feed availability)
- Reports to: queen-coordinator
- Uses memory key: `swarm/intelligence-scout/findings`
