# Graph Report - /home/runner/work/trade-ai-bot/trade-ai-bot/src  (2026-04-20)

## Corpus Check
- 324 files · ~266,947 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1623 nodes · 3117 edges · 97 communities detected
- Extraction: 70% EXTRACTED · 30% INFERRED · 0% AMBIGUOUS · INFERRED: 941 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]

## God Nodes (most connected - your core abstractions)
1. `GET()` - 320 edges
2. `POST()` - 121 edges
3. `DELETE()` - 27 edges
4. `GladiatorStore` - 26 edges
5. `providerFetch()` - 21 edges
6. `mexcRequest()` - 17 edges
7. `PolyWsClient` - 17 edges
8. `assertLiveTradingAllowed()` - 17 edges
9. `executeMexcTrade()` - 16 edges
10. `getAggregatedTokens()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `updatePostTrade()` --calls--> `update()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/v2/audit/decisionLog.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/components/LiveIndicator.tsx
- `GET()` --calls--> `getMoltbookTelemetry()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/app/api/dashboard/route.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/moltbook/moltbookClient.ts
- `GET()` --calls--> `getRecentEvents()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/app/api/dashboard/route.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/v2/alerts/eventHub.ts
- `resetWallet()` --calls--> `DELETE()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/v2/paper/paperWallet.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/app/api/auth/route.ts
- `_doInit()` --calls--> `spawnPolyGladiator()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/polymarket/polyState.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/polymarket/polyGladiators.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (116): calculateAdaptiveSize(), errorResponse(), successResponse(), captureDivisionSnapshot(), captureSnapshot(), persistAsync(), persistDivAsync(), recentDivisionSnapshots() (+108 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (35): TheButcher, wilsonLower(), runDailyRotation(), getGladiatorBattles(), getGladiatorDna(), getGladiatorsFromDb(), refreshGladiatorsFromCloud(), saveGladiatorsToDb() (+27 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (63): MexcAdapter, getResilientPrice(), binanceRequest(), getBinanceBalances(), getBinanceConfig(), getBinanceExchangeInfo(), getBinanceOpenPositions(), getBinancePrice() (+55 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (54): alertBetPlaced(), alertBetResolved(), alertDailyDigest(), alertRiskHalt(), isRateLimited(), sendTelegramAlert(), TELEGRAM_BOT_TOKEN(), TELEGRAM_CHAT_ID() (+46 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (52): fetchWithRetry(), sleep(), calcBollingerBands(), sma(), stdDev(), analyzeBTC(), calcEMA(), emptyResult() (+44 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (64): CointelegraphRssAdapter, extractSymbols(), extractTag(), extractTopics(), parseRssItems(), addGladiatorDna(), addGladiatorDnaBatch(), addLivePosition() (+56 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (42): getBotConfig(), getDecisions(), getEquityCurve(), getLivePositions(), getSyncQueueStats(), getFreshHealthSnapshot(), startHeartbeat(), takeSnapshot() (+34 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (30): releaseTaskLease(), tryAcquireTaskLease(), recordProviderHealth(), MemoryCache, costUsd(), ensureEntry(), getLlmCostSnapshot(), getMarketCost() (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (23): AutoDebugEngine, callLLM(), costUsd(), isAbortError(), priceFor(), recordCall(), acquireTradeLock(), addDecision() (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (30): AlphaScout, GladiatorRegistry, buildAllSettlementStats(), buildDivisionSummaries(), buildFactorDrift(), buildGladiatorActivity(), buildSettlementStats(), buildWeeklyReport() (+22 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (46): buildReasoning(), classifyRisk(), determineRecommendation(), evaluateOpportunity(), getEdgeFloor(), getPriceHistory(), scanDivision(), scoreLiquidity() (+38 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (42): checkHealth(), providerFetch(), birdeyeHealthCheck(), getMultiPrice(), getTokenOverview(), getTokenPrice(), headers(), calculateDealScore() (+34 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (37): envInt(), getBrainStatus(), mapEdge(), mapFeed(), mapSettlement(), probeEdge(), probeFeed(), probeOps() (+29 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (23): buildBearPrompt(), buildBullPrompt(), callLLM(), DebateEngine, heuristicDebate(), parseArgument(), scoreDebate(), flushBuffer() (+15 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (39): computeDegradation(), computeStats(), getCpcvConfig(), getCpcvMode(), isFoldOverfit(), loadTrades(), parseTsMs(), runCpcvValidate() (+31 more)

### Community 15 - "Community 15"
Cohesion: 0.08
Nodes (8): CryptoPanicAdapter, getAggregateFeedHealth(), HeuristicSentimentAdapter, NewsCollector, getEnabledNewsAdapters(), getSentimentAdapter(), listAllAdapters(), SentimentAgent

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (20): addSyndicateAudit(), callDeepSeek(), callGemini(), callOpenAI(), checkMarketDataAnchoring(), consensusCacheKey(), DualMasterConsciousness, executeDualEngineFallback() (+12 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (29): engageWithFeed(), extractInsightsWithLLM(), generateSmartReplyLLM(), runMoltbookDailySweep(), solveMathChallenge(), tryPostingToMoltbook(), bucketUpvotes(), callChat() (+21 more)

### Community 18 - "Community 18"
Cohesion: 0.1
Nodes (13): BybitAdapter, ExchangeRouter, bybitRequest(), cancelBybitOrder(), getBaseUrl(), getBybitBalance(), getBybitConfig(), getBybitOpenOrders() (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (14): OkxAdapter, cancelOkxOrder(), getOkxBalance(), getOkxConfig(), getOkxOpenOrders(), getOkxOrderbook(), getOkxPrice(), getOkxServerTime() (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.13
Nodes (21): cacheKey(), calcADX(), classifyRegime(), computeRegime(), evictIfFull(), getRegimeCacheStats(), getRegimeMode(), regimeMultiplier() (+13 more)

### Community 21 - "Community 21"
Cohesion: 0.1
Nodes (5): fmtAgo(), fmtNum(), isTableMissing(), load(), writerEnabled()

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (3): computeInsight(), ExperienceCache, ExperienceMemory

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (4): card(), hBg(), hColor(), uptime()

### Community 24 - "Community 24"
Cohesion: 0.23
Nodes (12): asNum(), asStr(), extractFields(), getEventsHealth(), insertGoldskyEvent(), queryEvents(), getFeedHealth(), probeGoldsky() (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.36
Nodes (10): analyzeSentimentLLM(), applyConfidencePenalties(), checkForContrarian(), fallbackKeywordScore(), getTemporalWeight(), levenshteinDistance(), OPENAI_API_KEY(), removeNoise() (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.36
Nodes (6): aggregateStats(), bootstrapPValueOosPositive(), computeDegradation(), computeStats(), isFoldOverfit(), WalkForwardEngine

### Community 27 - "Community 27"
Cohesion: 0.28
Nodes (4): CoindeskRssAdapter, extract(), extractSymbols(), parseRssItems()

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (2): pillStyle(), SourceBadge()

### Community 29 - "Community 29"
Cohesion: 0.52
Nodes (6): clamp01(), getMetaLabelConfig(), getMetaLabelMode(), normalizeSizing(), predict(), sigmoid()

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (2): logPolyEvent(), syncEventsToCloud()

### Community 31 - "Community 31"
Cohesion: 0.52
Nodes (6): calculateConviction(), scoreBB(), scoreFearGreed(), scoreMTF(), scoreRSI(), scoreVWAP()

### Community 32 - "Community 32"
Cohesion: 0.4
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 0.6
Nodes (3): getArenaConfig(), isEligibleForArena(), scoreGladiatorForArena()

### Community 34 - "Community 34"
Cohesion: 0.5
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (2): draw(), getStateColor()

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (2): downsample(), Sparkline()

### Community 37 - "Community 37"
Cohesion: 0.83
Nodes (3): logBrainStatusSnapshot(), pickVerdict(), randomSuffix()

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (2): execute(), handleItemKeyDown()

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (2): verdictBg(), verdictColor()

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (2): evaluateAlerts(), makeAlert()

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 0.67
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (0): 

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (0): 

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (0): 

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (0): 

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (0): 

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (0): 

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (0): 

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (0): 

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (0): 

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (0): 

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (0): 

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (0): 

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (0): 

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (0): 

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (0): 

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (0): 

### Community 92 - "Community 92"
Cohesion: 1.0
Nodes (0): 

### Community 93 - "Community 93"
Cohesion: 1.0
Nodes (0): 

### Community 94 - "Community 94"
Cohesion: 1.0
Nodes (0): 

### Community 95 - "Community 95"
Cohesion: 1.0
Nodes (0): 

### Community 96 - "Community 96"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 52`** (2 nodes): `BottomNav()`, `BottomNav.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `Sidebar.tsx`, `Sidebar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (2 nodes): `LoadingStates.tsx`, `Skeleton()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (2 nodes): `SentinelCouplingPanel.tsx`, `decisionColor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (2 nodes): `AppShell()`, `AppShell.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (2 nodes): `pnlCol()`, `DivisionTunerPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (2 nodes): `Toast.tsx`, `useToast()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `DirectionBadge()`, `DecisionMatrix.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (2 nodes): `PaperBacktestPanel.tsx`, `pnlColor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (2 nodes): `GoldDust()`, `GoldDust.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (2 nodes): `SwRegister.tsx`, `handleUpdate()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (2 nodes): `badgesEnabled()`, `ExplainCard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (2 nodes): `volumeIntel.ts`, `classifyVolume()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (2 nodes): `instrumentCron()`, `cronInstrument.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (2 nodes): `page.tsx`, `Home()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (2 nodes): `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (2 nodes): `DeepSeekStatus()`, `DeepSeekStatus.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (2 nodes): `page.tsx`, `deriveAgentState()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (2 nodes): `route.ts`, `classifyPost()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (2 nodes): `useRealtimeData.ts`, `useRealtimeData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (2 nodes): `useBotStats.ts`, `useBotStats()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `KpiBar.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `TradingViewChart.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `MoltbookSwarmFeed.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `DragonLogo.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `Sparkline.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `EquityCurve.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `SectorInfo.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `SyndicateFeed.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `theme.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (1 nodes): `polyTypes.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (1 nodes): `seedStrategies.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (1 nodes): `gladiator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (1 nodes): `strategy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (1 nodes): `radar.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (1 nodes): `scoringConfig.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (1 nodes): `route.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 22`, `Community 23`, `Community 24`, `Community 29`?**
  _High betweenness centrality (0.535) - this node is a cross-community bridge._
- **Why does `POST()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 13`, `Community 14`, `Community 16`, `Community 18`, `Community 19`, `Community 24`?**
  _High betweenness centrality (0.139) - this node is a cross-community bridge._
- **Why does `getAggregatedTokens()` connect `Community 11` to `Community 0`, `Community 9`, `Community 5`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Are the 213 inferred relationships involving `GET()` (e.g. with `isAuthenticated()` and `runKarmaRead()`) actually correct?**
  _`GET()` has 213 INFERRED edges - model-reasoned connections that need verification._
- **Are the 83 inferred relationships involving `POST()` (e.g. with `.getCurrentSynthesis()` and `.getModifierForSymbol()`) actually correct?**
  _`POST()` has 83 INFERRED edges - model-reasoned connections that need verification._
- **Are the 26 inferred relationships involving `DELETE()` (e.g. with `seedPaper()` and `resetForPaperMode()`) actually correct?**
  _`DELETE()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `providerFetch()` (e.g. with `getQuote()` and `getPrice()`) actually correct?**
  _`providerFetch()` has 19 INFERRED edges - model-reasoned connections that need verification._