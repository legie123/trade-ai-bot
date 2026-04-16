# PHASE 2 — BATCH 7 REPORT
Date: 2026-04-16
Scope: C12 continuation (per-card FreshnessBadge x4 remaining) + Paper Backtest Harness + observability endpoint
Mode: additive-only. 2 new files + 1 file edited. Zero deletion.

## TARGET (from Batch 6 NEXT)
1. Per-card `FreshnessBadge` for the remaining 4 widgets (Last Syndicate Decision, API Credit Reserves, Open Positions, Equity Deep Dive).
2. Backtest harness: read `poly_paper_signals` ring buffer + live Polymarket quotes → P&L summary.

## FILES

### NEW (2)
- `src/lib/polymarket/paperBacktest.ts`
  - `runPaperBacktest(opts)` — reads `recentPaperSignals()` (Batch 6 ring buffer), fetches live market quotes via `getMarket()`, computes P&L per signal.
  - Conservative model: fixed notional per signal ($100 default), round-trip fee 0.6% (configurable), mark-to-market against live yes/no price.
  - Returns `BacktestSummary` with totals (hit rate, total P&L, avg/best/worst), `byDivision` aggregation, and per-row detail.
  - Pure read-only. No exchange calls, no writes. Bounded concurrency via `Promise.allSettled`.

- `src/app/api/v2/polymarket/paper-backtest/route.ts`
  - GET endpoint wrapping `runPaperBacktest`.
  - Params: `limit` (1..200, default 50), `notional` (default 100), `fee` (0..0.1, default 0.006), `minEdge` (0..100, default 50).
  - Standardized `successResponse` / `errorResponse`.

### EDITED (1)
- `src/app/dashboard/page.tsx`
  - +4 `FreshnessBadge` instances (additive wrapping inside existing flex headers where needed):
    1. **Last Syndicate Decision** → `last.timestamp` (5 min / 15 min thresholds — syndicate runs infrequently)
    2. **API Credit Reserves** → `lastDiag` (120s / 300s)
    3. **Open Positions** → `lastDiag` (120s / 300s)
    4. **Equity Deep Dive** → `lastDiag` (120s / 300s)
  - All previous FreshnessBadge instances (Batch 5 header + Batch 6 x5) preserved.

## RISK
- Zero breaking change.
- TSC clean across `src/` (pre-existing `.next/` cache errors unrelated).
- Backtest endpoint is read-only — no exchange writes, no Supabase writes.
- `getMarket()` failures land as `quote-unavailable` note on the row; never throws through.
- Dashboard edits are pure additions inside flex wrappers; no layout shift on existing badges.

## ADDITIVE BENEFIT
- **C12 COMPLETE** across all 9 primary dashboard widgets (1 header + 8 panels). Stale-signal triage is now fully local — operator sees which subsystem went red independently.
- **Backtest harness:** takes the ranker's paper decisions and answers "if I had sized $100 per signal, what would my P&L be right now?" — live, on demand, no DB join required.
- **Endpoint tunables:** notional/fee/minEdge query params let operator A/B the ranker threshold in real time (e.g. `?minEdge=70` to see if raising the edge floor improves hit rate).

## PROFIT IMPACT
- Closes the feedback loop: paper signal → mark-to-market → ranker threshold tuning, all without touching live capital.
- `byDivision` aggregation reveals which prediction categories (CRYPTO vs. POLITICS vs. SPORTS) generate positive edge → capital allocation guidance.
- Stale-signal detection at panel granularity prevents stale-data trades (e.g. positions data 5 min old while live feed is fresh).

## MARKET-SENSITIVITY IMPACT
- Backtest operates on live quotes at evaluation time — so results reflect current market conditions, not historical snapshots.
- Fee parameter lets operator model realistic execution cost bands (0.2%–2%) to stress-test ranker viability.

## WHAT WAS PRESERVED
- All existing widget content, grid layouts, secondary badges.
- Batch 5 `feed` badge + Batch 6 5 badges — untouched.
- Ring buffer API (`recentPaperSignals`, `paperFeederStatus`) unchanged — backtest is a pure consumer.

## WHAT WAS REPAIRED / EXTENDED
- **C12 fully closed** (9/9 primary widgets).
- New capability: ranker → paper signal → backtest P&L pipeline, end-to-end observable.

## VERIFIED IMPROVEMENTS
- TSC clean on `src/` (no new errors introduced).
- Default notional/fee conservative (100 / 0.6%) — institutional-realistic.
- `Promise.allSettled` on quote fetch — one failed market never blocks the summary.

## EXAMPLE USAGE
```bash
# 1. Seed: deploy with POLY_PAPER_FEEDER=true (TRADING_MODE=PAPER)
# 2. Let scanner run a few cycles to populate ring buffer
curl "$BASE/api/v2/polymarket/paper-signals?limit=100"

# 3. Run backtest with current defaults
curl "$BASE/api/v2/polymarket/paper-backtest"

# 4. Stricter edge threshold
curl "$BASE/api/v2/polymarket/paper-backtest?minEdge=70&notional=250"
```

## REMAINING (proposed Batch 8)
- C2 prod URL check (still pending user gcloud verification).
- C11 console.log → createLogger sweep (low priority).
- Dashboard panel: render backtest summary inline (hit rate, byDivision) — surfaces P&L at a glance.
- Persist backtest snapshots (rolling 7d) to Supabase for trend analysis.
- Gladiator-level PnL attribution (correlate paper signal `marketId` → `gladiatorId` decision log).
- Ranker threshold autotune: periodically run backtest across `minEdge ∈ [40..80]`, select best P&L-per-signal for next cycle.
