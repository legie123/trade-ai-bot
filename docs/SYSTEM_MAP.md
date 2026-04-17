# TRADE AI — System Map

> Audit read-only generat 2026-04-18. Stare HEAD: `5e95ddc`.
> Pentru fix-plan prioritar vezi `docs/MASTER_AUDIT.md`.

## 1. Stack

- **Runtime:** Next.js 16.1.6 (App Router) + React 19.2.3 + TypeScript 5.x
- **Deploy:** GCP Cloud Run `trade-ai`, project `evident-trees-453923-f9`, region `europe-west1`
- **CI:** GitHub Actions `.github/workflows/deploy.yml` — push main → build → deploy → health-check
- **DB:** Supabase (PostgreSQL managed) — pattern `json_store` key/value
- **Secrets:** GCP Secret Manager, injectate via `--set-secrets=...:latest`

## 2. API Routes — Inventar (57 endpoints)

### 2.1 Authentication
- `/api/auth` — login/status, folosește `DASHBOARD_PASSWORD` + JWT HMAC-SHA256

### 2.2 Public read-only (no auth)
- `/api/v2/health` — agregat 5 sisteme (polymarket, supabase, binance, deepseek, telegram)
- `/api/health` — proxy spre v2/health (fix 2026-04-18 self-fetch)
- `/api/v2/cockpit-health` — probe interne (botConfig, decisions, moltbook)
- `/api/v2/arena` — leaderboard gladiatori
- `/api/v2/omega-status` — synthesis Omega
- `/api/v2/analytics`, `/api/v2/events`, `/api/v2/pre-live` — observability (cronAuth)
- `/api/v2/intelligence/*` — news, sentiment, ranking, feed-health
- `/api/v2/deepseek-status` — credit check LLM
- `/api/diagnostics/{master,credits,signal-quality}` — diagnostice
- `/api/dashboard`, `/api/bot`, `/api/telegram` — UI read-only endpoints
- `/api/live-stream` — SSE
- `/api/btc-signals`, `/api/solana-signals`, `/api/meme-signals`, `/api/tokens/*` — scouts output
- `/api/v2/polymarket` — status + `/paper-signals`, `/paper-backtest`, `/backtest-snapshots` GET, `/snapshots-by-division`

### 2.3 CRON auth (CRON_SECRET)
- `/api/cron` — root cron scheduler
- `/api/moltbook-cron` — moltbook sentiment cron
- `/api/v2/cron/{sentiment,positions,auto-promote}` — v2 scheduled jobs
- `/api/v2/polymarket/cron/{scan,mtm,resolve}` — polymarket jobs
- `/api/v2/polymarket/backtest-snapshots` POST (fix 2026-04-18)

### 2.4 SWARM_TOKEN auth (A2A)
- `/api/a2a/orchestrate` POST (GET public)
- `/api/a2a/{alpha-quant,execution,risk,sentiment}` — arena sub-services

### 2.5 TV_SECRET_TOKEN auth
- `/api/tradingview` — webhook TradingView

### 2.6 JWT cookie auth (user)
- `/api/v2/command` (mutations only — read-only commands bypass)
- `/api/auto-trade`, `/api/exchanges`, `/api/indicators`, `/api/kill-switch`
- `/api/tokens/[address]`, `/api/trade-reasoning`, `/api/v2/backtest`
- `/api/v2/gladiator-attribution`
- `/api/v2/polymarket/ranker-config` POST (fix 2026-04-18)
- `/api/v2/polymarket/{tune-threshold,tune-by-division,sentinel-coupling}` — POST fără auth momentan; advisory, risc DoS

## 3. Flow-uri execuție (end-to-end)

### 3.1 Crypto — signal → trade
```
Scout Engine (btcEngine/solanaEngine/memeEngine)
  ↓ raw signal {BUY/SELL/LONG/SHORT/NEUTRAL, reason}
signalRouter.ts  → adaugă confidence (50-100, saturează trivial la 100)
  ↓ RoutedSignal
signalStore + ArenaSimulator.distributeSignalToGladiators()
  ↓
gladiatorStore.findBestGladiator(symbol)
  ↓
ManagerVizionar.processSignal(gladiator, routed)
  ↓ dacă PAPER → shadow execution
  ↓ dacă LIVE + gladiator.isLive → executionMexc.placeOrder()
```

