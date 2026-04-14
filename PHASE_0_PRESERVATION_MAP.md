# PHASE 0 — BASELINE PRESERVATION MAP
Date: 2026-04-15
Branch: main (clean)
Rule: additive-only. Nothing in this map is to be deleted. Everything classified below.

---

## A. ARCHITECTURE SNAPSHOT

- **Framework:** Next.js 16.1.6, React 19.2.3, TypeScript 5
- **Data:** Supabase (`@supabase/supabase-js` 2.99.2)
- **Realtime:** `ws` 8.20.0 (Polymarket WS client)
- **AI:** `@google/generative-ai` 0.24.1
- **Deploy targets present:** Cloud Run (`cloudbuild.yaml`, `DEPLOY_PRODUCTION.sh`), Vercel (`vercel.json`, `deploy_vercel.sh`), Railway (`railway.json`), Render (`render.yaml`), PM2 (`ecosystem.config.js`), Docker (`Dockerfile`). GCP-first per user memory.
- **Supabase migration:** `supabase_migration_complete.sql` present.
- **File count:** 171 TS/TSX in `src/`, 35 API routes, 7 UI pages.

---

## B. UI MAP — pages (`src/app/*`)

| Page | Path | Classification |
|------|------|----------------|
| Root | `src/app/page.tsx` | KEEP AS IS (pending walkthrough) |
| Login | `src/app/login/page.tsx` | KEEP AS IS |
| Dashboard | `src/app/dashboard/page.tsx` | KEEP AND HARDEN (truthfulness audit needed) |
| Polymarket | `src/app/polymarket/page.tsx` | KEEP AND EXTEND (primary strategic surface) |
| Bot Center | `src/app/bot-center/page.tsx` | KEEP AND HARDEN |
| Arena | `src/app/arena/page.tsx` | KEEP AND HARDEN |
| Crypto Radar | `src/app/crypto-radar/page.tsx` | KEEP AND EXTEND |

Shell/UX components (`src/components/*`): `AppShell`, `Sidebar`, `BottomNav`, `CommandPalette`, `KpiBar`, `LiveIndicator`, `AgentStatusHero`, `PipelineStatus`, `DecisionMatrix`, `EquityCurve`, `TerminalOverlay`, `MoltbookSwarmFeed`, `SyndicateFeed`, `TradingViewChart`, `ApiCreditsDashboard`. **All KEEP AS IS** pending per-component validation.

---

## C. ROUTE MAP — API (35 routes)

### Polymarket — primary strategic surface (KEEP AND EXTEND)
- `api/v2/polymarket/route.ts`
- `api/v2/polymarket/cron/scan/route.ts`
- `api/v2/polymarket/cron/resolve/route.ts`
- `api/v2/polymarket/cron/mtm/route.ts`

### v2 core (KEEP AND HARDEN)
- `api/v2/health`, `api/v2/deepseek-status`, `api/v2/arena`, `api/v2/backtest`
- `api/v2/cron/{positions,auto-promote,sentiment}`

### A2A — agent-to-agent (KEEP AND EXTEND — this is the agent layer foundation)
- `api/a2a/{orchestrate,alpha-quant,execution,risk,sentiment}`

### Signals / exchanges (KEEP AND HARDEN)
- `api/{btc-signals,solana-signals,meme-signals,indicators}`
- `api/{exchanges,tokens,tokens/[address]}`
- `api/{bot,auto-trade,trade-reasoning,tradingview}`

### Ops / infra (KEEP AND HARDEN)
- `api/{auth,dashboard,cron,telegram,moltbook-cron}`
- `api/diagnostics/{master,credits,signal-quality}`

### Status of stale `.next` references (PHASE 1 FIX)
TSC complains about 8 missing routes referenced by `.next/types/validator.ts`:
`agent-card`, `health`, `live-stream`, `notifications`, `v2/dry-run`, `v2/pre-live`, `v2/test-live-cycle`, `watchdog/ping`.
These route dirs do NOT exist in `src/app/api/`. Cause: stale build cache. Non-blocking. Fix: `.next` clean + rebuild. No source deletion.

