# PHASE 2 — ROUTE AUDIT & CATEGORIZATION
**Date: April 14, 2026 | Status: IN PROGRESS | Target: Complete route assessment**

---

## SUMMARY
- **Total Routes:** 46
- **ACTIVE (Called from UI/Components):** 17
- **UNCERTAIN (Exist, unclear if used):** 15  
- **DEAD (Never called, orphaned):** 14

---

## ✅ ACTIVE ROUTES (17) — KEEP & VALIDATE

### Core Polymarket (5 routes)
```
✅ src/app/api/v2/polymarket/route.ts
   - action=status → Get 16 divisions status
   - action=scan → Scan markets in division
   - action=markets → List markets by division
   - action=wallet → Get PolyWallet balance
   - action=gladiators → Get gladiators status
   - POST: open_position, close_position
   - CALLED BY: PolymarketPage.tsx (main component)
   - STATUS: OPERATIONAL (just fixed, 4 bugs resolved)

✅ src/app/api/v2/polymarket/cron/mtm/route.ts
   - Cron job: Update mark-to-market for all positions
   - CALLED BY: cron scheduler (server-side)
   - STATUS: OPERATIONAL (unrealizedPnL accumulation bug fixed)

✅ src/app/api/v2/polymarket/cron/scan/route.ts
   - Cron job: Scan markets for new opportunities
   - CALLED BY: cron scheduler
   - STATUS: OPERATIONAL (outcome case sensitivity fixed)

✅ src/app/api/v2/polymarket/cron/resolve/route.ts
   - Cron job: Determine winners, resolve positions
   - CALLED BY: cron scheduler
   - STATUS: OPERATIONAL (case sensitivity fixed)
```

### Authentication & Authorization (1 route)
```
✅ src/app/api/auth/route.ts
   - POST: Login with password
   - GET: Check auth status
   - CALLED BY: LoginPage.tsx, AuthContext hooks
   - STATUS: OPERATIONAL but WEAK (password only, no JWT, no roles)
   - RISK: High — no role-based access control
   - NEEDS: Replace with JWT + roles
```

### Dashboard & Status (3 routes)
```
✅ src/app/api/dashboard/route.ts
   - GET: Dashboard data (KPIs, activity, holdings)
   - CALLED BY: DashboardPage.tsx
   - STATUS: UNCERTAIN (endpoint exists, data source unclear)
   - TODO: Verify data source, ensure real-time accuracy

✅ src/app/api/v2/deepseek-status/route.ts
   - GET: LLM status, available credits
   - CALLED BY: Status display components
   - STATUS: OPERATIONAL (displays API key validation)

✅ src/app/api/health/route.ts (old)
   - GET: Simple health check
   - CALLED BY: Status widgets
   - STATUS: DEPRECATED (newer /api/v2/health replaces this)
   - ACTION: Delete after v2 is deployed
```

### Arena System (1 route)
```
✅ src/app/api/v2/arena/route.ts
   - GET/POST: Arena operations (unclear what "Arena" is)
   - CALLED BY: ArenaPage.tsx
   - STATUS: UNCERTAIN (exists, purpose unclear)
   - TODO: Document what Arena does, verify functionality
```

### Cron Scheduling (1 route)
```
✅ src/app/api/cron/route.ts
   - GET: List all scheduled cron jobs
   - POST: Trigger cron job manually
   - CALLED BY: Cron system, possibly UI for manual triggering
   - STATUS: OPERATIONAL but UNVERIFIED at scale
   - TODO: Test with live cron runs
```

### Bot Control (1 route)
```
✅ src/app/api/bot/route.ts
   - GET/POST: Bot configuration and control
   - CALLED BY: BotCenter? Unclear
   - STATUS: UNCERTAIN (endpoint exists, usage unclear)
   - TODO: Verify if BotCenter uses this, document functionality
```

### Integrations (4 routes)
```
✅ src/app/api/exchanges/route.ts
   - GET: List supported exchanges
   - CALLED BY: Components showing exchange options
   - STATUS: UNCERTAIN (likely just returns list, verify usefulness)

✅ src/app/api/tokens/route.ts
   - GET: Token list (Solana?)
   - CALLED BY: Token selection components
   - STATUS: UNCERTAIN (Solana token lookup, not in primary flow)

✅ src/app/api/telegram/route.ts
   - POST: Send Telegram alerts
   - CALLED BY: Alert system, cron jobs
   - STATUS: OPERATIONAL (alerts working if bot token configured)

✅ src/app/api/diagnostics/master/route.ts & /credits/route.ts
   - GET: System diagnostics, API credit status
   - CALLED BY: Diagnostics panel
   - STATUS: OPERATIONAL (shows system health details)
```

