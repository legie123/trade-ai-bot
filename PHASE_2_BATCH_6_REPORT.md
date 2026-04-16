# PHASE 2 — BATCH 6 REPORT
Date: 2026-04-15
Scope: Sentiment-biased Syndicate (verify) + per-card FreshnessBadge x5 + opt-in Paper Signal Feeder + observability endpoint
Mode: additive-only. 2 new files + 3 files edited. Zero deletion.

## TARGET (from Batch 5 NEXT)
1. Wire `/api/v2/intelligence/sentiment` results into Polymarket Syndicate so each market's scored sentiment biases the aggregator.
2. Add per-card `FreshnessBadge` to top dashboard widgets (5 cards).
3. Optional opt-in ranker-driven paper-trade signal feeder (paper only, gated by TRADING_MODE).

## FILES

### NEW (2)
- `src/lib/polymarket/paperSignalFeeder.ts`
  - In-memory ring buffer (200 entries) of `PaperSignal` records.
  - `feedOpportunities(opps)` — gated by `TRADING_MODE !== 'LIVE'` AND `POLY_PAPER_FEEDER === 'true'`.
  - Filters: drops `SKIP` and `edgeScore < 50`.
  - Best-effort persist into `poly_paper_signals` Supabase table (silent no-op if table missing).
  - `recentPaperSignals(limit)` + `paperFeederStatus()` exported for observability.
  - Pure side-effect: never throws, never blocks scanner.

- `src/app/api/v2/polymarket/paper-signals/route.ts`
  - GET endpoint returning `{ feeder, count, signals }`.
  - `?limit=N` query param (1..200, default 50).
  - Uses standardized `successResponse` / `errorResponse`.

### EDITED (3)
- `src/lib/polymarket/marketScanner.ts`
  - +1 import (`feedOpportunities`).
  - After `opportunities.sort(...)`: `try { feedOpportunities(opportunities); } catch {}`.
  - Pure additive side-effect; scanner return shape untouched.

- `src/lib/polymarket/polySyndicate.ts`
  - **VERIFIED already wired in this branch** (Phase 2 Batch 6 sentiment-bias block, lines 84–117).
  - Bias bounded ±15 on confidence, never flips direction.
  - Symbol-match preferred (n≥2), fallback to overall snapshot (n≥5 & |score|>0.2 → ±5).
  - `SYNDICATE_SENTIMENT_BIAS` env (default `true`); on failure logs warn and skips.

- `src/app/dashboard/page.tsx`
  - +1 state: `lastLight: Date | null` set inside `fetchLight()` on success.
  - +5 per-card `FreshnessBadge` instances (additive `<div>` wrapper around existing right-side header content where needed):
    1. Exchange Connectivity → `lastLight` (default 30s/120s thresholds)
    2. AI Providers & Database → `lastDiag` (120s / 300s — matches 90s diag interval)
    3. Trading Operations → `lastUpdate` (realtime stream)
    4. System Resources → `lastDiag` (120s / 300s)
    5. Deep System Health → `lastDiag` (120s / 300s)
  - Existing header `feed` badge (Batch 5) preserved.

## RISK
- Zero breaking change.
- TSC clean across `src/` (pre-existing `.next/` cache errors unrelated to this batch).
- Paper feeder is double-gated (mode + opt-in env). Default OFF.
- Supabase insert wrapped in `try {}` — missing table is a silent no-op.
- Scanner side-effect bounded by `try/catch`; cannot affect `scanDivision` return.
- Dashboard edits are pure additions inside flex containers; no layout shift on existing widgets.

## ADDITIVE BENEFIT
- **Per-card freshness:** operator can see which subsystem went stale (e.g. diag green, ops red ⇒ realtime SSE problem; not a global outage).
- **Paper feeder:** every scan cycle persists ranker decisions for backtesting + post-mortem comparison vs. live PnL — without exchange exposure.
- **Endpoint:** `/api/v2/polymarket/paper-signals?limit=50` gives instant visibility into ranker output, plus `feeder.enabled` so deploy state is verifiable.
- **Sentiment bias verified:** ranker confidence now reflects external news sentiment per-market, with bounded magnitude — no rogue flips.

## PROFIT IMPACT
- Backtest dataset auto-builds during paper mode → faster path to threshold tuning.
- Per-card stale flags = quicker triage when a single signal source dies (no false "everything looks fine" reads).
- Sentiment bias on syndicate adjusts confidence on edge cases (large news swings) → fewer mid-cycle flips, better entry timing.

## MARKET-SENSITIVITY IMPACT
- Sentiment now propagates from `sentimentAgent` → `polySyndicate` → final `MarketAnalysis.confidence`.
- Ranker output is captured at decision time (paper signal) so we can correlate confidence vs. realized outcome later.

## WHAT WAS PRESERVED
- Scanner scoring weights, return shape, persistence path — untouched.
- Syndicate fallback opinions, prompts, LLM call logic — untouched.
- All existing dashboard widgets, layout, badge — untouched (only inserts).
- Header `FreshnessBadge` from Batch 5 — preserved.

## WHAT WAS REPAIRED / EXTENDED
- C12 (per-widget freshness) — 5 of N widgets now covered. Continues incremental rollout.
- Observability gap on paper-mode ranker decisions — closed via endpoint + ring buffer.

## VERIFIED IMPROVEMENTS
- TSC clean on `src/` (no new errors introduced).
- Paper feeder default-OFF: no behavior change in production until env flag flipped.
- Supabase write is non-blocking (`void persistAsync(...)`).

## DEPLOY FLAGS
- `POLY_PAPER_FEEDER=true` → enable feeder (also requires `TRADING_MODE !== 'LIVE'`).
- `SYNDICATE_SENTIMENT_BIAS=true` (default) — already on; set to `false` to disable.

## OPTIONAL DB MIGRATION (not required for ring buffer)
```sql
CREATE TABLE IF NOT EXISTS poly_paper_signals (
  id BIGSERIAL PRIMARY KEY,
  signal_id TEXT UNIQUE,
  market_id TEXT,
  market_title TEXT,
  division TEXT,
  recommendation TEXT,
  edge_score INT,
  risk_level TEXT,
  yes_price NUMERIC,
  no_price NUMERIC,
  liquidity_usd NUMERIC,
  volume_24h NUMERIC,
  reasoning TEXT,
  emitted_at TIMESTAMPTZ,
  mode TEXT
);
CREATE INDEX IF NOT EXISTS idx_poly_paper_signals_emitted ON poly_paper_signals(emitted_at DESC);
```

## REMAINING (proposed Batch 7)
- C2 prod URL check (still pending user gcloud verification).
- C11 console.log → createLogger sweep (low priority).
- C12 continuation: per-card FreshnessBadge for Last Syndicate Decision, API Credit Reserves, Open Positions, Equity Deep Dive (4 more widgets).
- Backtest harness: read `poly_paper_signals` + price history → P&L curve component.
- Optional: gladiator-level PnL attribution on top of paper signals.
