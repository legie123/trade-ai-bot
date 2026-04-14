# PHASE 2 — BATCH 2 REPORT
Date: 2026-04-15
Scope: C4 (Polymarket WS client) + C10 (MEXC WS hardening) + C5 full sweep + feed-health observability
Mode: additive-only. 0 deletions. 0 rewrites. 1 new source file + 1 new env + 9 files edited.

---

## TARGET

Light up the primary strategic surface (Polymarket) with real-time WebSocket awareness, harden the existing MEXC WS client with heartbeat + expo backoff + stale detection, and complete the silent-catch sweep on every server-side critical path.

## WHY

- Phase 2 Batch 1 closed the safety gates. Edge needs real-time signal.
- `polyClient.ts` is REST/cron only. Without WS, the scanner is blind between ticks — misses regime changes, orderbook imbalances, liquidity events.
- Existing MEXC WS had no heartbeat, no stale detection, fixed 5s reconnect — easy to silently drop the socket.
- Server-side silent `.catch(() => {})` on broadcast/diagnostic calls hid failures from observability.

All additive — polyClient.ts, marketScanner.ts, polyGladiators.ts, polySyndicate.ts, strategies.ts remain untouched.

## FILES

### NEW (1)
- `src/lib/polymarket/polyWsClient.ts` — Polymarket WS client singleton, full resilience (329 lines)

### EDITED (9)
- `src/lib/providers/wsStreams.ts` — MEXC WS hardened: 20s ping, 45s stale watchdog, expo backoff (5→10→20→40→60s), `getFeedHealth()` method, provider-health integration
- `src/app/api/v2/polymarket/route.ts` — 3 new GET actions: `feed-health`, `ws-start`, `ws-stop`
- `src/app/api/v2/health/route.ts` — now surfaces `feeds: { polymarketWs, mexcWs }` alongside `trading_mode`
- `src/app/api/live-stream/route.ts` — SSE payload now includes `feeds` per tick (dashboard truthfulness)
- `src/app/api/cron/route.ts` — autoDebug diagnostic silent catch now logged
- `src/lib/core/heartbeat.ts` — 2 telegram silent catches logged
- `src/lib/core/watchdog.ts` — 2 telegram silent catches logged
- `src/lib/v2/safety/autoDebugEngine.ts` — 1 diagnostic silent catch logged
- `src/lib/v2/safety/sentinelGuard.ts` — 1 cancelAllMexcOrders silent catch logged
- `src/lib/v2/scouts/executionMexc.ts` — 3 telegram silent catches logged
- `src/lib/v2/manager/managerVizionar.ts` — 3 broadcast silent catches logged
- `src/scripts/cron_dailyRotation.ts` — 1 postActivity silent catch logged
- `.env.example` — added `POLYMARKET_WS_URL` + `POLYMARKET_WS_AUTOSTART`

