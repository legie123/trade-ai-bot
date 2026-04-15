# PHASE 2 — BATCH 5 REPORT
Date: 2026-04-15
Scope: C9 polling fallback SSE recovery + C12 freshness markers + scanner→orderbookIntel wiring
Mode: additive-only. 1 new component + 3 files edited. Zero deletion.

## TARGET
1. Make `useRealtimeData` recover from polling back to SSE without page reload (C9).
2. Surface per-data-point freshness in the dashboard header (C12 first pass).
3. Feed Polymarket scanner orderbook snapshots into `orderbookIntel` cache so the ranker has input even without WS autostart.

## FILES

### NEW (1)
- `src/components/FreshnessBadge.tsx` — reusable, ticks every 1s, green/amber/red based on age thresholds (default 30s/120s). Reusable across widgets.

### EDITED (3)
- `src/hooks/useRealtimeData.ts`
  - Added `sseRecoveryTimerRef` + `SSE_RECOVERY_PROBE_MS = 120_000`.
  - `startPolling()` now also schedules a periodic SSE probe every 2 min. If SSE comes back, the `connected` listener tears down polling + recovery timer automatically.
  - Cleanup on unmount: clears recovery timer too.
- `src/app/dashboard/page.tsx`
  - +1 import (`FreshnessBadge`)
  - +1 badge in header row: `<FreshnessBadge timestamp={lastUpdate?.getTime()} label="feed" />` next to the existing stream status pill. Zero layout shift; purely additive inline element.
- `src/lib/polymarket/marketScanner.ts`
  - +1 import (`computeOrderbookIntel`, `BookLevel`)
  - In `scoreOrderBookSpread`, after extracting best bid/ask, populate the `orderbookIntel` cache with up to 10 levels per side (wrapped in try/catch, pure side-effect — never alters the scorer return). Ranker now reads this cache even when Polymarket WS autostart is off.

## RISK
- Zero breaking change.
- TSC clean across full `src/`.
- Recovery probe fires only while in polling mode; success → auto-cleanup. Failure → re-enters SSE retry path and eventually falls back.
- Scanner side-effect is bounded: max 10 levels per side, dedicated try/catch, doesn't affect `scoreOrderBookSpread` return.

## ADDITIVE BENEFIT
- Dashboard: operator sees at-a-glance whether the feed is truly fresh or silently stale (no more "LIVE but 10 minutes old").
- Hook: an SSE outage no longer locks you into polling forever — self-heals within 2 min.
- Ranker: gains live orderbook intel for every Polymarket market the scanner touches, even without `POLYMARKET_WS_AUTOSTART=true`.

## PROFIT IMPACT
- Stale-signal rejection backed by visible age.
- Ranker has liquidity + imbalance + spread inputs from scanner pass alone → richer scores immediately after deploy.

## MARKET-SENSITIVITY IMPACT
- Orderbook signal path is now populated by two sources (scanner + optional WS), so the ranker's `orderbook` weight carries real information on every scan cycle.

## WHAT WAS PRESERVED
- All existing hook logic untouched except 3 additive refs/timers.
- Scanner scoring logic untouched; only a side-effect cache update added.
- Dashboard header structure untouched; only 1 additional pill element.

## WHAT WAS REPAIRED
- C9 partial: SSE recovery from polling (self-healing realtime).

## VERIFIED IMPROVEMENTS
- TSC clean.
- Zero existing JSX rewritten.
- Hook `connected` listener now also tears down fallback + recovery timers.

## REMAINING
- C2 prod URL check (still pending user gcloud verification).
- C11 console.log → createLogger sweep (low priority).
- C12 full per-widget freshness (this batch gave the header pill; per-card adoption can be rolled out incrementally).

## NEXT (proposed Batch 6)
- Wire `/api/v2/intelligence/sentiment` results into the Polymarket Syndicate analysis so each market's scored sentiment biases the syndicate aggregator (still additive, zero destructive).
- Add per-card FreshnessBadge to top dashboard widgets (5 cards).
- Optional: opt-in ranker-driven paper-trade signal feeder (paper only, gated by TRADING_MODE).
