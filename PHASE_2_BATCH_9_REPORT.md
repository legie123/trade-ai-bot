# PHASE 2 — BATCH 9 REPORT
Date: 2026-04-16
Scope: Auto-threshold tuner (advisory) + sparkline trend panel + inline config recommendation
Mode: additive-only. 3 new files + 1 file edited. Zero deletion.

## TARGET (from Batch 8 NEXT)
1. Auto-threshold tuner: sweep `minEdge` across a band, pick best avg P&L subject to min sample.
2. Trend chart (sparkline) over `poly_backtest_snapshots`.
3. Dashboard surface: show current vs. recommended threshold so operator can promote manually.

## FILES

### NEW (3)
- `src/lib/polymarket/thresholdTuner.ts`
  - `tuneThreshold(opts)` — iterates edge band (default `[40,50,55,60,65,70,75,80]`), calls `runPaperBacktest` per point, picks recommendation by max `avgPnlUsd` with `evaluated ≥ minSample`.
  - Stores last `TuneResult` in-memory + best-effort Supabase `poly_ranker_config` insert.
  - **ADVISORY ONLY** — never mutates scanner's hard-coded `EDGE_THRESHOLD`. Operator promotes by setting `POLY_EDGE_THRESHOLD` env.
  - `lastTuneResult()` exposed for GET reads.

- `src/app/api/v2/polymarket/tune-threshold/route.ts`
  - `GET` — returns last cached tune result.
  - `POST ?band=...&notional=...&limit=...&minSample=...` — runs new sweep, returns `{points, recommended, currentFloor, note}`.

- `src/components/BacktestTrendPanel.tsx`
  - Self-contained client component. Dual-fetch snapshots + last tune on mount.
  - Two inline SVG sparklines (Total P&L + Hit Rate) — no external chart library.
  - Threshold sweep chips with the recommended edge highlighted green.
  - Inline recommendation line: `set POLY_EDGE_THRESHOLD=N`.
  - Action buttons: `refresh` (reload) + `run tune` (POST).

### EDITED (1)
- `src/app/dashboard/page.tsx`
  - +1 import (`BacktestTrendPanel`).
  - +1 panel mounted after `PaperBacktestPanel`, before `IntelligencePanel`.

## RISK
- Zero breaking change.
- TSC clean on `src/`.
- Tuner is **read-only** w.r.t. scanner; no live config mutation. Promotion is manual env flip.
- Sparklines are inline SVG — no new dependency.
- Empty-state handling on panel (no snapshots / no tune yet).

## ADDITIVE BENEFIT
- **Threshold choice becomes data-driven.** Operator sees per-edge avg P&L, hit rate, and sample count side-by-side. The recommendation chip flags the winner.
- **Regime detection via trend:** P&L sparkline falling while ranker floor unchanged = market structure shifted. Trigger a re-tune.
- **Read-only safety:** no risk of an auto-tuner clobbering scanner threshold mid-session. Operator stays in the loop.

## PROFIT IMPACT
- Removes the last "gut-feel" parameter from the ranker stack. `EDGE_THRESHOLD` = whatever empirically maximizes avg P&L with ≥5 samples.
- Periodic re-tune (cron-suggested hourly) means threshold tracks regime automatically; operator just promotes winning value.
- Visualized hit-rate trend warns before P&L dips become persistent.

## MARKET-SENSITIVITY IMPACT
- Sweep uses live quotes (via `paperBacktest` → `getMarket`), so tune reflects current conditions.
- `minSample` guard prevents noisy single-signal "best" points from being promoted as recommendations.

## WHAT WAS PRESERVED
- Scanner `EDGE_THRESHOLD=40` hard-coded value unchanged — tuner is advisory.
- `paperBacktest`, `backtestSnapshots`, `paperSignalFeeder` unchanged — tuner is a pure consumer.
- Dashboard layout above the new panels — unchanged.

## WHAT WAS REPAIRED / EXTENDED
- New capability: measurement-based threshold recommendation with safety gap (manual promotion).
- New capability: visual trend for operator triage (P&L + hit rate sparklines).

## VERIFIED IMPROVEMENTS
- TSC clean on `src/`.
- No dependency additions.
- Tuner defaults conservative: 8 edge points × 150 signals × live quote fetch. Bounded cost.
- `minSample=5` default prevents edge-case recommendations.

## OPTIONAL DB MIGRATION
```sql
CREATE TABLE IF NOT EXISTS poly_ranker_config (
  id BIGSERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  recommended_min_edge INT,
  recommended_avg_pnl NUMERIC,
  recommended_hit_rate NUMERIC,
  recommended_sample INT,
  current_floor INT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_poly_ranker_config_time
  ON poly_ranker_config(generated_at DESC);
```

## CRON WIRING (suggested)
```
0 *   * * *  POST /api/v2/polymarket/backtest-snapshots?minEdge=50
15 */6 * * * POST /api/v2/polymarket/tune-threshold
```

## OPERATOR PROMOTION PROCEDURE
1. Dashboard shows: `→ set POLY_EDGE_THRESHOLD=65 (best avg P&L, n=12, hit=58%)`.
2. Operator updates env on Cloud Run service (one command or UI).
3. Next scanner cycle picks up the new floor (if scanner code reads `process.env.POLY_EDGE_THRESHOLD` — currently it reads the constant; a follow-up micro-edit can wire that env in).

## REMAINING (proposed Batch 10)
- Wire scanner `EDGE_THRESHOLD` to read `process.env.POLY_EDGE_THRESHOLD` with fallback (1-line change, closes promotion loop).
- Gladiator ↔ paper-signal attribution: join decision log to `marketId` for per-glad PnL.
- Per-division tuner (separate threshold per PolyDivision).
- C2 prod URL check (still pending user gcloud verification).
- C11 console.log → createLogger sweep.
