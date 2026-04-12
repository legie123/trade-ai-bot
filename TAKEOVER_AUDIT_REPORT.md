# TRADE AI — FULL TAKEOVER AUDIT REPORT

**Date:** 2026-04-12
**Auditor:** Claude (Orchestrator Principal)
**Scope:** Complete system audit — GitHub repo, local filesystem, live deploy, architecture, all modules
**Verdict:** TAKEOVER APPROVED — Major reconstruction required

---

## 1. WHAT EXISTS

Two separate projects discovered in the workspace:

### Project A: ANTIGRAVITY (in /TRADE AI/ANTIGRAVITY/)
- **Stack:** Next.js 15.3.0, React 19, TypeScript 5.8.3, Supabase
- **Size:** ~1,000 LOC
- **Deployed:** antigravity-trade-3rzn6ry36q-ew.a.run.app (Cloud Run)
- **AI:** 3 LLMs parallel — GPT-4o (45%), DeepSeek (40%), Gemini (15%)
- **Signals:** RSI(14) + MACD(12/26/9) + VWAP on 15m candles, 8 symbols
- **Risk:** Sentinel with kill switch, 4hr halt, drawdown 10%, max 3 daily losses
- **Exchange:** MEXC with HMAC-SHA256, 4-source price oracle
- **Status:** Production-ready core, clean code, no mocks

### Project B: TRADE AI MAIN (in /TRADE AI/)
- **Stack:** Next.js 16.1.6, React 19, TypeScript, Supabase, WebSockets
- **Size:** ~6,300 LOC
- **Deployed:** trade-ai-657910053930.europe-west1.run.app (Cloud Run)
- **AI:** Dual Master (Architect GPT-4o + Oracle DeepSeek), Syndicate debate
- **Arena:** Gladiator phantom trading system, 10+ competing strategies
- **Forge:** LLM-based DNA generation (DeepSeek → GPT-4o → Gemini fallback)
- **Exchange:** MEXC (live-capable), Binance (locked to DRY RUN), Bybit/OKX (dead code)
- **Providers:** DexScreener, Birdeye, Jupiter, GeckoTerminal, Rugcheck, Pump.fun
- **Status:** Advanced research system, many issues (see below)

---

## 2. CRITICAL FINDINGS — BRUTAL ASSESSMENT

### SEVERITY: CRITICAL (Must fix before any trading)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| C1 | **Kill switch doesn't await liquidation** — fire-and-forget async, no retry | killSwitch.ts L74-84 | Positions may stay open during emergency |
| C2 | **Floating PnL injection** — fake live equity movements injected into dashboard | /api/bot/route.ts L104-116 | Dashboard lies about real balance |
| C3 | **Conflicting execution modes** — MEXC can go live, managerVizionar hardcodes dryRun:true | managerVizionar.ts L228 | Unclear if system is paper or live |
| C4 | **Fake mutation system** — promoters rename gladiators without changing strategy DNA | v2/promoters/ | No real genetic evolution happening |
| C5 | **.env with real API keys exposed** — world-readable production secrets | /TRADE AI/.env | Security breach risk |

### SEVERITY: HIGH (System integrity issues)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| H1 | **Butcher uses OR logic** — promotes low-WR strategies with lucky PF | butcher.ts | Survivorship bias in gladiator selection |
| H2 | **Hardcoded 10-symbol whitelist** in AlphaScout | alphaScout.ts L22-25 | Can't analyze new tokens |
| H3 | **Simplified drawdown calculation** in bot API | /api/bot/route.ts L59-69 | Only counts consecutive losses, not real MDD |
| H4 | **Position closing doesn't verify cancellations** | positionManager.ts L123-134 | Potential double-spend on dust positions |
| H5 | **Dead exchange code** — Bybit, OKX clients exist but never called | exchange/bybitClient.ts, okxClient.ts | Maintenance burden, confusion |
| H6 | **Win threshold was 0.05%** — any micro-movement counted as WIN | /api/cron/route.ts L126 | Previously inflated to 80%+ (now fixed to 0.3%) |
| H7 | **Arena simulator makes individual MEXC API calls per trade** | arena/simulator.ts | API rate limit risk, potential IP ban |

