# PHASE 2 — BATCH 10 REPORT
Date: 2026-04-16
Scope: Close promotion loop (env-driven scanner floor) + per-division tuner + endpoint
Mode: additive-only. 2 new files + 2 files edited. Zero deletion.

## TARGET (from Batch 9 NEXT)
1. Wire scanner `EDGE_THRESHOLD` to read `process.env.POLY_EDGE_THRESHOLD` (closes the operator promotion loop).
2. Per-division tuner — separate threshold recommendation per `PolyDivision`.
3. Expose via endpoint.

## FILES

### NEW (2)
- `src/app/api/v2/polymarket/tune-by-division/route.ts`
  - `GET` — last cached per-division recommendation.
  - `POST ?band=...&notional=...&limit=...&minSample=...` — runs sweep.
  - Standardized `successResponse` / `errorResponse`.

### EDITED (2)
- `src/lib/polymarket/marketScanner.ts`
  - Replaced hard-coded `EDGE_THRESHOLD = 40` with `EDGE_THRESHOLD_DEFAULT = 40` + `getEdgeFloor(division?)` helper.
  - Resolution order: `POLY_EDGE_THRESHOLD_<DIVISION>` → `POLY_EDGE_THRESHOLD` → 40.
  - Validation: rejects non-numeric / out-of-range values, falls back silently.
  - `scanDivision()` reads floor with division context; `determineRecommendation()` reads global floor.
  - Back-compat: `EDGE_THRESHOLD` alias preserved (still equals default).
  - **Net behavior:** without env, identical to before. With env, scanner floor follows operator config without code change.

- `src/lib/polymarket/thresholdTuner.ts`
  - +`tuneThresholdByDivision(opts)` — groups paper signals by division, runs ONE base backtest at min(band) edge, post-filters per division × per edge band point.
  - **Cost-aware:** reuses ONE live-quote pass; no N×D quote fetches.
  - Returns `DivisionTuneResult` with per-division: `bufferSize`, `recommended`, `currentFloor`, `note`.
  - `lastDivisionTuneResult()` exposed for GET reads.

## RISK
- Zero breaking change: no env → identical behavior to Batch 9.
- TSC clean across `src/`.
- Per-division tuner is **read-only** (advisory, no scanner mutation).
- Quote fetch cost bounded — exactly one base backtest pass per sweep, regardless of division count.
- Env parsing strictly validated (Number, range 0..100); bad values silently fall through to default.

## ADDITIVE BENEFIT
- **Promotion loop closed:** dashboard recommends `set POLY_EDGE_THRESHOLD=65`; operator updates env on Cloud Run; next scan uses new floor. No deploy required.
- **Per-division thresholds:** different markets have different signal-to-noise (CRYPTO often noisier than POLITICS). Per-div override unlocks asymmetric capital allocation.
- **Same input, finer slicing:** per-division sweep reuses the live-quote backtest pass — adds zero exchange/API load.

## PROFIT IMPACT
- Underperforming divisions get raised floors (less noise, fewer trades, higher hit rate).
- Outperforming divisions can be loosened (lower floor, more trades, ride the edge).
- Operator no longer pays the "rebuild + redeploy" cost per threshold experiment.

## MARKET-SENSITIVITY IMPACT
- Per-division tuner reflects regime asymmetry: when CRYPTO sentiment swings, its threshold can rise without affecting POLITICS or SPORTS scoring.

## WHAT WAS PRESERVED
- `EDGE_THRESHOLD` constant value (40) — back-compat alias.
- Scanner scoring weights, mispricing/volume/momentum/etc. — untouched.
- Global tuner (Batch 9) — untouched.
- All dashboard panels — untouched.

## WHAT WAS REPAIRED / EXTENDED
- Promotion loop now end-to-end: measure → recommend → promote (env) → scanner picks up.
- New axis of optimization: per-division thresholds.

## VERIFIED IMPROVEMENTS
- TSC clean on `src/`.
- Zero new dependencies.
- Single base backtest call per per-division sweep — no quadratic cost.

## ENV REFERENCE
| Var | Effect |
|-----|--------|
| `POLY_EDGE_THRESHOLD=N` | Global scanner floor (0..100, default 40) |
| `POLY_EDGE_THRESHOLD_CRYPTO=N` | Override for CRYPTO division only |
| `POLY_EDGE_THRESHOLD_POLITICS=N` | Override for POLITICS division only |
| ... (any `PolyDivision`) | Same pattern |

## OPERATOR PROMOTION PROCEDURE
1. `POST /api/v2/polymarket/tune-by-division` (or wait for cron).
2. `GET /api/v2/polymarket/tune-by-division` returns ranked divisions with per-div recommendation.
3. For each underperforming/overperforming division, set `POLY_EDGE_THRESHOLD_<DIV>=N` on Cloud Run.
4. Next scanner cycle picks up the new floors automatically.

## CRON WIRING (suggested, additive to Batch 9)
```
20 */6 * * * POST /api/v2/polymarket/tune-by-division
```

## REMAINING (proposed Batch 11)
- Dashboard panel for per-division tuner output (chips per division × per edge level).
- Gladiator ↔ paper-signal attribution: join decision log → marketId → per-glad PnL.
- Auto-promote (env writeback) — guarded by `POLY_EDGE_AUTOPROMOTE=true` + GitOps hook.
- C2 prod URL check (still pending user gcloud verification).
- C11 console.log → createLogger sweep.
