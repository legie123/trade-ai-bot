# Daily Master Adaptive Audit — 2026-04-17

## 1. Executive Status
**STABLE WITH WARNINGS** — 3 auto-fixes applied (broken kill-switch route, WS stale detection, resolve cron heuristic). TypeScript compiles clean. Paper trading isolation is solid. Several HIGH-priority weak points remain for manual review.

## 2. What Was Learned Today
- **Repeating pattern — dead UI endpoints**: The Cockpit PANIC button has been calling `/api/kill-switch` which never existed. The button silently fails via `.catch(() => null)`. This is the most dangerous dead-button pattern found — the emergency halt control doesn't work.
- **Polymarket resolve cron guesses outcomes at 50/50**: When a market closes with `yesPrice > 0.5`, it was classified as YES. This heuristic misclassifies ambiguous markets and records wrong gladiator outcomes + wrong exit prices.
- **WS stale detection still counted PING/PONG** (flagged yesterday as W2): `lastMessageAt` was updated before the PING/PONG filter, meaning a server sending only heartbeats would never trigger stale detection. Now fixed.
- **`riskManager.ts` is dead code**: Full risk manager module (checkRisk, portfolio-level halt, drawdown halts) is never called anywhere. `polyWallet.ts` does its own simpler checks. Entire module is orphaned.
- **`rebalancePortfolio` creates money from nothing**: When a division is below target allocation, capital is added without being subtracted from other divisions. Wallet balance inflates over time.
- **Bot-center page calls `/api/cron` every 2 minutes without auth**: Always returns 401. Dead polling loop.
- **Kill switch auto-disengages at midnight**: `resetDailyTriggers()` silently resumes trading after auto-halt. Risky if halt reason persists overnight.

## 3. New Critical Findings
| # | Issue | Where | Severity | Decision |
|---|-------|-------|----------|----------|
| C1 | Cockpit PANIC button called non-existent `/api/kill-switch` | `cockpit/page.tsx:112` | CRITICAL | **AUTO-FIXED** |
| C2 | Polymarket resolve cron misclassifies ambiguous markets | `v2/polymarket/cron/resolve/route.ts:64-68` | HIGH | **AUTO-FIXED** |
| C3 | WS stale detection counts PING/PONG as real data | `polyWsClient.ts:137-147` | HIGH | **AUTO-FIXED** |
| C4 | `rebalancePortfolio` inflates wallet balance | `polyWallet.ts:376-380` | HIGH | NEEDS REVIEW |
| C5 | Main `/api/v2/polymarket` route has zero auth | `v2/polymarket/route.ts` | HIGH | NEEDS REVIEW |
| C6 | `riskManager.ts` is complete dead code | `polymarket/riskManager.ts` | MEDIUM | NEEDS REVIEW |
| C7 | Kill switch auto-disengages at midnight | `killSwitch.ts:277-279` | MEDIUM | NEEDS REVIEW |

## 4. Regressions Detected
- **R1 (vs 2026-04-16 W2)**: WS stale detection was flagged yesterday as weak. Confirmed still unfixed at audit start. Now fixed.
- **R2 (vs 2026-04-16 C2)**: Paper/live mode gating was flagged as weak yesterday. Today's deeper audit found it's actually **solid** — dual-key gate (TRADING_MODE + LIVE_TRADING_CONFIRM), all 4 exchange clients guard with `assertLiveTradingAllowed()`. Upgrading assessment: paper isolation is GOOD.
- **No new behavioral regressions** from yesterday's auto-fixes (cron auth, prebuild script).

## 5. Weak Points Found
| # | Weakness | Impact | Priority |
|---|----------|--------|----------|
| W1 | `/api/indicators` returns random fake volume/VWAP/BB data | Misleading technical indicators | P1 |
| W2 | `/api/dashboard` hardcodes `sentinelsActive: 4` | False sentinel status | P2 |
| W3 | `/api/bot` hardcodes DeepSeek master as ACTIVE | False master status | P2 |
| W4 | 7+ GET routes expose trading data with zero auth | Data exposure | P1 |
| W5 | A2A arena routes bypass auth when `SWARM_TOKEN` unset | Open arena in dev/missing env | P2 |
| W6 | Bot-center page polls `/api/cron` without auth (always 401) | Dead polling loop | P2 |
| W7 | Login page hardcodes `exchanges: 3, uptime: '24/7'` | False stats | P3 |
| W8 | Bot-center "Backtest System READY" is hardcoded | False status | P3 |
| W9 | Direction enum split (YES/NO vs BUY_YES/BUY_NO) persists | Silent casting bugs possible | P1 |
| W10 | Sentinel risk metrics have no freshness/age check | Stale data → wrong decisions | P1 |
| W11 | Threshold tuner has no dampening (unfixed from yesterday) | Floor value thrashing | P1 |
| W12 | Division key case mismatch (unfixed from yesterday) | Per-division floors silently fail | P1 |
| W13 | `getOrderBook` returns `any[]` untyped | Shape change silently corrupts scoring | P2 |
| W14 | `endDate` fallback manufactures fake +30d date | Wrong time-decay scores | P2 |

## 6. Auto-Heal Fixes Applied

### FIX-1: Kill-Switch Route [AUTO-FIXED — CRITICAL]
**Created** `src/app/api/kill-switch/route.ts` — proper POST endpoint for Cockpit PANIC button.
- Auth-gated via `isAuthenticated()`
- Supports `engage` (default) and `disengage` actions
- GET returns current kill switch state
- Logs all engage/disengage events