### SEVERITY: MEDIUM (Quality & maintainability)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| M1 | **Excessive theatrical naming** — "Omega", "Forge", "Butcher", "Moltbook" | Everywhere | Obscures actual functionality |
| M2 | **No unit tests** in either project | Both | Zero test coverage |
| M3 | **Cache TTL mismatch** — MEXC 5min vs Binance 1hr | executionMexc.ts, executionBinance.ts | Stale filter data |
| M4 | **BONK hardcoded special case** in price fallback | apiFallback.ts L38-49 | Brittle, needs code change per edge case |
| M5 | **Polling vs SSE inconsistency** — different pages use different strategies | crypto-radar vs bot-center | Architectural confusion |
| M6 | **Provider deduplication missing** — same token can appear twice | providerManager.ts L77-83 | Duplicate signals |
| M7 | **Genesis timestamp set to April 4, 2026** — arbitrary uptime calculation | /api/dashboard/route.ts L47 | Misleading system age |
| M8 | **Conviction score has no input validation** | convictionScore.ts L161-192 | NaN propagation risk |

---

## 3. WHAT'S ACTUALLY GOOD

These components are solid and worth preserving:

| Component | Source | Why it's good |
|-----------|--------|---------------|
| AI Consensus Engine | ANTIGRAVITY consensus.ts | 3-model parallel, weighted voting, hallucination detection via Jaccard |
| Signal Generator | ANTIGRAVITY signals.ts | Real RSI+MACD+VWAP on live candles, clean scoring |
| Price Oracle | ANTIGRAVITY price.ts | 4-source fallback (MEXC→Binance→OKX→CoinGecko), 30s cache |
| MEXC Client | ANTIGRAVITY mexc.ts | Real HMAC-SHA256, LOT_SIZE rounding, emergency sell |
| Sentinel Risk Engine | ANTIGRAVITY sentinel.ts | Hardened: MDD 10%, daily loss 3, streak 4, confidence 75% |
| Dual Master Concept | Trade AI dualMaster.ts | Split-brain TA vs Sentiment is architecturally sound |
| Arena Concept | Trade AI arena/ | Phantom trading for strategy validation is valuable |
| Forge Concept | Trade AI forge.ts | LLM-based DNA generation has real potential |
| Gladiator Types | Trade AI types/ | Well-defined interfaces (Gladiator, GladiatorDNA, Strategy) |
| Database Schema | Both | Proper tables: positions, decisions, equity, gladiators |
| Win Threshold Fix | Trade AI cron | 0.3% minimum after fees — correctly applied |

---

## 4. DECISION MAP — KEEP / REWRITE / ELIMINATE

### KEEP (Merge into unified project)
- ANTIGRAVITY AI consensus engine → becomes Syndicate core
- ANTIGRAVITY signal generator → becomes Radar signal engine  
- ANTIGRAVITY price oracle → becomes unified price feed
- ANTIGRAVITY MEXC client → becomes primary exchange client
- ANTIGRAVITY Sentinel → becomes unified risk engine
- Trade AI Gladiator type system → becomes strategy framework
- Trade AI database schema concepts → merge into unified schema
- Trade AI Dual Master concept → evolves into Syndicate debate

### REWRITE (New implementation, same concept)
- **Arena** — new phantom trade simulator with batched price calls, no API spam
- **Forge** — real genetic crossover with parameter mutation, not rename
- **Butcher** — AND logic (WR >= 40% AND PF >= 1.1), proper elimination
- **Kill Switch** — await liquidation with 3 retries + exponential backoff
- **Position Manager** — verify cancellations before market sells
- **Dashboard/Radar** — completely new institutional-grade UI
- **Dashboard/Arena** — completely new gladiator battle visualization
- **Dashboard/Status** — heavily optimized operational view
- **Configuration** — unified config (no env vars vs DB splits)
- **Cron System** — unified ticker with proper rate limiting

