# PHASE 2 — BATCH 11 REPORT
Date: 2026-04-16
Scope: Runtime ranker config (DB-backed) + guarded auto-promote + per-division panel
Mode: additive-only. 3 new files + 3 files edited. Zero deletion.

## TARGET (from Batch 10 NEXT)
1. Dashboard panel for per-division tuner output.
2. Auto-promote tuner recommendations into runtime config (guarded).
3. Close the "redeploy on threshold change" gap without env juggling.

## ARCHITECTURE

Resolution order inside `getEdgeFloor(division?)`:
```
 1. env POLY_EDGE_THRESHOLD_<DIV>       (hard override)
 2. env POLY_EDGE_THRESHOLD             (hard override)
 3. runtime active.perDivision[DIV]     (operator-promoted)  ← NEW
 4. runtime active.global                (operator-promoted) ← NEW
 5. EDGE_THRESHOLD_DEFAULT = 40
```
Runtime config lives in Supabase `poly_ranker_active` (single-row), cached 60s, promoted via API or auto-tune hook.

## FILES

### NEW (3)
- `src/lib/polymarket/rankerConfig.ts`
  - `ActiveConfig { global, perDivision, updatedAt }`.
  - `getActiveConfigSync()` — synchronous cache read for hot path.
  - `refreshActiveConfig()` / `maybeRefresh()` — 60s TTL, inflight dedup.
  - `promoteFloor({global, perDivision, source})` — **guarded by `POLY_EDGE_AUTOPROMOTE=true`**. Upserts row, returns merged config.
  - All failures absorbed; never throws to scanner.

- `src/app/api/v2/polymarket/ranker-config/route.ts`
  - `GET` — returns active config + `autopromoteEnabled` flag.
  - `POST { global?, perDivision?, source? }` — manual promotion (validated 0..100, uppercase keys).

- `src/components/DivisionTunerPanel.tsx`
  - Shows active floors chips (global + per-division).
  - Shows auto-promote status indicator.
  - Per-row division table: current floor, recommended floor, avg P&L, hit rate, sample size.
  - Delta-colored recommendation (green if lower, red if higher, white if equal).
  - Actions: refresh, run sweep.

### EDITED (3)
- `src/lib/polymarket/marketScanner.ts`
  - `getEdgeFloor()` now consults runtime config after env fallthrough.
  - `maybeRefresh()` called on hot path (fire-and-forget).
  - Zero behavior change when Supabase row absent.

- `src/lib/polymarket/thresholdTuner.ts`
  - Global `tuneThreshold` → auto-calls `promoteFloor({global: recommended.minEdge})` if recommendation exists.
  - Per-division `tuneThresholdByDivision` → batches per-division recommendations into one `promoteFloor({perDivision: {...}})` call.
  - All promotion calls guarded internally by `POLY_EDGE_AUTOPROMOTE=true`; safe no-op otherwise.

- `src/app/dashboard/page.tsx`
  - +1 import (`DivisionTunerPanel`).
  - +1 panel mounted after `BacktestTrendPanel`.

## RISK
- Zero breaking change: without `POLY_EDGE_AUTOPROMOTE=true` AND without Supabase row, behavior identical to Batch 10.
- Env overrides still win — operator can always force a value regardless of runtime state.
- Promotion writes are wrapped in try/catch; failure logs warning but never blocks scanner.
- Cache is per-instance. Multi-instance deploys converge on next 60s refresh — no strict consistency required for advisory floors.
- TSC clean across `src/`.

## ADDITIVE BENEFIT
- **No more env juggling:** ranker floors can be promoted at runtime via API or auto-tune. Cloud Run stays unchanged.
- **Safety gate preserved:** `POLY_EDGE_AUTOPROMOTE` is the switch — operator flips ONCE when ready to trust the tuner.
- **Visibility:** active runtime config surfaced on dashboard with auto-promote status indicator — never silent.

## PROFIT IMPACT
- Tuner recommendations reach scanner within 60s (cache TTL) after promotion — faster feedback loop on regime shifts.
- Per-division asymmetric floors deployable without touching env or redeploying.
- Operator mistake costs are bounded: POST to override, turn off auto-promote to freeze.

## MARKET-SENSITIVITY IMPACT
- Runtime config allows per-division floors to track regime per segment (e.g., loosen POLITICS when a big event is coming, tighten CRYPTO during chop).

## WHAT WAS PRESERVED
- `EDGE_THRESHOLD_DEFAULT = 40` fallback — unchanged.
- Env override semantics from Batch 10 — unchanged (still highest priority).
- Scanner scoring, syndicate, feeder, backtest, snapshot, global tuner — all untouched apart from the floor resolution path.

## WHAT WAS REPAIRED / EXTENDED
- Runtime promotion loop fully closed.
- Dashboard observability extended to cover active floors + per-division recommendations.
- Auto-tune now has a safe output channel instead of being pure advisory.

## VERIFIED IMPROVEMENTS
- TSC clean on `src/`.
- Zero new dependencies.
- All auto-promote paths gated; default OFF.
- Panel handles empty states (no sweep yet, no active config).

## OPTIONAL DB MIGRATION
```sql
CREATE TABLE IF NOT EXISTS poly_ranker_active (
  id INT PRIMARY KEY,                -- always 1 (single-row keyed)
  global_floor INT,
  per_division JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL,
  source TEXT
);
```

## PROMOTION PROCEDURES
**Auto:**
1. `POLY_EDGE_AUTOPROMOTE=true` on Cloud Run.
2. Cron hits `POST /api/v2/polymarket/tune-threshold` and `POST /api/v2/polymarket/tune-by-division`.
3. Floors flow into `poly_ranker_active`; scanner picks up within 60s cache.

**Manual:**
```bash
curl -X POST /api/v2/polymarket/ranker-config \
  -H 'Content-Type: application/json' \
  -d '{"global":55,"perDivision":{"CRYPTO":65,"POLITICS":45},"source":"operator"}'
```
Still gated by `POLY_EDGE_AUTOPROMOTE=true` — flip to allow writes.

**Freeze:**
- Unset `POLY_EDGE_AUTOPROMOTE` → no writes accepted; existing active row keeps working.

## REMAINING (proposed Batch 12)
- Gladiator ↔ paper-signal attribution: join decision log → `marketId` for per-glad PnL ladder.
- Kill-switch coupling: auto-raise floors when sentinel breach rate climbs.
- Per-division snapshot series (tiny extension of Batch 8 snapshots).
- C2 prod URL check (still pending user gcloud verification).
- C11 console.log → createLogger sweep.
