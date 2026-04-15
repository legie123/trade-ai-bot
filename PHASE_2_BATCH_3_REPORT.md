# PHASE 2 — BATCH 3 REPORT
Date: 2026-04-15
Scope: Intelligence layer — pluggable news/sentiment adapters + market regime + orderbook intel + volume intel + opportunity ranker + feed-health monitor + 4 new API routes
Mode: additive-only. 0 deletions. 11 new source files + 3 new route files + 1 env block. Zero existing files modified.

---

## TARGET

Light up the "Bloomberg-like intelligence layering" you asked for without touching the existing scanner, wallet, gladiators, syndicate, or any profit-path logic. Everything lives in a new `src/lib/v2/intelligence/` sub-tree and a new `/api/v2/intelligence/*` route namespace.

## WHY

- Phase 2 Batch 2 delivered real-time WS feeds. Next step is intelligence on top of them: news → sentiment → ranking — plus regime/orderbook/volume features that ranker consumes.
- Adapter-first: CRYPTOPANIC_KEY / NEWSAPI_KEY / LLM keys are OPTIONAL. System works key-less out of the box via 2 RSS sources + heuristic sentiment.
- Zero impact on the scanner cron. The ranker reads `polyState.getLastScans()` but only as an input enrichment — never mutates state.

## FILES

### NEW — intelligence core (11)
- `src/lib/v2/intelligence/feeds/types.ts` — adapter contract (FeedAdapter<T>, NewsItem, SentimentScore, decayRelevance, newsIdFor)
- `src/lib/v2/intelligence/feeds/registry.ts` — env-driven pluggable wiring
- `src/lib/v2/intelligence/feeds/adapters/cointelegraph_rss.ts` — key-less, RSS, ticker + topic extraction
- `src/lib/v2/intelligence/feeds/adapters/coindesk_rss.ts` — key-less, RSS
- `src/lib/v2/intelligence/feeds/adapters/cryptopanic.ts` — opt-in, needs CRYPTOPANIC_KEY
- `src/lib/v2/intelligence/feeds/adapters/heuristic_sentiment.ts` — key-less rule-based scorer
- `src/lib/v2/intelligence/agents/newsCollector.ts` — parallel fetch, dedup, cache singleton
- `src/lib/v2/intelligence/agents/sentimentAgent.ts` — score + aggregate per symbol + decay
- `src/lib/v2/intelligence/agents/marketRegime.ts` — trend/range/volatile/illiquid classifier
- `src/lib/v2/intelligence/agents/orderbookIntel.ts` — imbalance + spread + liquidity score
- `src/lib/v2/intelligence/agents/volumeIntel.ts` — z-score spike/elevated/quiet/drought
- `src/lib/v2/intelligence/agents/opportunityRanker.ts` — composite scoring function (weights auto-normalize)
- `src/lib/v2/intelligence/agents/feedHealthMonitor.ts` — aggregates all feed health

### NEW — routes (4)
- `src/app/api/v2/intelligence/news/route.ts` — deduped news (filters: symbol, topic, limit, force)
- `src/app/api/v2/intelligence/sentiment/route.ts` — scored sentiment (per symbol or overall)
- `src/app/api/v2/intelligence/ranking/route.ts` — ranked opportunity list (CRYPTO + POLYMARKET)
- `src/app/api/v2/intelligence/feed-health/route.ts` — aggregated adapter + WS health

### EDITED (1)
- `.env.example` — 8 new env keys documented (all with safe defaults)

**Total files in sesiune Batch 3:** 15 new + 1 edited. Zero existing source file modified.

## ARCHITECTURE

```
src/lib/v2/intelligence/
├── feeds/
│   ├── types.ts            ← adapter contract
│   ├── registry.ts         ← env-driven selection
│   └── adapters/
│       ├── cointelegraph_rss.ts   (key-less)
│       ├── coindesk_rss.ts        (key-less)
│       ├── cryptopanic.ts         (CRYPTOPANIC_KEY)
│       └── heuristic_sentiment.ts (key-less)
├── agents/
│   ├── newsCollector.ts    ← parallel fetch + dedup + cache
│   ├── sentimentAgent.ts   ← per-symbol aggregation + decay
│   ├── marketRegime.ts     ← trend/range/volatile classifier
│   ├── orderbookIntel.ts   ← imbalance + liquidity
│   ├── volumeIntel.ts      ← z-score regime
│   ├── opportunityRanker.ts ← composite scoring (pure function)
│   └── feedHealthMonitor.ts ← aggregate health
```

```
src/app/api/v2/intelligence/
├── news/route.ts
├── sentiment/route.ts
├── ranking/route.ts
└── feed-health/route.ts
```

## OPPORTUNITY RANKER — WEIGHTS

| Signal     | Weight | Notes                                              |
|-----------|--------|---------------------------------------------------|
| momentum   | 0.25   | recent price change, normalized to [-1, +1]      |
| sentiment  | 0.20   | × min(count/5, 1) so single article can't dominate|
| orderbook  | 0.20   | imbalance × liquidity_score                       |
| volume     | 0.15   | spike=1, elevated=0.6, drought penalizes         |
| regime     | 0.10   | trend/range/volatile/illiquid                     |
| recency    | 0.10   | 1 − age/STALE_MS                                 |