### 3.2 Polymarket — scan → phantom bet
```
cron/scan (CRON_SECRET)
  ↓ scanDivision × 3 priority divisions
opportunity.edgeScore ≥ 50 → evaluateMarket(gladiator)
  ↓ direction ≠ SKIP && confidence ≥ 50
phantom bet push pe gladiator
  ↓ dacă gladiator.isLive → openPosition pe wallet
persistWallet + persistGladiators
```

### 3.3 Omega synthesis
```
A2A orchestrate POST (SWARM_TOKEN)
  ↓ fan-out paralel spre alpha-quant + sentiment + risk + execution
swarmOrchestrator.orchestrate() agregă
  ↓ omegaExtractor.getCurrentSynthesis()
  → globalModifier, directionBias, aggregatedWR, aggregatedPF
```

## 4. Structură `src/lib/v2/`

```
alerts/        — notificări + Telegram bridge
arena/         — simulator gladiatori + leaderboard
audit/         — audit logs
debate/        — multi-model debate (Claude+Llama+DS)
exchange/      — MEXC client (priority) + adapters
forge/         — generare gladiatori noi ("The Forge")
gladiators/    — persistenta + lifecycle
intelligence/  — news, sentiment, ranking
manager/       — ManagerVizionar (orchestrare signal→trade)
master/        — orchestrator global
memory/        — memorie persistenta (Supabase)
metrics/       — Sharpe, PF, drawdown calculators
ml/            — modele ML (probabil backtest/training)
optimization/  — tuner parametri
paper/         — paper trading engine
promoters/     — auto-promote shadow→live
safety/        — kill-switch + watchdog
scouts/ta/     — scouts tehnice (btcEngine, solanaEngine, memeEngine + indicatori)
superai/       — omegaExtractor + synthesis
swarm/         — swarmOrchestrator (a2a fan-out)
validation/    — PnL validator, pre-live checks
```

## 5. Findings — issues curente

| # | Issue | Status | Evidence | Impact |
|---|-------|--------|----------|--------|
| 1 | MEXC `getMexcPrices` timeout batch ALL-tickers | **IN-FLIGHT USER** | commits `21d3fc3..5e95ddc` | Blocheaza cron evaluation → 0 trade-uri |
| 2 | Confidence router saturează trivial la 100 | **NEFIXAT** | `signalRouter.ts:115-128` | Dashboard nu discriminează, filtru 70% inutil |
| 3 | Health proxy `/api/health` DEGRADED pe self-fetch | **FIX 2026-04-18** (commit in-flight) | `api/health/route.ts` self-fetch cu headere corupte | Cosmetic + Cloud Scheduler monitor miss |
| 4 | ranker-config POST fără auth (mutație) | **FIX 2026-04-18** | `PUBLIC_PREFIXES` match startsWith | Security HIGH (dacă POLY_EDGE_AUTOPROMOTE=true) |
| 5 | backtest-snapshots POST fără auth (mutație cost) | **FIX 2026-04-18** | same pattern prefix match | DoS + mutatie neautorizata |
| 6 | `agents:status` command fetch failed | **NEFIXAT** | `/api/v2/command` → `/api/a2a/orchestrate` self-fetch fail | Control Room afișează agents degraded |
| 7 | `liveFighters: 0` pe arena (12 active) | **NEVERIFICAT cauză** | `/api/v2/arena` snapshot | Niciun gladiator nu trece la LIVE |
| 8 | `superAiOmega.trainingProgress: 0` | **NEVERIFICAT cauză** | same | Omega dormant, nu învață |
| 9 | tune-threshold + tune-by-division POST fără auth | **OPEN (advisory)** | prefix match | Risc DoS (sweep intens) |
| 10 | sentinel-coupling POST fără auth | **OPEN** | prefix match | Evaluare repetată pe request → resursă |

## 6. Quick wins aplicate in acest commit

- `src/app/api/health/route.ts` — self-fetch fara headere propagate, 10s timeout
- `src/app/api/v2/polymarket/ranker-config/route.ts` — `isAuthenticated` pe POST
- `src/app/api/v2/polymarket/backtest-snapshots/route.ts` — `requireCronAuth` pe POST

Validare: `tsc --noEmit` → zero erori.

## 7. Urmatori pasi propuși (așteaptă aprobare)

1. **Reason-weighted confidence cap** în `signalRouter.ts` — stop saturare 100.
2. **Auth tune-threshold + tune-by-division** POST — closure pe toată familia polymarket.
3. **Investigație `liveFighters: 0`** — verific condiția `promoteToLive()` în `v2/promoters/`.
4. **Investigație `agents:status` fetch failed** — debug self-fetch pattern în `/api/v2/command`.