---

## D. BOT / STRATEGY / RADAR / ARENA MAP

### `src/lib/polymarket/` — KEEP AS IS (core strategic engine)
- `polyClient.ts` — WS client
- `marketScanner.ts` — scanner
- `polyGladiators.ts` — strategy agents
- `polySyndicate.ts` — aggregation
- `polyState.ts` — state (note: `serializeWallet`/`deserializeWallet` exist locally, not exported — test harness references them; FIX additively by exporting or by adjusting test)
- `polyWallet.ts` — paper wallet
- `riskManager.ts` — risk
- `strategies.ts` — strategy defs
- `alerts.ts`, `telemetry.ts`, `polyTypes.ts`, `index.ts`

### `src/lib/v2/` — KEEP AND EXTEND (agent / swarm layer — thin in places)
| Subsystem | Files | Classification |
|-----------|-------|----------------|
| `alerts/` | eventHub | KEEP AS IS |
| `arena/` | arenaConfig, simulator | KEEP AS IS |
| `forge/` | dnaExtractor | KEEP AS IS |
| `gladiators/` | butcher, gladiatorRegistry, index | KEEP AND HARDEN |
| `intelligence/` | alphaScout only | **THIN — EXTEND** (add news/sentiment/regime agents here) |
| `manager/` | index, managerVizionar, positionManager | KEEP AND HARDEN |
| `master/` | dualMaster, index, masterOracles | KEEP AND HARDEN |
| `metrics/` | gladiatorMetrics | KEEP AS IS |
| `paper/` | paperWallet only | **THIN — EXTEND** (add PnL tracker, signal-to-entry trace) |
| `promoters/` | forge, index, promotersAggregator | KEEP AS IS |
| `safety/` | autoDebugEngine, sentinelGuard | KEEP AND HARDEN (wrap for observability) |
| `scouts/ta/` | 12 indicators + executionMexc | KEEP AS IS |
| `superai/` | dna/omega/monteCarlo/llmSentiment | KEEP AND EXTEND |
| `swarm/` | swarmOrchestrator only | **THIN — EXTEND** (add orderbook/volume/ranking agents) |

### `src/lib/core/` — KEEP AS IS
`apiFallback`, `fearGreed`, `heartbeat`, `killSwitch`, `logger`, `watchdog`

### Other libs — KEEP AS IS
`alerts/`, `auth/`, `cache/`, `exchange/`, `ml/`, `moltbook/`, `normalizers/`, `providers/`, `router/`, `scoring/`, `store/`, `types/`

---

## E. PAPER TRADING MAP

- **Core wallet:** `src/lib/polymarket/polyWallet.ts` — KEEP AS IS
- **v2 wallet:** `src/lib/v2/paper/paperWallet.ts` — KEEP AND EXTEND
- **State persistence:** `src/lib/polymarket/polyState.ts` (serializeWallet not exported — FIX additively)
- **Gladiator simulation:** `src/lib/v2/arena/simulator.ts` — KEEP AS IS
- **Isolation from live:** UNVERIFIED — requires explicit env guard audit in Phase 5

---

## F. DEPLOY MAP

| File | Purpose | Classification |
|------|---------|----------------|
| `Dockerfile` | container | KEEP AS IS |
| `cloudbuild.yaml` | GCP Cloud Build | KEEP AND HARDEN (add post-deploy health) |
| `DEPLOY_PRODUCTION.sh` | primary deploy | KEEP AND HARDEN |
| `deploy_cloudrun.command` / `deploy_full.command` | local triggers | KEEP AS IS |
| `smoke_tests.sh` | smoke checks | KEEP AND EXTEND |
| `test-connectivity.mjs` | connectivity | KEEP AS IS |
| `vercel.json`, `railway.json`, `render.yaml`, `ecosystem.config.js` | alt targets | KEEP AS IS (not primary) |
| Per user memory: IP `149.174.89.163` for MEXC/Binance | infra | KEEP |

---