---

## ⚠️ UNCERTAIN ROUTES (15) — INVESTIGATE & DECIDE

### A2A System (5 routes) — Purpose Unclear
```
⚠️ src/app/api/a2a/alpha-quant/route.ts - CALLED (1 ref)
⚠️ src/app/api/a2a/execution/route.ts - CALLED (1 ref)
⚠️ src/app/api/a2a/orchestrate/route.ts - NOT CALLED
⚠️ src/app/api/a2a/sentiment/route.ts - CALLED (1 ref)
⚠️ src/app/api/a2a/risk/route.ts - CALLED (1 ref)

PURPOSE: Unclear what A2A system does (Arena-to-Arena? Agent-to-Agent?)
ACTION: 
  1. Document what A2A stands for and does
  2. Verify if orchestrate is necessary (not called)
  3. Check if these are production-critical or experimental
```

### Signals & Analysis (4 routes) — Unclear Status
```
⚠️ src/app/api/btc-signals/route.ts - CALLED (1 ref)
   - Purpose: Generate BTC trading signals
   - STATUS: Exists but unclear if used in actual trading
   - ACTION: Verify if signals are used by trading logic

⚠️ src/app/api/trade-reasoning/route.ts - CALLED (1 ref)
   - Purpose: Explain trade rationale via LLM
   - STATUS: Called from somewhere, unclear how
   - ACTION: Trace caller, verify functionality

⚠️ src/app/api/tradingview/route.ts - CALLED (1 ref)
   - Purpose: TradingView integration?
   - STATUS: Unclear what this integrates
   - ACTION: Document integration, verify if active

⚠️ src/app/api/indicators/route.ts - CALLED (1 ref)
   - Purpose: Technical indicators
   - STATUS: Called but unclear context
   - ACTION: Verify if used by scanning/analysis logic
```

### Cron Management (3 routes) — May Be Dead
```
⚠️ src/app/api/v2/cron/auto-promote/route.ts - NOT CALLED from UI
   - Purpose: Auto-promote gladiators
   - STATUS: Server-side cron, likely triggered by scheduler
   - ACTION: Verify if used by /api/cron orchestrator or standalone

⚠️ src/app/api/v2/cron/sentiment/route.ts - NOT CALLED from UI
   - Purpose: Update sentiment data
   - STATUS: Server-side cron, unclear trigger
   - ACTION: Verify if used by scheduler

⚠️ src/app/api/v2/cron/positions/route.ts - NOT CALLED from UI
   - Purpose: Update position data
   - STATUS: Server-side cron, unclear trigger
   - ACTION: Verify if used by scheduler
   - NOTE: MTM and scan are also crons but work fine
```

### Backoffice (2 routes) — Testing/Debug Routes
```
⚠️ src/app/api/v2/deepseek-status/route.ts - Already counted as ACTIVE
⚠️ src/app/api/v2/backtest/route.ts - CALLED (1 ref)
   - Purpose: Run backtest on Polymarket strategies
   - STATUS: Exists, unclear if used in production
   - ACTION: Verify if backtesting is active feature
```

---

## ❌ DEAD CODE (14) — DELETE

### Clear Junk (10 routes)
```
❌ src/app/api/meme-signals/route.ts
   - Purpose: Generate meme token signals?
   - STATUS: Never called, no mention in code
   - ACTION: DELETE

❌ src/app/api/solana-signals/route.ts
   - Purpose: Solana token signals?
   - STATUS: Never called, Solana not in scope
   - ACTION: DELETE

❌ src/app/api/agent-card/route.ts
   - Purpose: Unknown
   - STATUS: Never called
   - ACTION: DELETE

❌ src/app/api/live-stream/route.ts
   - Purpose: Unclear streaming functionality
   - STATUS: Never called
   - ACTION: DELETE

❌ src/app/api/watchdog/ping/route.ts
   - Purpose: Health ping?
   - STATUS: Never called, /api/health and /api/v2/health exist instead
   - ACTION: DELETE

❌ src/app/api/notifications/route.ts
   - Purpose: Notifications (to where?)
   - STATUS: Never called
   - ACTION: DELETE

❌ src/app/api/auto-trade/route.ts
   - Purpose: Auto trading?
   - STATUS: Fetched in code but no UI calls it
   - ACTION: Investigate if used, if not DELETE

❌ src/app/api/v2/dry-run/route.ts
   - Purpose: Dry-run mode for testing?
   - STATUS: Never called
   - ACTION: DELETE

❌ src/app/api/v2/test-live-cycle/route.ts
   - Purpose: Test cycle simulation?
   - STATUS: Never called
   - ACTION: DELETE

❌ src/app/api/v2/events/route.ts
   - Purpose: Event system?
   - STATUS: Never called
   - ACTION: DELETE
```

