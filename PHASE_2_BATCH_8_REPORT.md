# PHASE 2 — BATCH 8 REPORT
Date: 2026-04-16
Scope: Inline backtest panel on dashboard + rolling 7d snapshot persistence + capture/list endpoint
Mode: additive-only. 3 new files + 1 file edited. Zero deletion.

## TARGET (from Batch 7 NEXT)
1. Dashboard panel: render backtest summary inline (hit rate, byDivision, top rows).
2. Persist backtest snapshots (rolling 7d) to Supabase for trend analysis.
3. Provide capture endpoint (cron-friendly).

## FILES

### NEW (3)
- `src/components/PaperBacktestPanel.tsx`
  - Self-contained client component. Fetches `/api/v2/polymarket/paper-backtest` on mount + on user action.
  - Controls: `edge≥`, `$/sig` inputs, `run` button, `FreshnessBadge` on last fetch.
  - Renders: 7 KPI tiles (evaluated / hit rate / total / avg / best / worst / W-L), colored per-division chips (ranked by P&L), top-10 rows table sorted by P&L.
  - Empty state shows required env flag hint.

- `src/lib/polymarket/backtestSnapshots.ts`
  - `captureSnapshot(opts)` — runs `runPaperBacktest`, skips empty runs, pushes to in-memory ring (168 entries ≈ 7d @ 1/hr), best-effort Supabase persist to `poly_backtest_snapshots`.
  - `recentSnapshots(limit)` + `snapshotStats()` for observability.
  - All failures absorbed; never throws.

- `src/app/api/v2/polymarket/backtest-snapshots/route.ts`
  - `GET` — returns `{stats, snapshots}` (up to 168).
  - `POST` — captures now with tunable `minEdge` / `notional` / `limit` query params. Cron-invokable.

### EDITED (1)
- `src/app/dashboard/page.tsx`
  - +1 import (`PaperBacktestPanel`).
  - +1 panel instance placed before Intelligence Panel at page bottom.

## RISK
- Zero breaking change.
- TSC clean on `src/`.
- Panel client-only; fetches via existing endpoint. Fails silently with user-visible `error: …` line — no toast/crash.
- Snapshot ring bounded at 168; Supabase insert wrapped in `try {}` (silent no-op if table missing).
- No effect on scanner, ranker, syndicate, or realtime hook.

## ADDITIVE BENEFIT
- **Operator loop closed:** paper ranker decisions → backtest → live P&L at a glance, directly on the ops dashboard. No CLI, no separate tool.
- **Per-division profit chips** let operator see which categories are net-positive → capital allocation decision support.
- **7d trend persistence:** hit rate and P&L can be charted over time as signal quality drifts with market regime changes.
- **Cron-ready capture endpoint:** one `POST /api/v2/polymarket/backtest-snapshots` per hour fills the trend series automatically.

## PROFIT IMPACT
- Threshold tuning moves from guesswork to measurement: operator can A/B `edge≥` in-place and see resulting P&L immediately.
- Rolling snapshots reveal regime decay (hit rate falling while edge floor unchanged ⇒ market structure shifted ⇒ threshold bump required).
- Zero live capital risk during all of this — still paper.

## MARKET-SENSITIVITY IMPACT
- Backtest uses live quotes, snapshot preserves them — trend dataset captures real market-condition variance, not synthetic backfill.
- `minEdgeScore` filter parameter is logged per snapshot, so the series retains its experimental context.

## WHAT WAS PRESERVED
- All existing dashboard widgets and layout.
- Ring buffer contracts (`recentPaperSignals`, `recentSnapshots`) unchanged for other consumers.
- Backtest harness from Batch 7 unchanged — snapshots module is a pure consumer.

## WHAT WAS REPAIRED / EXTENDED
- New capability: end-to-end ranker-performance feedback loop visible on dashboard.
- New observability surface: `/api/v2/polymarket/backtest-snapshots` for external dashboards/scripts.

## VERIFIED IMPROVEMENTS
- TSC clean on `src/`.
- Panel renders empty-state hint correctly when feeder is off.
- Inputs are bounded (min/max) to prevent bad query params.

## OPTIONAL DB MIGRATION
```sql
CREATE TABLE IF NOT EXISTS poly_backtest_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL,
  evaluated INT NOT NULL,
  hit_rate NUMERIC,
  total_pnl_usd NUMERIC,
  avg_pnl_usd NUMERIC,
  wins INT,
  losses INT,
  min_edge_score INT,
  notional_per_signal NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_poly_backtest_snapshots_time
  ON poly_backtest_snapshots(captured_at DESC);
```

## CRON WIRING (suggested)
Add one entry to your existing cron config / Cloud Scheduler:
```
0 * * * *  POST  /api/v2/polymarket/backtest-snapshots?minEdge=50
```
Or layered A/B experiment:
```
15 * * * * POST /api/v2/polymarket/backtest-snapshots?minEdge=50
30 * * * * POST /api/v2/polymarket/backtest-snapshots?minEdge=65
45 * * * * POST /api/v2/polymarket/backtest-snapshots?minEdge=80
```

## REMAINING (proposed Batch 9)
- C2 prod URL check (still pending user gcloud verification).
- C11 console.log → createLogger sweep (low priority).
- Auto-threshold tuner: periodic multi-`minEdge` sweep, pick best P&L-per-signal, update ranker config.
- Trend chart component (sparkline) over `poly_backtest_snapshots` in dashboard.
- Gladiator ↔ paper-signal attribution: join `gladiatorId` decision → `marketId` signal for per-glad PnL.