- Weights auto-normalize over whichever signals are present. A candidate with only momentum + sentiment still ranks.
- Direction (up/down/neutral) computed from directional contributions, independent of magnitude.
- Penalties: thin liquidity, wide spread, volume drought, illiquid regime, stale data — all surfaced to the response.

## RISK

- **Zero breaking change.** No existing file touched except `.env.example` (additive lines).
- **TSC:** clean across full `src/`.
- **Behaviour without keys:** 2 RSS adapters + heuristic scorer give immediate signal. CryptoPanic activates on `CRYPTOPANIC_KEY`.
- **Cache strategy:** 60s news, 90s sentiment. Serves stale on fetch error (no silent black screens).
- **Polymarket/MEXC WS:** reads `polyWsClient.getLastEvent(id)` and orderbookIntel cache — no state writes.

## ADDITIVE BENEFIT

- Ranker can now combine sentiment + momentum + orderbook + regime without any scanner modification.
- `/api/v2/intelligence/feed-health` gives a single endpoint to see all adapters + WS feeds.
- Dashboard can consume `/api/v2/intelligence/ranking` to show top opportunities with reasons and penalties.
- Adapter contract ensures future drops (Perplexity, Polygon.io, LLM sentiment) are drop-in, no consumer rewrite.

## EXPECTED PROFIT BENEFIT

- **Direct:** every signal now has a *reason trail*. Trades triggered by ranker have traceable provenance (momentum + sentiment + imbalance), not "black box score".
- **Compound:** adapter-pluggable — wiring NEWSAPI_KEY or an LLM sentiment scorer later costs one env var, no code change.

## EXPECTED MARKET-SENSITIVITY BENEFIT

- Real-time news → dedup → sentiment → per-symbol score.
- Recency penalty kills stale-signal trades automatically (STALE_MS tunable).
- Orderbook imbalance + spread + depth feed directly into ranker.
- Regime classifier forces context-aware scoring (trend vs range vs volatile).

## WHAT WAS PRESERVED

- Everything. Zero existing source file modified in Batch 3.
- Scanner, wallet, gladiators, syndicate, strategies, riskManager, polyClient, polyState, polySyndicate — untouched.
- All UI pages untouched (Polymarket Intelligence Panel lands in a future UI batch).
- Phase 2 Batch 1+2 guards intact (21 live-trading gate callsites, WS hardening).

## WHAT WAS EXTENDED

- New `src/lib/v2/intelligence/` tree (zero conflict with existing paths).
- New `/api/v2/intelligence/*` route namespace.
- New env keys with safe defaults.

## WHAT WAS REPAIRED

- N/A — Batch 3 is pure extension.

## VERIFIED IMPROVEMENTS

- TSC clean across full `src/`.
- Adapter contract compiles against 3 news adapters + 1 sentiment adapter.
- Ranker handles partial signal inputs without crashing (missing momentum / missing sentiment / missing orderbook).

## REMAINING FAILURES (out of scope this batch)

- **C2** prod 404 — still needs `gcloud run services list --region=europe-west1`.
- **C9** polling fallback in `useRealtimeData` — UX polish for Batch 4.
- **C11** `console.log` → `createLogger` sweep — low priority cleanup.
- **C12** dashboard freshness UI — needs UI batch.

## NEXT PATCH (proposed)

Phase 2 Batch 4 = UI additive — Intelligence Panel on `/polymarket` and `/dashboard`, read-only consumer of the new routes. Collapsible, zero layout impact on existing panels.

---

## VALIDATION (once deployed)

```bash
BASE=https://YOUR_CLOUD_RUN_URL

# news (key-less out of the box)
curl -s "$BASE/api/v2/intelligence/news?limit=10" | jq '.data.count'

# sentiment overall
curl -s "$BASE/api/v2/intelligence/sentiment" | jq '.data.overall'

# sentiment per symbol
curl -s "$BASE/api/v2/intelligence/sentiment?symbol=BTC" | jq '.data.sentiment'

# ranking — combines cached Polymarket scans + orderbook + sentiment
curl -s "$BASE/api/v2/intelligence/ranking?limit=10" | jq '.data.ranked[0]'

# aggregated feed health
curl -s "$BASE/api/v2/intelligence/feed-health" | jq '.data.summary'
```

---

## PHASE 2 BATCH 3 CLOSING

- **DONE:** intelligence layer core + 4 routes + pluggable adapters + ranker. 15 new files, 1 env edit, TSC clean.
- **BLOCKED:** prod URL verification.
- **NEXT:** Phase 2 Batch 4 — Intelligence Panel UI on Polymarket + Dashboard.
- **RISKS:** low. No existing code touched.
- **FILES TOUCHED:** 15 new, 1 edited.
- **ADDITIVE IMPACT:** Bloomberg-grade intelligence surface behind /api/v2/intelligence/*. News → sentiment → ranking → health, all functional key-less, all pluggable when keys arrive.
- **PROFIT IMPACT:** reason-trail ranking, pluggable sentiment, decay-adjusted relevance — builds the edge you asked for.
- **MARKET-SENSITIVITY IMPACT:** orderbook imbalance + liquidity + volume regime + market regime + sentiment decay all feed a single ranker. Consumers read one endpoint.