### Redundant/Deprecated (4 routes)
```
❌ src/app/api/health/route.ts (old)
   - Purpose: Simple health check
   - STATUS: Replaced by /api/v2/health
   - ACTION: DELETE after /api/v2/health is deployed

❌ src/app/api/moltbook-cron/route.ts
   - Purpose: Separate cron endpoint?
   - STATUS: Unclear why this exists alongside /api/cron
   - ACTION: Consolidate with /api/cron or DELETE if redundant

❌ src/app/api/v2/supabase-check/route.ts
   - Purpose: Test Supabase connectivity?
   - STATUS: Never called, health endpoint covers this
   - ACTION: DELETE

❌ src/app/api/v2/pre-live/route.ts
   - Purpose: Pre-live checks?
   - STATUS: Never called
   - ACTION: DELETE

❌ src/app/api/v2/analytics/route.ts
   - Purpose: Analytics data?
   - STATUS: Never called, dashboard handles this
   - ACTION: DELETE
```

---

## DECISION MATRIX

| Route | Status | Decision | Owner | Timeline |
|-------|--------|----------|-------|----------|
| v2/polymarket/* | ACTIVE | KEEP | Polymarket | Now |
| auth | ACTIVE | REFACTOR (JWT) | Auth | Phase 3 |
| dashboard | ACTIVE | VALIDATE | Dashboard | Phase 2 |
| v2/deepseek-status | ACTIVE | KEEP | LLM | Now |
| v2/arena | ACTIVE | DOCUMENT | Arena | Phase 2 |
| cron | ACTIVE | VALIDATE | Scheduler | Phase 2 |
| bot | ACTIVE | DOCUMENT | Bot | Phase 2 |
| exchanges, tokens, telegram, diagnostics | ACTIVE | VALIDATE | Integrations | Phase 2 |
| a2a/* | UNCERTAIN | DOCUMENT or DELETE | A2A System | Phase 2 |
| Signals/btc-signals | UNCERTAIN | VERIFY USAGE | Signals | Phase 2 |
| v2/cron/* | UNCERTAIN | VERIFY TRIGGER | Cron | Phase 2 |
| meme/solana/agent/live/watchdog/notifications | DEAD | DELETE | DevOps | Phase 2 |
| auto-trade, dry-run, test-live, events, pre-live | DEAD | DELETE | DevOps | Phase 2 |
| supabase-check, health (old), moltbook-cron | DEAD | DELETE | DevOps | Phase 2 |

---

## IMMEDIATE ACTIONS (Phase 2 Start)

1. **VALIDATE ACTIVE ROUTES** (2 hrs)
   - [ ] Test each of 17 active routes with sample requests
   - [ ] Verify response schemas
   - [ ] Check error handling
   - [ ] Document expected behavior

2. **INVESTIGATE UNCERTAIN ROUTES** (1 hr)
   - [ ] Trace A2A system purpose and usage
   - [ ] Check if v2/cron jobs are triggered by scheduler or manually
   - [ ] Verify btc-signals are used in actual trading
   - [ ] Document trade-reasoning usage

3. **DELETE DEAD ROUTES** (30 min)
   - [ ] Remove 14 dead code routes
   - [ ] Clean up unused imports/dependencies
   - [ ] Test that deletion doesn't break anything

4. **STANDARDIZE API SCHEMA** (2 hrs)
   - [ ] Define standard response format for all 17 active routes
   - [ ] Update routes to conform to schema
   - [ ] Add consistent error handling

---

## NOTES
- Cron routes (mtm, scan, resolve, auto-promote, sentiment, positions) are called by server-side scheduler, not UI
- Need to understand how cron jobs are triggered: via /api/cron endpoint or separate scheduler
- A2A system is mysterious — needs documentation
- Dashboard might have stale data — needs verification
- Auth system is weak — highest priority for Phase 3 security

---
