# LIVE READINESS — TRADE AI

**Created:** 2026-04-18 21:10 UTC
**Owner:** Andrei
**Status:** PAPER mode — LIVE blocked until FAZA 2 gates pass

---

## Context

Baseline observed WR on historical signals: **32–42%** (C14 root-cause analysis).
With fees 0.2% round-trip and asymmetric TP=1.0% / SL=-0.5%, break-even WR ≈ **43–45%**.
**Edge negative pre-R2.** Post-R2 (symbol+direction blacklist) and R4 (Forge 7d window + Butcher anti-memo) — edge **hypothesized positive, not yet validated**.

**Going LIVE before validation = expected negative PnL by arithmetic.** This document enforces a phased validation path.

---

## Kill-switch rules (applies always, PAPER and LIVE)

- Daily PnL ≤ **−2.0%** of starting balance → auto-disengage for 24h
- Consecutive losses ≥ **5** → disengage for 4h, human review required
- Any Butcher cycle executing ≥ **50%** of live gladiators in one run → freeze Forge spawn for 48h, investigate
- Slippage observed > **0.3%** on a single fill → flag symbol, exclude for 24h

---

## FAZA 0 — R2 live validation (T+0 → T+4h)

**Gates to pass:**
- `/api/dashboard` history[] populated with ≥20 new entries post-2026-04-18 21:03 UTC
- BTC BUY share in post-21:03 entries: **< 10%** (vs 71% baseline)
- No error logs referencing `R2 BLACKLIST` throwing exceptions
- scanLoop.scanCount increments monotonically every ~60s

**Action if gate fails:**
- Inspect managerVizionar.ts::applyToxicPairBlacklist — confirm env `R2_BLACKLIST_OFF` not set
- Check actual deploy SHA on Cloud Run matches 3c0f0c3 or later

**Target time:** 2026-04-19 01:10 UTC

---

## FAZA 1 — T+24h observation (T+4h → T+24h)

**Gates to pass (all):**
- Directional sample on 15m horizon: **n ≥ 50**
- 15m horizon WR **Wilson 95% lower bound ≥ 50%**
- 15m horizon PF **≥ 1.2** over rolling 24h window
- R4 Butcher nightly cycle ran without over-kill (executed gladiators ≤ 3)
- No crash/restart loops in watchdog

**Action if gate fails:**
- If n < 50 → insufficient data, extend to T+48h before decision
- If WR Wilson LB < 50% → edge not confirmed, remain PAPER, re-analyze signal layer
- If PF < 1.2 → winners too small OR losers too large; inspect TP/SL hit rate separately

---

## FAZA 2 — Gladiator certification (T+24h → T+48h)

**Per-gladiator LIVE eligibility (ALL required):**
- `stats.totalTrades ≥ 50`
- `stats.winRate ≥ 58%`
- `stats.profitFactor ≥ 1.3`
- Walk-forward validation: out-of-sample WR within 5pp of in-sample
- No anti-memo flag from Butcher R4b
- `rankReason` present and non-trivial

**Gate:** **At least 1 gladiator passes.** If 0 pass, Forge must run ≥3 more Darwinian cycles before re-eval.

---

## FAZA 3 — LIVE canary (T+48h → T+96h)

**Only executes if FAZA 0, 1, 2 all passed.**

**Canary config:**
- **Gladiators:** 1 (the top-ranked FAZA 2 passer)
- **Symbols:** 1 (lowest baseline risk — SOL or ETH, never BTC)
- **Position size:** **$25 max per trade** (2.5% of $1000 capital)
- **Max open positions:** 1
- **Max trades per 24h:** 10
- **Hard stop:** Daily PnL ≤ −2% → kill-switch + alert

**Duration:** 48h minimum.

**Pass gate:**
- Realized live WR ≥ **45%**
- Realized PF ≥ **1.1**
- Slippage vs backtest model within **0.15%**
- Zero execution errors (stuck orders, failed TP/SL triggers, wrong qty)

**Fail actions:**
- Revert to PAPER
- Investigate slippage model vs realized
- Patch before retry

---

