# PHASE 2 — BATCH 12 REPORT
Date: 2026-04-16
Scope: Sentinel → ranker floor coupling (safety feedback) + per-division snapshot series
Mode: additive-only. 3 new files + 1 file edited. Zero deletion.

## TARGET (from Batch 11 NEXT)
1. Kill-switch coupling: auto-raise floors when sentinel stress climbs.
2. Per-division snapshot series.

## FILES

### NEW (3)
- `src/lib/polymarket/sentinelCoupling.ts`
  - `evaluateSentinelCoupling()` — reads `SentinelGuard.getRiskMetrics()`, classifies into `BASE / WARN / STRESS / HALT`, promotes matching floor.
  - Floor ladder: BASE=50, WARN=60, STRESS=70, HALT=85.
  - Classification thresholds:
    - `isHalted` → HALT
    - `mdd ≥ 7% OR dailyLosses ≥ 2` → STRESS
    - `mdd ≥ 5% OR dailyLosses ≥ 1` → WARN
    - else → BASE
  - **Tag tracking:** only reverts floors it previously raised (`state.ownFloorActive`). Operator manual promotions are respected.
  - Double-gated: `POLY_SENTINEL_COUPLING=true` + `POLY_EDGE_AUTOPROMOTE=true`.
  - Report-only mode when either gate missing — still returns classification.

- `src/app/api/v2/polymarket/sentinel-coupling/route.ts`
  - `GET` / `POST` — both evaluate coupling now. Returns `{report, lastState}`.
  - Intended for 1–5 min cron cadence.

- `src/app/api/v2/polymarket/snapshots-by-division/route.ts`
  - `GET ?limit=N` — division ring buffer (default 500, max 2000).
  - `POST ?minEdge=...&notional=...&limit=...` — capture new snapshot row per division.

### EDITED (1)
- `src/lib/polymarket/backtestSnapshots.ts`
  - +`captureDivisionSnapshot(opts)` — runs backtest, emits one row per division with `{capturedAt, division, n, pnlUsd, minEdgeScore}`.
  - +`recentDivisionSnapshots(limit)` — reader.
  - Second ring buffer (`DIV_RING_MAX = 168 × 16 = 2688`) to accommodate 7d × 16 divisions.
  - Best-effort Supabase persist to `poly_backtest_snapshots_division` (silent no-op if table missing).
  - Existing `captureSnapshot` / `recentSnapshots` untouched.

## RISK
- Zero breaking change: default all gates OFF → zero behavior change.
- Sentinel coupling is strictly safety-oriented (raises floors, reduces trade surface). Never lowers below BASE=50.
- Tag tracking prevents stepping on manual operator promotions.
- Sentinel metric fetch wrapped in try/catch — never throws.
- Division snapshot is additive to Batch 8's global series; both rings coexist.
- TSC clean across `src/`.

## ADDITIVE BENEFIT
- **Automatic defensive posture:** when the kill-switch gets close, ranker also tightens — fewer new entries added on top of the stress state.
- **Self-healing:** once sentinel metrics cool, coupling reverts to BASE automatically (but only if it raised the floor itself).
- **Division-level P&L decay visible over time:** operator can see a specific division's PnL series trend downward before the global aggregate reveals it.

## PROFIT IMPACT
- Prevents the compounding failure mode: low ranker floor + rising loss streak → more bad entries added on top.
- Division snapshot series is the data foundation for future per-division auto-tuning cadence (e.g., tighter CRYPTO floor if its PnL series trends negative for 24h).

## MARKET-SENSITIVITY IMPACT
- Coupling reacts to realized P&L (mdd, losses) — so it's a lagged-but-true regime signal, orthogonal to the sentiment-bias signal (Batch 6).
- Per-division snapshots capture regime asymmetry over time (which divisions carry edge, which bleed).

## WHAT WAS PRESERVED
- `SentinelGuard` — untouched (pure reader of `getRiskMetrics`).
- Scanner, tuner, feeder, backtest, global snapshots — untouched.
- Operator manual promotion path — unchanged; sentinel coupling defers to non-owned floors.

## WHAT WAS REPAIRED / EXTENDED
- New feedback arm: realized-risk → ranker floor, complementing the forward-looking sentiment bias.
- Per-division observability extended from tuner chips (Batch 10/11) to time series (Batch 12).

## VERIFIED IMPROVEMENTS
- TSC clean on `src/`.
- Zero new dependencies.
- Double-gate on auto-action; coupling is always *observable* even when not acting.

## OPTIONAL DB MIGRATION
```sql
CREATE TABLE IF NOT EXISTS poly_backtest_snapshots_division (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL,
  division TEXT NOT NULL,
  n INT NOT NULL,
  pnl_usd NUMERIC,
  min_edge_score INT
);
CREATE INDEX IF NOT EXISTS idx_poly_snap_div_time_div
  ON poly_backtest_snapshots_division(captured_at DESC, division);
```

## ENV REFERENCE (new)
| Var | Effect |
|-----|--------|
| `POLY_SENTINEL_COUPLING=true` | Enables auto floor adjustments from sentinel state |
| (still needs) `POLY_EDGE_AUTOPROMOTE=true` | Required for any runtime floor writes |

## CRON WIRING (suggested, additive)
```
*/5 * * * *   POST /api/v2/polymarket/sentinel-coupling
10 * * * *    POST /api/v2/polymarket/snapshots-by-division?minEdge=50
```

## DECISION TABLE SUMMARY
| Sentinel state | Target floor | Revert behavior |
|----------------|--------------|-----------------|
| HALTED | 85 | Revert to 50 when halt clears (own-flag only) |
| STRESS (mdd≥7% or losses≥2) | 70 | Revert when metrics cool |
| WARN (mdd≥5% or losses≥1) | 60 | Revert when metrics cool |
| BASE (clear) | 50 | Only touch if we own current floor |

## REMAINING (proposed Batch 13)
- Dashboard panel: sentinel coupling live status + per-division snapshot sparkline grid.
- Gladiator ↔ paper-signal attribution (decision log join).
- Per-division auto-tune cadence driven by division snapshot trend.
- C2 prod URL check (still pending user gcloud verification).
- C11 console.log → createLogger sweep.
