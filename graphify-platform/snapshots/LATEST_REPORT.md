# Graph Report - /home/runner/work/trade-ai-bot/trade-ai-bot/src  (2026-04-19)

## Corpus Check
- 281 files · ~227,520 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1431 nodes · 2776 edges · 87 communities detected
- Extraction: 69% EXTRACTED · 31% INFERRED · 0% AMBIGUOUS · INFERRED: 866 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `GET()` - 280 edges
2. `POST()` - 116 edges
3. `GladiatorStore` - 26 edges
4. `DELETE()` - 25 edges
5. `providerFetch()` - 21 edges
6. `mexcRequest()` - 17 edges
7. `PolyWsClient` - 17 edges
8. `assertLiveTradingAllowed()` - 17 edges
9. `executeMexcTrade()` - 16 edges
10. `getAggregatedTokens()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `getMexcPrice()` --calls--> `isSymbolValid()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/exchange/mexcClient.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/store/db.ts
- `GET()` --calls--> `getMoltbookTelemetry()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/app/api/dashboard/route.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/moltbook/moltbookClient.ts
- `GET()` --calls--> `getRecentEvents()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/app/api/dashboard/route.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/v2/alerts/eventHub.ts
- `getCachedPrice()` --calls--> `getOrFetchPrice()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/v2/arena/simulator.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/cache/priceCache.ts
- `GET()` --calls--> `updatePositionPrice()`  [INFERRED]
  /home/runner/work/trade-ai-bot/trade-ai-bot/src/app/api/dashboard/route.ts → /home/runner/work/trade-ai-bot/trade-ai-bot/src/lib/polymarket/polyWallet.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (103): calculateAdaptiveSize(), errorResponse(), successResponse(), captureDivisionSnapshot(), captureSnapshot(), persistAsync(), persistDivAsync(), recentDivisionSnapshots() (+95 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (34): TheButcher, wilsonLower(), runDailyRotation(), getGladiatorDna(), getGladiatorsFromDb(), getIndependentSampleSize(), refreshGladiatorsFromCloud(), saveGladiatorsToDb() (+26 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (49): fetchWithRetry(), sleep(), calcBollingerBands(), sma(), stdDev(), analyzeBTC(), calcEMA(), emptyResult() (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (53): MexcAdapter, getEquityCurve(), getLivePositions(), updateLivePosition(), executeMexcTrade(), getExchangeInfoCached(), getPositionSize(), getSymbolFilters() (+45 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (43): getResilientPrice(), releaseTaskLease(), tryAcquireTaskLease(), asNum(), asStr(), extractFields(), getEventsHealth(), insertGoldskyEvent() (+35 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (55): addGladiatorDna(), addGladiatorDnaBatch(), addInvalidSymbol(), AsyncMutex, buildWashKeyMap(), clearSystemHealthData(), flushPendingSyncs(), getCrossGladiatorWashScore() (+47 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (31): alertBetPlaced(), alertBetResolved(), alertDailyDigest(), alertRiskHalt(), isRateLimited(), sendTelegramAlert(), TELEGRAM_BOT_TOKEN(), TELEGRAM_CHAT_ID() (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (42): checkHealth(), providerFetch(), birdeyeHealthCheck(), getMultiPrice(), getTokenOverview(), getTokenPrice(), headers(), calculateDealScore() (+34 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (20): callLLM(), costUsd(), isAbortError(), priceFor(), recordCall(), acquireTradeLock(), addDecision(), addLivePosition() (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (18): CoindeskRssAdapter, extract(), extractSymbols(), parseRssItems(), CointelegraphRssAdapter, extractSymbols(), extractTag(), extractTopics() (+10 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (32): AutoDebugEngine, engageWithFeed(), extractInsightsWithLLM(), generateSmartReplyLLM(), runMoltbookDailySweep(), solveMathChallenge(), tryPostingToMoltbook(), bucketUpvotes() (+24 more)

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (17): computeDegradation(), computeStats(), getCpcvConfig(), getCpcvMode(), isFoldOverfit(), loadTrades(), parseTsMs(), runCpcvValidate() (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (31): binanceRequest(), getBinanceBalances(), getBinanceConfig(), getBinanceExchangeInfo(), getBinanceOpenPositions(), getBinancePrice(), placeBinanceLimitOrder(), placeBinanceMarketOrder() (+23 more)

### Community 13 - "Community 13"
Cohesion: 0.1
Nodes (36): buildReasoning(), classifyRisk(), determineRecommendation(), evaluateOpportunity(), getEdgeFloor(), getPriceHistory(), scanDivision(), scoreLiquidity() (+28 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (13): getSyncQueueStats(), getFreshHealthSnapshot(), recordProviderHealth(), startHeartbeat(), takeSnapshot(), getKillSwitchState(), PolyWsClient, buildPayload() (+5 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (23): appendToEquityCurve(), getBotConfig(), getDecisions(), saveBotConfig(), emitDemotion(), emitError(), emitEvent(), emitKillSwitch() (+15 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (30): buildBearPrompt(), buildBullPrompt(), callLLM(), DebateEngine, heuristicDebate(), parseArgument(), scoreDebate(), parse() (+22 more)

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (8): CryptoPanicAdapter, getAggregateFeedHealth(), HeuristicSentimentAdapter, NewsCollector, getEnabledNewsAdapters(), getSentimentAdapter(), listAllAdapters(), SentimentAgent

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (20): addSyndicateAudit(), callDeepSeek(), callGemini(), callOpenAI(), checkMarketDataAnchoring(), consensusCacheKey(), DualMasterConsciousness, executeDualEngineFallback() (+12 more)

### Community 19 - "Community 19"
Cohesion: 0.1
Nodes (13): BybitAdapter, ExchangeRouter, bybitRequest(), cancelBybitOrder(), getBaseUrl(), getBybitBalance(), getBybitConfig(), getBybitOpenOrders() (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (14): OkxAdapter, cancelOkxOrder(), getOkxBalance(), getOkxConfig(), getOkxOpenOrders(), getOkxOrderbook(), getOkxPrice(), getOkxServerTime() (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (2): AlphaScout, WsStreamManager

### Community 22 - "Community 22"
Cohesion: 0.13
Nodes (21): cacheKey(), calcADX(), classifyRegime(), computeRegime(), evictIfFull(), getRegimeCacheStats(), getRegimeMode(), regimeMultiplier() (+13 more)

### Community 23 - "Community 23"
Cohesion: 0.24
Nodes (13): calculateKellyBetSize(), calculateTotalBalance(), calculateTotalInvested(), calculateUnrealizedPnL(), checkAndResetDailyLimits(), checkLossLimits(), closePosition(), emergencyLiquidate() (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.36
Nodes (10): analyzeSentimentLLM(), applyConfidencePenalties(), checkForContrarian(), fallbackKeywordScore(), getTemporalWeight(), levenshteinDistance(), OPENAI_API_KEY(), removeNoise() (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.52
Nodes (6): clamp01(), getMetaLabelConfig(), getMetaLabelMode(), normalizeSizing(), predict(), sigmoid()

### Community 26 - "Community 26"
Cohesion: 0.33
Nodes (2): logPolyEvent(), syncEventsToCloud()

### Community 27 - "Community 27"
Cohesion: 0.52
Nodes (6): calculateConviction(), scoreBB(), scoreFearGreed(), scoreMTF(), scoreRSI(), scoreVWAP()

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 0.6
Nodes (3): getArenaConfig(), isEligibleForArena(), scoreGladiatorForArena()

### Community 30 - "Community 30"
Cohesion: 0.5
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 0.67
Nodes (2): draw(), getStateColor()

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (2): downsample(), Sparkline()

### Community 33 - "Community 33"
Cohesion: 0.67
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (2): execute(), handleItemKeyDown()

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (2): evaluateAlerts(), makeAlert()

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
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

## Knowledge Gaps
- **Thin community `Community 44`** (2 nodes): `BottomNav()`, `BottomNav.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `Sidebar.tsx`, `Sidebar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `LoadingStates.tsx`, `Skeleton()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `SentinelCouplingPanel.tsx`, `decisionColor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `AppShell()`, `AppShell.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `pnlCol()`, `DivisionTunerPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `Toast.tsx`, `useToast()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (2 nodes): `DirectionBadge()`, `DecisionMatrix.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (2 nodes): `PaperBacktestPanel.tsx`, `pnlColor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `GoldDust()`, `GoldDust.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (2 nodes): `SwRegister.tsx`, `handleUpdate()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (2 nodes): `volumeIntel.ts`, `classifyVolume()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (2 nodes): `instrumentCron()`, `cronInstrument.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (2 nodes): `page.tsx`, `Home()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (2 nodes): `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `DeepSeekStatus()`, `DeepSeekStatus.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (2 nodes): `page.tsx`, `deriveAgentState()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (2 nodes): `route.ts`, `classifyPost()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (2 nodes): `useRealtimeData.ts`, `useRealtimeData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (2 nodes): `useBotStats.ts`, `useBotStats()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `KpiBar.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `TradingViewChart.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `MoltbookSwarmFeed.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `DragonLogo.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `Sparkline.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `EquityCurve.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `SectorInfo.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `SyndicateFeed.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `theme.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `polyTypes.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `seedStrategies.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `gladiator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `strategy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `radar.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `scoringConfig.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (1 nodes): `route.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GET()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 17`, `Community 18`, `Community 19`, `Community 20`, `Community 21`, `Community 22`, `Community 23`, `Community 25`?**
  _High betweenness centrality (0.507) - this node is a cross-community bridge._
- **Why does `POST()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 18`, `Community 19`, `Community 20`, `Community 23`?**
  _High betweenness centrality (0.171) - this node is a cross-community bridge._
- **Why does `getAggregatedTokens()` connect `Community 7` to `Community 0`, `Community 9`, `Community 4`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Are the 189 inferred relationships involving `GET()` (e.g. with `isAuthenticated()` and `runKarmaRead()`) actually correct?**
  _`GET()` has 189 INFERRED edges - model-reasoned connections that need verification._
- **Are the 81 inferred relationships involving `POST()` (e.g. with `.getCurrentSynthesis()` and `.getModifierForSymbol()`) actually correct?**
  _`POST()` has 81 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `DELETE()` (e.g. with `seedPaper()` and `resetForPaperMode()`) actually correct?**
  _`DELETE()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `providerFetch()` (e.g. with `getQuote()` and `getPrice()`) actually correct?**
  _`providerFetch()` has 19 INFERRED edges - model-reasoned connections that need verification._