## FAZA 4 — Gradual ramp (T+96h onward)

After each **48h clean-pass** window:
- +1 gladiator OR +1 symbol (not both same day)
- Position size +$25 per trade (up to $100 cap until cumulative WR ≥ 55% on 200+ trades)

**Immediate ramp halt triggers:**
- Any single day PnL ≤ −3%
- 2 consecutive days negative PnL
- Kill-switch engages 3+ times in 7d window

---

## LIVE switch mechanics (when authorized)

### Exact env vars for CANARY (FAZA 3)

Two-key activation — **both required**, else tradingMode.ts collapses to PAPER:

```
TRADING_MODE=LIVE
LIVE_TRADING_CONFIRM=YES_I_UNDERSTAND_RISK
```

Safety thresholds (override defaults):

```
KILL_SWITCH_DAILY_LOSS_PCT=2.0     # canary = 2% instead of default 5%
KILL_SWITCH_MAX_EXPOSURE_PCT=10    # canary = 10% (single $25 pos on $1k = 2.5%)
```

Canary scoping (enforced by managerVizionar/Sentinel — SOURCE VERIFY before relying):

```
LIVE_CAPITAL_CAP_USD=25             # max per-trade notional
LIVE_ALLOWED_SYMBOLS=SOLUSDT        # whitelist — never BTC in canary
LIVE_ALLOWED_GLADIATOR_IDS=<uuid>   # explicit opt-in, 1 gladiator
LIVE_MAX_OPEN_POSITIONS=1
LIVE_MAX_TRADES_PER_24H=10
```

**NOTE:** `LIVE_ALLOWED_*` env vars are intent documentation at time of drafting; verify enforcement in managerVizionar.ts before FAZA 3 activation — if not enforced in code, add enforcement BEFORE setting vars live.

### Observer (pre-LIVE dry-run)

Before FAZA 3 activation, enable the PAPER safety-gate observer to validate the threshold-detection chain on real equity data without engaging:

```
SAFETY_GATES_PAPER_SIMULATE=true
```

Grep Cloud Logging for `[SafetyGate:PAPER-SIM]`. Expected behavior over ≥24h:
- At least one "approaching" (70% of limit) or "WOULD-TRIGGER" log line if PAPER drawdown ≥3.5% in any UTC day
- Zero thrown exceptions
- Zero `engageKillSwitch` invocations (PAPER mode → real path dormant)

Default OFF. Remove this env var before LIVE flip (real gates take over).

### Test-fire endpoint (FAZA 2.5 gate — BLOCKER for FAZA 3)

Dry-run simulation validates the *math*. It does NOT validate engage→MEXC→Supabase. Before canary, a manual test-fire of the real engage path is required:

- `POST /api/admin/killswitch/test-fire` (NOT YET IMPLEMENTED — TODO before FAZA 3)
  - Invokes `engageKillSwitch('TEST_FIRE')` with `DRY_RUN_MEXC=true` flag
  - Verifies Supabase kill_switch_state row written
  - Verifies dashboard reflects engaged state
  - Verifies `disengageKillSwitch` cleanup path
  - Must pass before canary capital deployment

### Deployment mechanics

- Separate commit + manual Cloud Run env update, never bundled with code changes
- Canary env vars set via `gcloud run services update trade-ai --update-env-vars=...` (NOT `--set-env-vars` — destructive)
- **Rollback:** `TRADING_MODE=PAPER` + redeploy (target < 5 min)

---

## Sign-off

LIVE transition requires explicit text from Andrei citing:
1. Target FAZA (3 canary / 4 ramp level)
2. Exact capital cap
3. Exact symbol(s)
4. Exact gladiator ID(s)

**Claude will NOT switch to LIVE autonomously under any circumstance.**

---

## Change log

- 2026-04-18 21:10 UTC — initial draft post R2+C15+R4 deploy (commits 3c0f0c3, 88d11d4, fcf6759)
- 2026-04-19 — added PAPER dry-run observer (`SAFETY_GATES_PAPER_SIMULATE`), exact canary env vars, test-fire endpoint requirement (FAZA 2.5 gate)