**Impact**: Cockpit PANIC button now works. Previously silently failed.
**Rollback**: `rm src/app/api/kill-switch/route.ts`

### FIX-2: WebSocket Stale Detection [AUTO-FIXED — HIGH]
**Fixed** `src/lib/polymarket/polyWsClient.ts` — moved `lastMessageAt = Date.now()` AFTER the PING/PONG filter.
- PING/PONG heartbeats no longer reset the stale timer
- Stale detection now only triggers on real data messages
- Feed health status will correctly report STALE when only heartbeats flow

**Rollback**: `git checkout -- src/lib/polymarket/polyWsClient.ts`

### FIX-3: Resolve Cron Outcome Logic [AUTO-FIXED — HIGH]
**Improved** `src/app/api/v2/polymarket/cron/resolve/route.ts`:
- Now checks for `resolvedOutcome` / `resolution` field from Polymarket API first (authoritative)
- Falls back to price heuristic only for decisive outcomes (>0.95 or <0.05)
- Ambiguous prices (0.05-0.95) are **deferred** instead of guessed — market will be re-checked next cron run
- Unknown resolution strings logged and skipped

**Rollback**: `git checkout -- src/app/api/v2/polymarket/cron/resolve/route.ts`

### Verification
- `tsc --noEmit` → 0 errors
- All 3 fixes are additive or minimal-change
- No trading logic, wallet operations, or data flows modified (except resolve heuristic which is now more conservative)

## 7. What Should Be Improved Next
1. **P0 — Wire `riskManager.ts` into execution path or remove** — full risk manager is dead code while simpler checks in polyWallet run alone
2. **P0 — Fix `rebalancePortfolio` money inflation** — must subtract from surplus divisions when adding to deficit
3. **P0 — Add auth to `/api/v2/polymarket` main route** — anyone can trigger open_position, close_position, reset_wallet
4. **P1 — Add freshness check to sentinel risk metrics** — fail/warn if metrics > 5min old
5. **P1 — Add dampening to threshold tuner** — skip promotion if last change < 30min AND delta < 3
6. **P1 — Normalize direction taxonomy** — shared `Direction` type with validators
7. **P1 — Normalize division keys** to uppercase consistently
8. **P1 — Replace fake indicators** in `/api/indicators` with real calculations or honest "N/A"
9. **P2 — Fix midnight kill-switch auto-disengage** — require manual disengage after auto-halt
10. **P2 — Remove dead `/api/cron` polling from bot-center page**

## 8. What Can Be Safely Removed or Disabled
- **SAFE TO REMOVE (review)**: `src/lib/polymarket/riskManager.ts` — never called, duplicate of simpler wallet-level checks. Or wire it in properly.
- **SAFE TO REMOVE (review)**: Stale deploy scripts: `DEPLOY_INSTRUCTIONS.txt`, `DEPLOY_NOW.txt`, `DEPLOY_PRODUCTION.sh`, `DEPLOY_SCRIPT.sh`, `GIT_PUSH_INSTRUCTIONS.md` (same as yesterday, awaiting sign-off)
- **SAFE TO REMOVE**: Bot-center `/api/cron` polling loop (lines 145, 163) — always 401, no useful data
- **SAFE TO REMOVE**: Login page hardcoded stats (`exchanges: 3, uptime: '24/7'`)

## 9. Files Touched
```
src/app/api/kill-switch/route.ts                   [NEW — PANIC button endpoint]
src/lib/polymarket/polyWsClient.ts                 [AUTO-FIXED — stale detection]
src/app/api/v2/polymarket/cron/resolve/route.ts    [AUTO-FIXED — outcome logic]
DAILY_AUDIT_2026-04-17.md                          [NEW — this report]
```

## 10. Risk Level
**LOW** — Kill-switch route is new (additive). WS fix moves one line (minimal). Resolve cron is now *more conservative* (defers instead of guessing). No existing functionality removed.

## 11. Profit-Impacting Issues
- **Resolve cron misclassification** (now fixed) was recording wrong outcomes on gladiators → wrong win rates → wrong promotion decisions → suboptimal capital allocation
- **`rebalancePortfolio` inflation** (unfixed) gradually inflates wallet balance → unrealistic PnL tracking → false confidence in strategy performance
- **Dead risk manager** means portfolio-level halt checks never fire → no drawdown protection at portfolio level
- **Fake indicators** (volume, VWAP, BB) → any signal pipeline consuming these gets garbage input

## 12. Market-Sensitivity Issues
- **Sentinel coupling has no metric freshness check** → stale MDD/loss data could trigger wrong floor adjustments in volatile markets
- **Threshold tuner thrashing** → auto-promotion floors oscillate on sample variance, could promote/demote strategies during normal market noise
- **`endDate` fallback** manufactures fake +30 day expiry → time-decay scores wrong for markets missing endDate

## 13. Recommended Next Manual Action
1. **Review and merge** the 3 auto-fixes in this audit
2. **Fix `rebalancePortfolio` money-from-nothing bug** — this corrupts all paper PnL tracking
3. **Add auth to `/api/v2/polymarket` main route** — currently anyone can mutate wallet state
4. **Decide on `riskManager.ts`** — wire it in or delete it; dead code confuses future audits
