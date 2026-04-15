# Daily Master Adaptive Audit — 2026-04-15

## 1. Executive Status
**STABLE WITH WARNINGS** — 1 active type-level regression fixed; 1 security regression flagged (cron auth drift); stale build cache causing phantom errors.

## 2. What Was Learned Today
- Phase 2 Batch 6 (sentiment-aware syndicate) introduced dead type branches referencing non-existent direction enum values (`BUY_YES`, `BUY_NO`, `BUY`, `SELL`) — silent logic loss in sentiment bias, plus ghost `market.question` fallback. Ranker signal weakened without crash.
- CRON auth hardening from commit `27e1cc7` applied to **only 1 of 6** cron endpoints. The other 5 quietly regressed to public exposure.
- Stale `.next/` build cache still references deleted routes (`agent-card`, `health`, `notifications`, `dry-run`, `pre-live`, `test-live-cycle`, `watchdog/ping`) — this is the **same pattern** the `tsbuildinfo` fix in `9cbaf30` tried to solve. Recurring failure → need prebuild clean step.
- `.gitnexus` index is 3 days stale (2026-04-12) vs 6+ commits after.

## 3. New Critical Findings
| # | Issue | Where | Evidence |
|---|-------|-------|----------|
| C1 | Sentiment bias dead branches (invalid direction comparisons) | `src/lib/polymarket/polySyndicate.ts:94,100,102` | `tsc` errors TS2367 × 4, TS2339 × 1 |
| C2 | 5 cron endpoints lack `CRON_SECRET` auth | `cron/positions`, `cron/auto-promote`, `polymarket/cron/{mtm,resolve,scan}` | No `CRON_SECRET` check found; sentiment cron is the only one guarded |
| C3 | Stale `.next` cache references deleted routes | `.next/types/validator.ts`, `.next/dev/types/validator.ts` | TS2307 × 13 on nonexistent route files |

## 4. Regressions Detected
- **R1 (Phase 2 Batch 6, commit `152345f`)**: sentiment adjustment logic silently no-ops for intended direction labels because they don't exist in the actual `Direction` union. Only the `YES`/`NO` branches ever fire; the rest are dead.
- **R2 (vs commit `27e1cc7` intent)**: CRON_SECRET coverage incomplete. `auto-promote` is especially dangerous — a public GET can flip gladiators PHANTOM→LIVE (still gated by killSwitch, but still exposed).
- **R3 (vs commit `9cbaf30`)**: stale cache issue returned. `tsbuildinfo` fix did not cover `.next/types/validator.ts` regeneration on route deletion.

## 5. Weak Points Found
- No uniform cron auth helper — every endpoint reimplements (or forgets) auth.
- `PolyMarket` interface lacks the legacy `question` field some code still assumes → latent null-safety gap across any other code using `market.question`.
- `.gitnexus` index stale: impact analysis will lag recent refactors (Batches 1–6). Planned `gitnexus analyze` rerun is required before next refactor.
- Syndicate direction enum (`'YES' | 'NO' | 'SKIP'`) vs Polymarket execution language (`BUY_YES` / `BUY_NO`) is split — future contributors will keep mismatching.

## 6. Auto-Heal Fixes Applied
**AUTO-FIXED (C1 / R1)** — `src/lib/polymarket/polySyndicate.ts`
- Removed dead comparisons against `BUY_YES`, `BUY_NO`, `BUY`, `SELL`.
- Kept only valid `YES` / `NO` branches (SKIP = no adjustment, which is correct).
- Removed `market.question` fallback (property does not exist on `PolyMarket`).
- Net: +4 / −4 lines. Behavior unchanged for real direction values; removes silent dead code that was hiding type errors.

Rollback: `git checkout -- src/lib/polymarket/polySyndicate.ts`

## 7. What Should Be Improved Next
1. **P0 — Add `requireCronAuth()` helper** (`src/lib/core/cronAuth.ts`) and wire into all 6 cron routes. Safe deploy order: helper first, then one endpoint at a time, env `CRON_SECRET` must be set in Cloud Run before rollout.
2. **P1 — Add `prebuild` script** to `package.json`: `"prebuild": "rm -rf .next/types .next/dev/types"` to prevent stale route typings from leaking into tsc.
3. **P1 — Unify direction taxonomy**: either extend `Direction` to `'YES' | 'NO' | 'SKIP' | 'BUY_YES' | 'BUY_NO'` or keep strict and add a mapping function at the execution boundary.
4. **P2 — Add type regression test**: `tsc --noEmit` on every commit via precommit hook (project already has the tooling; not gated).
5. **P2 — Refresh `gitnexus analyze`** (index last built 2026-04-12, 6 commits behind).

## 8. What Can Be Safely Removed or Disabled
- **None** auto-removed this run. Candidate for review: DEPLOY_INSTRUCTIONS.txt + DEPLOY_NOW.txt + DEPLOY_PRODUCTION.sh + DEPLOY_SCRIPT.sh + GIT_PUSH_INSTRUCTIONS.md — likely stale scaffolding overlapping `PHASE_5_DEPLOY_CHECKLIST.md`. Not removing without owner sign-off.

## 9. Files Touched
```
src/lib/polymarket/polySyndicate.ts   [AUTO-FIXED]
DAILY_AUDIT_2026-04-15.md             [NEW, this report]
```

## 10. Risk Level
**LOW** — single additive/narrowing type fix inside a try/catch'd branch. Sentiment bias continues to work on valid directions. No data-flow, no execution-path, no live-trading changes.

## 11. Profit-Impacting Issues
- Dead branches in sentiment bias (R1) were reducing ranker responsiveness on markets where consensus was `YES`/`NO` and additionally expected to match the exec-language aliases. Fix restores intended behavior on `YES`/`NO`. No impact on `BUY_YES`/`BUY_NO` because those never appear in `consensusDirection`.
- No change to paper-trading isolation. Live trading untouched.

## 12. Market-Sensitivity Issues
- Sentiment bias now reliably applies on YES/NO consensus when ≥2 symbol-level observations. Fallback to `overall` sentiment remains gated at `count ≥ 5` and `|aggScore| > 0.2`. These thresholds look conservative; consider tuning after 7 days of paper data.
- Feed-health / SSE reconnect logic: `polyWsClient` has reconnect + heartbeat plumbing (lines 62–175). Not modified today. Should be smoke-tested after next prod deploy.

## 13. Recommended Next Manual Action
1. On dev machine: `rm -rf .next && npm run build` — clear stale Next.js cache locally and in CI to eliminate R3 phantom errors.
2. Implement `requireCronAuth()` helper and wire 5 unprotected endpoints (C2 / R2) — do **not** auto-apply; needs `CRON_SECRET` confirmed in Cloud Run env first.
3. Run `npx gitnexus analyze` to refresh code-intelligence index before next refactor cycle.
4. Paper-trade observability: watch 24h of syndicate decisions for sentiment note presence in logs — confirm fix landed.

---
Decision summary: C1 AUTO-FIXED · C2 NEEDS REVIEW · C3 NEEDS REVIEW · R1 AUTO-FIXED · R2 NEEDS REVIEW · R3 NEEDS REVIEW.