Total server-side silent `.catch(() => {})` remaining in `src/lib/`, `src/app/api/`, `src/scripts/`: **0**.
Only UI-side fire-and-forget fetches remain silent (5 sites in bot-center/login pages — intentional, they don't affect trading).

## POLYMARKET WS CLIENT — DETAILS

### Design
- Singleton `PolyWsClient` (EventEmitter), read-only market channel — never places orders.
- Endpoint configurable via `POLYMARKET_WS_URL` (defaults to `wss://ws-subscriptions-clob.polymarket.com/ws/market`).
- **OFF by default.** Only connects if `POLYMARKET_WS_AUTOSTART=true` OR manually via `/api/v2/polymarket?action=ws-start`. This preserves the cron scanner's behaviour — nothing breaks if the WS endpoint is temporarily unavailable.
- Resilience: PING keepalive 25s, stale watchdog 60s, reconnect backoff 5→10→20→40→60s cap.
- Hot cache: last `PolyWsEvent` per `assetId` (LRU-trimmed at 500) — consumers can read latest tick without subscribing.
- Public subscribe/unsubscribe accepts asset-id lists.
- Event types mapped: `price_change`, `book`, `trade`, `last_trade_price`, `tick_size_change`, `unknown`.
- Provider-health integration via `recordProviderHealth('polymarket-ws', bool, null)`.

### Consumer surface (new)
- `polyWsClient.connect()` / `.disconnect()` — idempotent.
- `polyWsClient.subscribe(assetIds)` — resubscribes on reconnect.
- `polyWsClient.on('event', handler)` — every event.
- `polyWsClient.on('price_change', handler)` — typed subset.
- `polyWsClient.getLastEvent(assetId)` — O(1) hot cache.
- `polyWsClient.getFeedHealth()` — observability struct.

### Endpoints using it
- `GET /api/v2/polymarket?action=feed-health` — returns both WS feeds' health + autostart flag.
- `GET /api/v2/polymarket?action=ws-start` — idempotent connect request.
- `GET /api/v2/polymarket?action=ws-stop` — graceful disconnect.
- `GET /api/v2/health` — `feeds` field populated.
- `GET /api/live-stream` — every 5s SSE tick now carries `feeds` alongside `tradingMode` and `lastHealth`.

## MEXC WS HARDENING — DETAILS

- **PING keepalive:** 20s interval, sends `{method:"PING"}`. Detects half-open TCP.
- **Stale watchdog:** evaluates every 10s. If no message for 45s → mark STALE, force-close, trigger reconnect.
- **Expo backoff:** 5→10→20→40s, cap 60s. Resets on successful open.
- **Provider health tracking:** OK on open + recovery; degraded on stale; error on close/error.
- **Public `getFeedHealth()`:** mirrors PolyWsClient shape for uniform dashboard consumption.

Behaviour diff for existing callers (AlphaScout et al.): **none**. The MEXC message → Binance-format translation and the kline/depth emit logic are byte-for-byte identical.

## C5 SWEEP — DETAILS

12 silent server-side catches converted to logged catches. Log level chosen by criticality:
- `log.error` for cancel/exit order paths (sentinelGuard, positionManager — already done batch 1).
- `log.warn` for telegram notifications, moltbook broadcasts, diagnostic triggers, broadcast side-effects.

Rationale: critical failures surface in error logs (alerting candidate); informational notifications surface in warn logs (noise-tolerant).

## RISK

- **Zero breaking change.** Polymarket WS is opt-in. MEXC WS improvements are behaviour-compatible with existing consumers (same event schema, same emit signatures).
- **TSC:** `npx tsc --noEmit --skipLibCheck` — clean across all of `src/` and test harness.
- **Rollback:** revert commit; no env migration required (new envs have safe defaults).

## ADDITIVE BENEFIT

- Polymarket primary surface can now receive sub-second market events when WS is enabled.
- MEXC WS no longer silently half-opens; recovers automatically.
- Dashboard can display truthful feed health (connected/stale/reconnects) via `/api/v2/health`, `/api/v2/polymarket?action=feed-health`, and live SSE stream.
- Every server-side failure in critical paths now shows up in logs with context.
- Foundation ready for Phase 2 Batch 3 (opportunity ranker + orderbook intel) — they just read `polyWsClient.getLastEvent(assetId)`.

## EXPECTED PROFIT BENEFIT

- **Direct:** faster reaction to Polymarket price/book/trade events → tighter entries, better stale-signal rejection.
- **Indirect:** with `feed-health` visible, any silent feed death can be caught before it costs a trade.

## EXPECTED MARKET-SENSITIVITY BENEFIT

- Real-time market-event stream unlocks:
  - orderbook imbalance detection (Phase 2 Batch 3)
  - trade-flow aggressor analysis
  - per-asset event freshness penalty in opportunity ranker
  - regime change detection from trade intensity

## WHAT WAS PRESERVED

- `src/lib/polymarket/polyClient.ts` — untouched.
- `src/lib/polymarket/marketScanner.ts` — untouched.
- `src/lib/polymarket/polyGladiators.ts`, `polySyndicate.ts`, `strategies.ts`, `riskManager.ts`, `polyWallet.ts`, `polyTypes.ts` — untouched.
- All UI pages — untouched.
- Existing MEXC WS emit contract — unchanged.
- All scanners/cron jobs — unchanged.
- Paper isolation (batch 1) — intact; 21 gate callsites still active.

## WHAT WAS EXTENDED

- WS provider coverage: +1 Polymarket client (new file).
- MEXC WS: +heartbeat, +stale detection, +expo backoff, +feed-health API, +provider-health tracking.
- `/api/v2/polymarket`: +3 actions (feed-health, ws-start, ws-stop).
- `/api/v2/health`: +feeds field.
- `/api/live-stream`: +feeds field in every tick.

## WHAT WAS REPAIRED

- 12 silent catches on critical server paths now logged.

## VERIFIED IMPROVEMENTS

- TSC clean.
- 0 silent catches remaining in `src/lib/`, `src/app/api/`, `src/scripts/`.
- 3 consumers now read `polyWsClient.getFeedHealth()`.
- MEXC WS hardening is transparent to all existing AlphaScout subscribers.

## REMAINING FAILURES (out of scope this batch)

- **C2** prod 404 — still needs GCP services list verification.
- **C9** polling fallback in `useRealtimeData` — Batch 3 (quality-of-life UX).
- **C11** `console.log` → `createLogger` sweep (7 routes) — low priority.
- **C12** dashboard freshness UI — needs UI work in Batch 4.

## NEXT PATCH (proposed)

Phase 2 Batch 3 = opportunity ranker + orderbook intel + volume intel + news/sentiment adapter scaffolding.
- `src/lib/v2/intelligence/feeds/` — pluggable adapter shell (no keys required to compile).
- `src/lib/v2/intelligence/agents/` — marketRegime, orderbookIntel, volumeIntel, opportunityRanker, feedHealthMonitor.
- `/api/v2/intelligence/*` — routes exposing ranking + feed health.
- Polymarket page: new additive "Intelligence Panel" (collapsible, zero impact on existing layout).

---

## VALIDATION ON PROD (once deployed)

```bash
BASE=https://YOUR_CLOUD_RUN_URL

# health with feeds
curl -s $BASE/api/v2/health | jq '.data.feeds'

# polymarket feed-health
curl -s "$BASE/api/v2/polymarket?action=feed-health" | jq

# start WS (idempotent)
curl -s "$BASE/api/v2/polymarket?action=ws-start"

# watch SSE stream
curl -N $BASE/api/live-stream
```

---

## PHASE 2 BATCH 2 CLOSING

- **DONE:** C4 Polymarket WS + C10 MEXC WS hardening + C5 full sweep + feed-health observability across 3 surfaces.
- **BLOCKED:** prod URL verification still pending.
- **NEXT:** Phase 2 Batch 3 — intelligence agents (news/sentiment/ranking/orderbook/volume).
- **RISKS:** low. Polymarket WS is opt-in; MEXC behaviour-compatible.
- **FILES TOUCHED:** 1 new, 13 edited.
- **ADDITIVE IMPACT:** primary strategic surface can now receive live ticks; MEXC feed becomes self-healing; every critical path has observable failures.
- **PROFIT IMPACT:** unlocks faster reaction + stale-data rejection for the ranker that lands in Batch 3.
- **MARKET-SENSITIVITY IMPACT:** real-time orderbook/trade/price streams available behind a single env flag.