### ELIMINATE (Remove entirely)
- Floating PnL injection (C2)
- Bybit client (dead code)
- OKX client (dead code)
- dexScreenerLive.ts (unused)
- Moltbook broadcasts (Romanian social media posts)
- PM2 ecosystem config (not used on Cloud Run)
- Railway/Render deployment configs (using Cloud Run)
- Vercel configs (abandoned)
- All theatrical naming ("Omega", "Moltbook", "Dragons Delivery")
- InstallPwaButton, SwRegister (PWA not needed)
- Pump.fun provider (meme coin noise)
- Fear & Greed index polling (decorative, not actionable)

---

## 5. UNIFIED ARCHITECTURE (TARGET)

```
TRADE AI v3 — Unified Production System
├── src/
│   ├── app/
│   │   ├── page.tsx                    → Redirect to /radar
│   │   ├── radar/page.tsx              → NEW: Institutional Radar
│   │   ├── arena/page.tsx              → NEW: Gladiator Arena
│   │   ├── status/page.tsx             → OPTIMIZED: Operational Status
│   │   ├── layout.tsx                  → App shell
│   │   └── api/
│   │       ├── health/route.ts         → System health
│   │       ├── dashboard/route.ts      → Unified dashboard data
│   │       ├── positions/route.ts      → Position management
│   │       ├── arena/route.ts          → Arena + gladiator data
│   │       ├── cron/route.ts           → Main trading loop
│   │       └── signal/route.ts         → External signal webhook
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── syndicate.ts            → LLM consensus (from ANTIGRAVITY)
│   │   │   └── signals.ts             → Technical signals (from ANTIGRAVITY)
│   │   ├── arena/
│   │   │   ├── simulator.ts           → REWRITE: Batched phantom trading
│   │   │   ├── forge.ts              → REWRITE: Real genetic crossover
│   │   │   └── butcher.ts            → REWRITE: AND-logic elimination
│   │   ├── exchange/
│   │   │   ├── mexc.ts               → Primary (from ANTIGRAVITY)
│   │   │   ├── binance.ts            → Fallback price only
│   │   │   └── price.ts              → 4-source oracle (from ANTIGRAVITY)
│   │   ├── risk/
│   │   │   ├── sentinel.ts           → Hardened risk engine (from ANTIGRAVITY)
│   │   │   ├── engine.ts             → Trade orchestration (from ANTIGRAVITY)
│   │   │   └── killswitch.ts         → REWRITE: Awaited liquidation
│   │   ├── db/
│   │   │   ├── client.ts             → Supabase client
│   │   │   └── schema.sql            → Unified schema
│   │   └── types/
│   │       ├── index.ts              → Core types
│   │       ├── gladiator.ts          → Strategy types
│   │       └── arena.ts              → Arena types
│   └── components/                    → Shared UI components
├── Dockerfile
├── package.json
└── next.config.ts
```

---

## 6. EXECUTION PLAN

### Phase 4: Core Architecture (NOW)
1. Unify both projects into single clean codebase
2. Port ANTIGRAVITY core (consensus, signals, price, MEXC, sentinel) as foundation
3. Port Trade AI v2 concepts (gladiators, arena, forge) with clean implementations
4. Unified Supabase schema
5. Unified config management

### Phase 5: Radar UI (NEXT)
- Institutional-grade market scanner
- Live signals across watchlist
- Technical indicators visualization
- AI confidence overlay

### Phase 6: Arena UI (NEXT)
- Gladiator leaderboard with real stats
- Phantom trade feed
- Strategy DNA viewer
- Elimination/promotion timeline

### Phase 7: Status UI
- Operational health dashboard
- Exchange connection status
- Risk gauge panel
- Trade execution log

### Phase 8: Deploy & Validate
- Clean Docker build
- Cloud Run deployment
- Cron setup
- Health verification

### Phase 9: Paper Trading
- 30-day paper validation target
- Real P&L tracking
- Strategy qualification
- Live switch preparation

---

## 7. STATUS REAL AL PROIECTULUI

**ANTIGRAVITY:** 8.5/10 — production-ready core, clean, verified
**TRADE AI MAIN:** 5/10 — good concepts, but fake mutations, floating PnL injection, dead code, theatrical noise, missing implementations, no tests
**UNIFIED TARGET:** Will be 9/10 — institutional-grade, real trading, clean architecture

**Next step:** Begin Phase 4 — Architecture reconstruction. Merging best of both into unified clean system.
