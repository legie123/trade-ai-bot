# PHASE 2 — BATCH 4 REPORT
Date: 2026-04-15
Scope: UI Intelligence Panel — read-only consumer of /api/v2/intelligence/*
Mode: additive-only. 1 new component + 2 pages lightly extended (1 import + 1 block each). Zero existing markup touched.

## TARGET
Surface ranking + sentiment + feed-health in `/polymarket` and `/dashboard` without mutating any existing panel, controller, style, or state.

## FILES
### NEW (1)
- `src/components/IntelligencePanel.tsx` — collapsible client component, polls `/api/v2/intelligence/ranking`, `/sentiment`, `/feed-health` every 20s, renders ranked list with score/direction/reasons/penalties + sentiment badges + WS health pills.

### EDITED (2)
- `src/app/polymarket/page.tsx` — +1 import, +1 `<IntelligencePanel>` block at the end of main content (sector default POLYMARKET).
- `src/app/dashboard/page.tsx` — +1 import, +1 `<IntelligencePanel>` block before BottomNav (sector default ALL).

No existing JSX rewritten, no state hooks added to parents, no props drilled.

## DETAILS
- Component is `'use client'`, fully self-contained.
- Dark terminal-style styling via inline styles (no new CSS file).
- Collapsible header — starts expanded, click toggles.
- Sector filter buttons (ALL / CRYPTO / POLYMARKET).
- Manual `↻ refresh` button.
- Auto-poll 20s; pauses when collapsed.
- Tolerates API shape variations (unwraps `{status, data}` or flat responses).
- Pills: WS status (polyWS, mexcWS), news adapter count, sentiment adapter name, overall sentiment label, per-symbol sentiment top-8.
- Ranked rows: `#, symbol/market, score, direction (▲▼→), reasons · penalties`.

## RISK
- Zero. Component isolates via props defaults. If intelligence APIs 404 (e.g. stale deploy), component shows empty state — no crash, no layout shift.
- TSC clean across full src/.

## PROFIT IMPACT
- Operator sees top ranked opportunities with full reason trail, live-updating.
- Penalties (thin liquidity, wide spread, stale data) surface at-a-glance.

## MARKET-SENSITIVITY IMPACT
- Polymarket page gets its own sector-scoped ranking — direct strategic surface enhancement.
- Dashboard gets cross-sector view for macro awareness.

## VALIDATION
Open `/polymarket` and `/dashboard` after deploy. Panel appears at bottom of main content. Collapse/expand works. Sector filter switches.

## CLOSING
- DONE: UI additive Intelligence Panel on 2 pages.
- BLOCKED: none.
- NEXT: Phase 2 Batch 5 (propus) — hook up scanner to push into orderbookIntel/volumeIntel caches so ranker has richer inputs even without WS autostart, plus polling fallback for useRealtimeData (C9) and dashboard freshness markers (C12).
- RISKS: low.
- FILES TOUCHED: 1 new, 2 edited.
- ADDITIVE IMPACT: intelligence stack end-to-end visible in UI.
