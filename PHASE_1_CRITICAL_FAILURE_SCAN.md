# PHASE 1 — CRITICAL FAILURE SCAN
Date: 2026-04-15
Scope: TRADE AI, branch `main`, 171 TS files, 35 API routes, 7 pages
Mode: static scan (deep) + runtime scan (limited — sandbox arm64 missing SWC, delegated to user's Mac; remote prod URL probed)
Rule: additive-only. Every fix below is additive or minimal-invasive. Nothing deleted.

---

## EXECUTIVE VERDICT

Status: **PARTIALLY OPERATIONAL WITH 3 CRITICAL GAPS**
- Core Polymarket engine is intact and well-structured.
- Paper wallet has real isolation guards at the `PolyWallet` level.
- BUT: live exchange execution paths (MEXC/OKX/Bybit) are NOT gated by a global paper-mode switch. This violates your stated rule "Paper trading must remain isolated from real execution."
- BUT: production Cloud Run URL (`trade-ai-657910853930.europe-west1.run.app`) returns `404` on all 8 smoke routes. Prod is either moved or down.
- BUT: client SSE stream `/api/live-stream` is referenced by the dashboard but the route does not exist. Dashboard realtime is dead on arrival.

Fix all three in Phase 2/3 additively before any further optimization work.

---

## CRITICAL FAILURES — RANKED

### [C1] Live exchange calls not gated by paper-mode switch
- **Severity:** CRITICAL
- **Layer:** `src/app/api/exchanges/route.ts` + `src/lib/v2/manager/positionManager.ts` + `src/lib/exchange/mexcClient.ts`
- **Evidence:**
  - `api/exchanges` POST with `{action:"order"}` calls `placeMexcMarketOrder` / `placeOkxMarketOrder` / `placeBybitOrder` directly. No `TRADING_MODE=PAPER` check.
  - `positionManager.evaluateLivePositions` calls `placeMexcMarketOrder` and `cancelAllMexcOrders` on every cron tick with `.catch(() => {})` swallowing failures silently.
  - `killSwitch` exports `isKillSwitchEngaged()` — grep shows **zero usages** in `src/lib/exchange/` and in the live-order path.
  - Auth gate is the only barrier and default password is `admin123` (`src/lib/auth/index.ts:8`).
- **Root cause:** No global guard; PAPER/LIVE is a type on the wallet, not an execution-layer gate.
- **Current impact:** If MEXC keys are set and auth is bypassed or password is default, live market orders fire.
- **Profit impact:** Unbounded downside. Blocker for the whole "paper isolation" mission.
- **Minimal additive fix:**
  1. Add `src/lib/core/tradingMode.ts` exporting `assertPaperMode()` reading `TRADING_MODE` env (default `PAPER`). `LIVE` requires explicit env + extra env token (`LIVE_TRADING_CONFIRM=YES_I_UNDERSTAND_RISK`).
  2. Call `assertPaperMode()` at the top of each `placeMexc*` / `placeOkx*` / `placeBybit*` function — one line, throws before request fires.
  3. Call `assertPaperMode()` at the top of `positionManager.evaluateLivePositions` and in `/api/exchanges` POST handler.
  4. Add `.env.example` entries `TRADING_MODE=PAPER` and comment describing the flag.
- **Files involved:** 3 exchange clients (mexc/okx/bybit), positionManager, exchanges route, .env.example, new tradingMode.ts.
- **Validation:** Unit test in `test-tier-1-fixes.ts` adds case: force `TRADING_MODE=PAPER`, call `placeMexcMarketOrder` — expect throw.
- **Rollback concern:** Zero — default is PAPER; flipping to LIVE requires opt-in.

### [C2] Production URL returns 404 on every route
- **Severity:** CRITICAL
- **Layer:** Deploy / DNS
- **Evidence:** `smoke_tests.sh` against `https://trade-ai-657910853930.europe-west1.run.app` — 8/8 routes return 404.
- **Root cause:** UNVERIFIED. Candidates: Cloud Run service renamed, region changed, auth wall added, DNS gone, build broken.
- **Current impact:** Prod is dead. Dashboard not reachable.
- **Profit impact:** Full outage for any live-data flow.
- **Minimal additive fix:**
  1. Verify service name + region on GCP: `gcloud run services list --region=europe-west1`.
  2. Update `smoke_tests.sh BASE` var to match current URL.
  3. Add `POST_DEPLOY_HEALTH_CHECK` step to `DEPLOY_PRODUCTION.sh` that runs `smoke_tests.sh` and fails the deploy if any check 404s.
- **Files involved:** `smoke_tests.sh`, `DEPLOY_PRODUCTION.sh`, `cloudbuild.yaml`.
- **Validation:** post-deploy smoke returns 8/8 green.

### [C3] Dashboard SSE endpoint `/api/live-stream` does not exist
- **Severity:** HIGH
- **Layer:** `src/hooks/useRealtimeData.ts:211`
- **Evidence:** `new EventSource('/api/live-stream')` — but no `src/app/api/live-stream/route.ts`. Also referenced in stale `.next/types/validator.ts`. Dashboard page uses this hook for live data.
- **Root cause:** Route was deleted or never created; hook kept.
- **Current impact:** `LiveIndicator` on dashboard likely stuck on `connecting`/`error`; this is the "decorative live indicator" anti-pattern you flagged.
- **Profit impact:** None directly; hurts truthfulness and user trust.
- **Minimal additive fix:**
  - Add new route `src/app/api/live-stream/route.ts` as a lightweight SSE emitter that ticks every 5s with `{heartbeat, timestamp, health}` pulled from `getHealthSummary()` (exists in `src/lib/core/heartbeat.ts`). Keeps current hook contract intact.
  - If later we want richer realtime, extend the SSE payload additively.
- **Files involved:** 1 new route, optional typing in `useRealtimeData.ts`.
- **Validation:** open dashboard → LiveIndicator shows `LIVE` with incrementing update count.

### [C4] Polymarket primary engine has NO WebSocket — polling/REST only
- **Severity:** HIGH
- **Layer:** `src/lib/polymarket/polyClient.ts`
- **Evidence:** file is pure `fetch`-based REST against CLOB and Gamma. Zero `ws` / `WebSocket`.
- **Current impact:** Polymarket — your stated primary strategic surface — is not receiving real-time market events. Scanner runs on cron, not on ticks. Ranking/regime engine proposals in Phase 2 will be blind to sub-scan-interval moves.
- **Profit impact:** Misses fast regime changes, orderbook imbalances, liquidity spikes. Directly caps opportunity quality.
- **Minimal additive fix (Phase 2 Layer A):**
  - Add `src/lib/polymarket/polyWsClient.ts` — new file, does NOT replace `polyClient.ts`.
  - Connects to Polymarket official WS (CLOB market channel), with heartbeat (30s ping), reconnect with exponential backoff (capped at 60s), stale-feed watchdog (mark feed `STALE` after 30s no message), event emitter API.
  - Expose feed-health struct to `/api/v2/polymarket?action=feed-health` (new subcommand).
  - Wire into `marketScanner.ts` ONLY as enrichment (hot cache of last tick); do not change existing scan logic.
- **Files involved:** 1 new file, 1 additive action in existing route.
- **Validation:** feed-health endpoint reports `CONNECTED`/`STALE`/`DISCONNECTED` and reconnect count.

### [C5] Silent `.catch(() => {})` on exit/SL/cancel orders
- **Severity:** HIGH
- **Layer:** `src/lib/v2/manager/positionManager.ts:130,131,162,188,221`, `src/lib/v2/safety/sentinelGuard.ts:311`, `src/lib/v2/scouts/executionMexc.ts:178`
- **Evidence:** `await cancelAllMexcOrders(pos.symbol).catch(() => {})` and `await placeMexcMarketOrder(...).catch(() => {})`. Exit orders can fail and nobody knows.
- **Current impact:** Position stuck open with no SL; alarm never fires. Bloomberg-grade observability fails.
- **Profit impact:** Tail risk on any live exec, also noise on paper telemetry.
- **Minimal additive fix:**
  - Replace `.catch(() => {})` with `.catch((e) => log.error('exit op failed', {...}))` — non-destructive: still fire-and-forget, just logged. Escalate to `heartbeat.recordProviderHealth('degraded')` and Telegram alert on repeated failures.
- **Files involved:** 3 files, ~10 lines total.
- **Validation:** force a failed cancel in dev → log line + provider health degraded.

### [C6] DASHBOARD_PASSWORD default `admin123`
- **Severity:** HIGH
- **Layer:** `src/lib/auth/index.ts:8`
- **Evidence:** `const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';`
- **Current impact:** Anyone who guesses the default reaches every mutating endpoint, including `/api/exchanges` POST (which feeds C1).
- **Profit impact:** Catastrophic if exposed; current prod 404 mitigates temporarily.
- **Minimal additive fix:**
  - Refuse boot (throw at module init) if `DASHBOARD_PASSWORD` is missing or equals `admin123` AND `NODE_ENV !== 'development'`.
  - Add env entry + documentation.
- **Files involved:** `src/lib/auth/index.ts`, `.env.example`.
- **Validation:** boot with default password in production mode fails loudly.

### [C7] `polyState.ts` local-only serialize/deserialize — test harness broken
- **Severity:** MEDIUM
- **Layer:** `src/lib/polymarket/polyState.ts:26,43`, `test-tier-1-fixes.ts:25-26`
- **Evidence:** TSC: `Module '"./src/lib/polymarket/polyState"' declares 'serializeWallet' locally, but it is not exported.`
- **Current impact:** Test harness dead; no snapshot test for wallet round-trip.
- **Profit impact:** None directly; regression safety gap.
- **Minimal additive fix:** Add `export` keyword to both functions. Fix 4 type errors in `test-tier-1-fixes.ts` (narrow `boolean | undefined` with `?? false`; type `err as Error`).
- **Files involved:** 2 files, 4 small edits.
- **Validation:** `tsc --noEmit` passes on `test-tier-1-fixes.ts`.

### [C8] Stale `.next/types/validator.ts` referencing 8 deleted routes
- **Severity:** LOW
- **Layer:** `.next` cache
- **Evidence:** TSC errors reference `agent-card`, `health`, `live-stream`, `notifications`, `v2/dry-run`, `v2/pre-live`, `v2/test-live-cycle`, `watchdog/ping` — none exist in `src/app/api/`.
- **Current impact:** TSC noise. Does not affect runtime.
- **Profit impact:** None.
- **Minimal additive fix:** `rm -rf .next && next build`. Sandbox cannot delete here (permission), user runs on Mac.
  - Secondary: decide per-route whether any SHOULD come back (C3 brings back `live-stream`; `health` may overlap with `v2/health`; `watchdog/ping` still referenced by user scripts).
- **Files involved:** cache only.
- **Validation:** TSC clean.

### [C9] `useRealtimeData.ts` polling fallback not wired to real endpoints
- **Severity:** MEDIUM
- **Layer:** `src/hooks/useRealtimeData.ts`
- **Evidence:** comment at top says "Replaces all polling with a single SSE stream from /api/live-stream" (see C3). If SSE fails, no polling fallback defined against existing `/api/dashboard` + `/api/v2/polymarket`.
- **Current impact:** UI goes silent on SSE failure.
- **Minimal additive fix:** keep SSE primary, add polling fallback to `/api/dashboard` + `/api/v2/polymarket?action=status` every 15s if EventSource state = CLOSED/ERROR for >30s.
- **Validation:** force-kill SSE → UI keeps refreshing via polling.

### [C10] MEXC WS has no heartbeat and fixed 5s reconnect
- **Severity:** MEDIUM
- **Layer:** `src/lib/providers/wsStreams.ts`
- **Evidence:** `scheduleReconnect()` fixed 5s, no exponential backoff cap, no PING frames sent, no stale-feed detection.
- **Current impact:** MEXC may silently drop the socket (TCP half-open) and `AlphaScout` goes blind.
- **Minimal additive fix:** add 30s `setInterval` ping (`JSON.stringify({method:"PING"})`), track `lastMessageAt`, exponential backoff (5s→10s→20s→40s→60s max), escalate to `heartbeat.recordProviderHealth('MEXC-WS','degraded')`.
- **Files involved:** 1 file, ~30 lines additive inside class.
- **Validation:** disconnect MEXC → reconnect attempts logged, health endpoint reflects.

### [C11] `console.log`/`console.error` direct calls in route handlers
- **Severity:** LOW
- **Layer:** 7 occurrences across `src/app/api/`
- **Evidence:** `grep console.(log|error) src/app/api | wc -l` = 7.
- **Current impact:** Cloud Run structured logs inconsistent.
- **Minimal additive fix:** swap to `createLogger` wrapper (1 line change per file). Non-destructive.

### [C12] Dashboard truthfulness — multiple health probes in parallel, no freshness
- **Severity:** MEDIUM
- **Layer:** `src/app/dashboard/page.tsx:99-112`
- **Evidence:** parallel `fetch` calls to `/api/v2/health`, `/api/exchanges`, `/api/diagnostics/master`, `/api/diagnostics/credits`. No timestamp tracking, no stale markers.
- **Current impact:** dashboard can show green card while backend is stale for minutes.
- **Minimal additive fix:** each widget holds last-response timestamp + freshness window; `LiveIndicator` reads global feed-health. Dovetails into Phase 2 Layer G.

---

## ROUTE MAP + HANDLER COVERAGE

35 routes, all compile and expose handlers. No route missing GET/POST. Full table:

| Route | Verbs | Auth? | Try/catch? | Notes |
|-------|-------|-------|-----------|-------|
| `/api/auth` | POST GET DEL | n/a | ✓ | uses `DASHBOARD_PASSWORD` — C6 risk |
| `/api/dashboard` | GET | ✓ | ✓ | aggregator |
| `/api/exchanges` | GET POST | ✓ | partial | **C1 live-order path** |
| `/api/auto-trade` | GET POST | ✓ | — | verify guards in Phase 2 |
| `/api/bot` | GET POST | ✓ | — | |
| `/api/cron` | GET | CRON_SECRET | ✓ | triggers `positionManager` (C1) |
| `/api/trade-reasoning` | GET | ? | — | |
| `/api/tradingview` | GET POST | TV_SECRET_TOKEN | — | webhook surface |
| `/api/telegram` | GET | ? | ✓ | |
| `/api/indicators` | GET | ? | — | |
| `/api/meme-signals` | GET | ? | ✓ | |
| `/api/btc-signals` | GET | ? | ✓ | |
| `/api/solana-signals` | GET | ? | ✓ | |
| `/api/tokens` | GET | ? | ✓ | |
| `/api/tokens/[address]` | GET | ? | ✓ | |
| `/api/moltbook-cron` | GET | CRON_SECRET | — | |
| `/api/a2a/orchestrate` | GET POST | ? | — | agent layer foundation |
| `/api/a2a/alpha-quant` | GET POST | ? | — | |
| `/api/a2a/execution` | GET POST | ? | — | verify paper-mode gate |
| `/api/a2a/risk` | GET POST | ? | ✓ | |
| `/api/a2a/sentiment` | GET POST | ? | — | extension target for news/sentiment agents |
| `/api/diagnostics/master` | GET | ? | — | |
| `/api/diagnostics/credits` | GET | ? | — | |
| `/api/diagnostics/signal-quality` | GET | ? | ✓ | |
| `/api/v2/health` | GET | none | — | |
| `/api/v2/deepseek-status` | GET | none | — | |
| `/api/v2/backtest` | GET | ? | — | |
| `/api/v2/arena` | GET | ? | — | |
| `/api/v2/polymarket` | GET POST | ✓ | ✓ | strategic surface |
| `/api/v2/polymarket/cron/scan` | GET | CRON_SECRET | — | |
| `/api/v2/polymarket/cron/resolve` | GET | CRON_SECRET | — | |
| `/api/v2/polymarket/cron/mtm` | GET | CRON_SECRET | — | |
| `/api/v2/cron/positions` | GET | CRON_SECRET | ✓ | **C1 live-order path** |
| `/api/v2/cron/auto-promote` | GET | CRON_SECRET | — | |
| `/api/v2/cron/sentiment` | GET | CRON_SECRET | — | |

Routes referenced by code but MISSING: `agent-card`, `health`, `live-stream` **(C3)**, `notifications`, `v2/dry-run`, `v2/pre-live`, `v2/test-live-cycle`, `watchdog/ping`. Decision: `live-stream` rebuild (C3); rest classified below.

**SAFE TO REMOVE — references only (no file):** none (there's nothing in `src/` to delete).
**SAFE TO REMOVE — UI refs to dead endpoints:** none yet (only `useRealtimeData` pointing at `live-stream`, which we rebuild).

---

## CONTROL MAP — pages + actions

Each marked PASS / FAIL / PARTIAL / UNVERIFIED. Runtime boot unavailable in this sandbox (arm64 SWC missing); static trace only. User to walk through on Mac and update.

### `/dashboard`
- Live indicator → **FAIL** (depends on dead `/api/live-stream` — C3)
- Health card (`/api/v2/health`) → UNVERIFIED (route exists, prod 404)
- Exchanges card (`/api/exchanges`) → UNVERIFIED
- Diagnostics master → UNVERIFIED
- Credits → UNVERIFIED
- Force refresh button (from `useRealtimeData.forceRefresh`) → UNVERIFIED

### `/polymarket`
- Status fetch → UNVERIFIED (route exists)
- Wallet fetch → UNVERIFIED
- Gladiators fetch → UNVERIFIED
- Scan button → UNVERIFIED
- Markets by division → UNVERIFIED
- Health subcommand (`action=health`) → UNVERIFIED — confirm exists in route
- Gladiator actions → UNVERIFIED
- Syndicate feed → UNVERIFIED

### `/bot-center`
- Bot start/stop → UNVERIFIED
- Strategy select → UNVERIFIED
- Refresh → UNVERIFIED

### `/arena`
- Simulator start/stop → UNVERIFIED
- Arena config save → UNVERIFIED

### `/crypto-radar`
- Scan toggle → UNVERIFIED
- Signal list render → UNVERIFIED

### `/login`
- Login POST → UNVERIFIED (works statically; C6 weak default)

### Global
- Sidebar nav links → UNVERIFIED
- Command palette → UNVERIFIED
- Keyboard shortcuts → UNVERIFIED
- PWA install button → UNVERIFIED
- Service worker register → UNVERIFIED

---

## RUNTIME FINDINGS

- **Dev server boot in sandbox:** FAILED. Next.js 16 requires SWC native binary for linux/arm64; not bundled. Not a project defect; sandbox limitation.
- **Production smoke (`smoke_tests.sh`):** 0/8 PASS — all routes 404 at `trade-ai-657910853930.europe-west1.run.app`. See C2.
- **TSC static build:** passes modulo 16 errors — 12 are stale `.next` cache refs (C8), 4 are real in `test-tier-1-fixes.ts` (C7).

### Runtime test plan for user's Mac (Phase 1.5)
Run locally:
```bash
cd "/Users/user/Desktop/BUSSINES/Antigraity/TRADE AI"
rm -rf .next
npm run build 2>&1 | tail -30
TRADING_MODE=PAPER npm run dev &
sleep 20
for r in \
  /api/v2/health /api/dashboard /api/v2/polymarket?action=status \
  /api/v2/polymarket?action=wallet /api/diagnostics/master \
  /api/diagnostics/credits /api/v2/deepseek-status; do
  printf "%-60s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000$r)"
done
```
Report results; I'll fold them into Phase 2 priorities.

---

## ADDITIVE FIX PRIORITIES (for Phase 2 execution)

Order by risk-reduction per unit of work:

1. **C1** — Paper-mode global gate (tradingMode.ts + call sites) — biggest risk reduction
2. **C6** — Default password boot guard
3. **C3** — `/api/live-stream` rebuild so dashboard is truthful
4. **C5** — Replace silent `.catch(() => {})` with logged catches on live exec paths
5. **C2** — Fix prod URL in smoke tests + add post-deploy health gate
6. **C7** — Export polyState helpers + fix test harness types
7. **C8** — Clean `.next` cache (user on Mac)
8. **C10** — MEXC WS heartbeat + backoff
9. **C11** — Swap `console` for `createLogger`
10. **C9** — Polling fallback in `useRealtimeData`
11. **C12** — Dashboard freshness indicators (leads into Phase 2 Layer G)
12. **C4** — Polymarket WS client (Phase 2 Layer A core; big additive win, but lands after the safety gates)

All 12 are **additive** or **edit-in-place without removing logic**. No deletion required.

---

## EXTENSION SURFACES FOR PHASE 2 (news / sentiment / ranking / volume / orderbook)

Designed so core is never touched. All new logic lives in `src/lib/v2/intelligence/`, `src/lib/v2/swarm/`, and new sub-routes.

### Adapter-first architecture
```
src/lib/v2/intelligence/
  feeds/
    types.ts                  # FeedAdapter<T>, FeedHealth, FreshnessWindow
    newsAdapter.ts            # abstract
    adapters/
      newsapi.ts              # impl when user provides NEWSAPI_KEY
      cryptopanic.ts          # impl when user provides CRYPTOPANIC_KEY
      cointelegraph_rss.ts    # key-less fallback
      perplexity.ts           # optional
    sentimentAdapter.ts       # abstract
    adapters/
      openai_sentiment.ts     # reuses existing OPENAI_API_KEY
      gemini_sentiment.ts     # reuses GEMINI_API_KEY
      deepseek_sentiment.ts   # reuses DEEPSEEK_API_KEY
  agents/
    newsCollector.ts          # pulls from all enabled adapters
    newsDedup.ts              # SimHash + URL canonicalization
    sentimentAgent.ts         # scores + decay
    entityLinker.ts           # maps headline → Polymarket market id / crypto symbol
    marketRegime.ts           # trend/range/volatility classifier
    orderbookIntel.ts         # reads polyWsClient (C4) + MEXC WS (existing)
    volumeIntel.ts            # volume regime / spike detection
    opportunityRanker.ts      # scoring engine combining above
    feedHealthMonitor.ts      # aggregator over all adapters + WS clients
    uiVerificationAgent.ts    # periodic synthetic "click" of routes
```

### New sub-routes (additive)
- `/api/v2/intelligence/news` — returns deduped feed
- `/api/v2/intelligence/sentiment` — scored + decayed
- `/api/v2/intelligence/ranking` — top-N opportunities
- `/api/v2/intelligence/feed-health` — per-feed status for `LiveIndicator`

### New env (adapter-pluggable)
- `NEWSAPI_KEY`, `CRYPTOPANIC_KEY`, optional `PERPLEXITY_KEY`
- `NEWS_ADAPTERS=cointelegraph_rss,cryptopanic,newsapi` (comma list — user toggles per env)
- `SENTIMENT_ADAPTER=openai` (defaults to whichever LLM key is present)

### Polymarket primary — extended
- `polyWsClient.ts` (C4) feeds `orderbookIntel` and `opportunityRanker`
- Existing `marketScanner.ts` unchanged; enriched by `opportunityRanker` as a consumer

### UI additive
- Dashboard + Polymarket page: new collapsible "Intelligence Panel" reading `/api/v2/intelligence/*` — does not replace existing panels.

---

## PHASE 1 CLOSING

- **DONE:** 12 critical/high/medium failures ranked with additive fixes; 35-route map; control map baseline; extension surface blueprint; adapter-first design.
- **BLOCKED:** Prod URL 404 diagnosis (need GCP console from user); dev runtime boot (user's Mac).
- **NEXT:** Phase 2 batch 1 — implement C1 (trading mode gate) + C6 (password guard) + C3 (live-stream route). These are foundation for everything else.
- **RISKS:**
  - If user flips `TRADING_MODE=LIVE` without audit, C1 gate by itself isn't enough — we'll add circuit breakers in Phase 2.
  - WS client (C4) requires correct Polymarket WS endpoint; docs may shift.
- **FILES TOUCHED:** 1 new — `PHASE_1_CRITICAL_FAILURE_SCAN.md`. Zero source edits.
- **ADDITIVE IMPACT:** clear path to harden 12 issues without removing a single line of working logic.
- **PROFIT IMPACT:** C1/C5/C6 eliminate catastrophic tail; C4 unlocks real-time edge; C12 cleans truthfulness (compounding win).
- **MARKET-SENSITIVITY IMPACT:** none yet — all landed in Phase 2 Layer A/D/E via new agents.