## G. CONTROLS / BUTTONS INVENTORY — TO VALIDATE IN PHASE 4

Pending per-page walkthrough. Preliminary list extracted from components:
- Dashboard: live-indicator, KPI bar, pipeline status, decision matrix, equity curve, API credits
- Polymarket: syndicate feed, market scanner controls, gladiator controls, strategy toggles
- Bot Center: bot start/stop, strategy select, refresh
- Arena: simulator controls, arena config
- Crypto Radar: scan toggle, signals list
- Command Palette (global): keyboard shortcuts
- Terminal Overlay, Moltbook Swarm Feed

Every control will be logged PASS / FAIL / PARTIAL / UNVERIFIED in Phase 4 walkthrough.

---

## H. PRESERVE-FIRST PLAN

### KEEP AS IS (no touch, just observe)
All of `src/lib/core/`, `src/lib/polymarket/*` (except polyState export fix), `src/lib/v2/scouts/ta/*`, `src/components/*`, all deploy configs, all UI pages until walkthrough.

### KEEP AND HARDEN (add observability, error surfacing, health)
`src/app/dashboard`, `src/app/bot-center`, `src/app/arena`, all `api/v2/*`, `api/a2a/*`, `api/diagnostics/*`, `src/lib/v2/gladiators`, `src/lib/v2/manager`, `src/lib/v2/master`, `src/lib/v2/safety`

### KEEP AND EXTEND (add new modules beside existing, no rewrite)
- `src/lib/v2/intelligence/` → add `newsCollector.ts`, `newsDedup.ts`, `sentimentAgent.ts`, `entityLinker.ts`, `marketRegime.ts`
- `src/lib/v2/swarm/` → add `orderbookIntel.ts`, `volumeIntel.ts`, `opportunityRanker.ts`, `feedHealthMonitor.ts`, `uiVerificationAgent.ts`
- `src/lib/v2/paper/` → add `pnlTracker.ts`, `signalTraceLog.ts`
- `src/app/polymarket` → additive panels, don't touch existing
- `src/app/api/v2/polymarket/` → add new sub-routes for ranking/feed-health, keep existing

### KEEP AND WRAP (keep original, wrap with safety)
`src/lib/v2/safety/autoDebugEngine`, `sentinelGuard` → wrap with structured logging from `src/lib/core/logger`

### KEEP AND REPAIR
- `polyState.ts` — export `serializeWallet`, `deserializeWallet` (additive; currently only locally declared)
- `test-tier-1-fixes.ts` — type-narrow 4 errors (OR mark as legacy and exclude from build)
- `.next` stale validator references — rebuild, no source touch

### DANGEROUS / BROKEN / UNVERIFIED
- **UNVERIFIED — paper vs live isolation.** No evidence yet of env guard enforcing paper-only. Flag for Phase 5.
- **UNVERIFIED — WS reconnect/heartbeat in `polyClient.ts`.** Flag for Phase 2 Layer A.
- **UNVERIFIED — dashboard truthfulness.** `LiveIndicator` component exists; does it reflect real backend state? Flag for Phase 2 Layer G.
- **UNVERIFIED — all 35 API routes actually running.** Flag for Phase 1 deep scan.
- No items classified DANGEROUS yet. Need Phase 1 critical failure scan.

---

## PHASE 0 CLOSING

- **DONE:** baseline preservation map committed as document; 35 routes / 171 files / 15 v2 subsystems classified.
- **BLOCKED:** none
- **NEXT:** Phase 1 critical failure scan (I'll execute next session/batch on approval; delivers ranked ISSUE list per your template).
- **RISKS:** stale `.next` cache is cosmetic; `polyState` export gap is minor; real risk sits in unverified paper-isolation + WS resilience — Phase 1/2 targets.
- **FILES TOUCHED:** 1 new — this document. Zero source files modified.
- **ADDITIVE IMPACT:** classification baseline for every subsequent batch; prevents accidental deletion.
- **PROFIT IMPACT:** none yet (planning phase).
- **MARKET-SENSITIVITY IMPACT:** none yet (planning phase).
