# Phase 2 Part 3 — Response Schema Standardization Status

## ✅ COMPLETED (3 routes updated)

1. ✅ **src/app/api/v2/health/route.ts** — Updated to use successResponse/errorResponse
2. ✅ **src/app/api/auth/route.ts** — All 3 methods (POST/GET/DELETE) updated
3. ✅ **src/lib/api-response.ts** — Response helper created with successResponse() and errorResponse()

## 🔄 REMAINING (14 routes)

These routes need standardization but have high response statement counts (not suitable for manual editing):

| Route | Response Count | Priority | Status |
|-------|-----------------|----------|--------|
| v2/polymarket | 25 | 🔴 HIGH | Pending |
| v2/polymarket/cron/mtm | 8 | 🔴 HIGH | Pending |
| v2/polymarket/cron/scan | 10 | 🔴 HIGH | Pending |
| v2/polymarket/cron/resolve | 8 | 🔴 HIGH | Pending |
| v2/polymarket/cron/auto-promote | 6 | 🟡 MED | Pending |
| dashboard | 12 | 🟡 MED | Pending |
| v2/deepseek-status | 4 | 🟢 LOW | Pending |
| v2/arena | 5 | 🟢 LOW | Pending |
| cron | 6 | 🟡 MED | Pending |
| bot | 4 | 🟢 LOW | Pending |
| exchanges | 2 | 🟢 LOW | Pending |
| tokens | 2 | 🟢 LOW | Pending |
| telegram | 3 | 🟢 LOW | Pending |
| diagnostics/master | 6 | 🟡 MED | Pending |
| diagnostics/credits | 4 | 🟢 LOW | Pending |

## 📋 BATCH UPDATE APPROACH

Rather than manual editing, recommend using find-and-replace patterns:

**Pattern 1: Simple success responses**
```
FROM: return NextResponse.json({ status: 'ok', ... })
TO:   return successResponse({ status: 'ok', ... })
```

**Pattern 2: Error responses**
```
FROM: return NextResponse.json({ error: msg }, { status: 500 })
TO:   return errorResponse('INTERNAL_ERROR', msg, 500)
```

**Pattern 3: Status code variations**
```
FROM: NextResponse.json({ ... }, { status: 200 })
TO:   successResponse({ ... }, 200)
```

## 📝 RECOMMENDATION

**Option A (Complete Tonight):**
- Automate the refactor using VS Code Find-Replace or sed
- Estimated time: 30-45 min with proper testing
- Risk: May miss edge cases

**Option B (Hybrid - Recommended):**
- Update 5 highest-priority routes manually (Polymarket core)
- Batch-apply pattern for remaining 9 routes
- Estimated time: 1.5 hours with verification
- Risk: Minimal, allows validation between updates

**Option C (Document & Defer):**
- Keep current implementation (auth + health updated)
- Document standardization requirements for Phase 3
- Allows focusing on other Phase 2 deliverables now
- Estimated time: 15 min documentation

---

## ✅ VERIFIED CLEAN (11 routes deleted in Part 2)

```
✓ src/app/api/agent-card/route.ts
✓ src/app/api/live-stream/route.ts
✓ src/app/api/watchdog/ping/route.ts
✓ src/app/api/notifications/route.ts
✓ src/app/api/v2/dry-run/route.ts
✓ src/app/api/v2/test-live-cycle/route.ts
✓ src/app/api/v2/events/route.ts
✓ src/app/api/v2/pre-live/route.ts
✓ src/app/api/v2/analytics/route.ts
✓ src/app/api/v2/supabase-check/route.ts
✓ src/app/api/health/route.ts (old version)
```

---

## 🚀 NEXT STEP

**Confirm strategy:** A / B / C?

Then proceed with:
- Part 4: Investigate A2A system (5 routes) + meme/solana signals
- Final git staging and documentation
