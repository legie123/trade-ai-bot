# PHASE 2 EXECUTION — CONSOLIDATED ACTION PLAN
**Status: READY TO START | Blocker: Git Lock (see below)**

---

## 🚨 GIT LOCK ISSUE

**Problem:** Sandbox has persistent git lock files preventing commits/pushes:
```
.git/index.lock
.git/HEAD.lock
.git/refs/remotes/origin/main.lock
.git/objects/maintenance.lock
```

**Impact:** Phase 1 files created but not committed:
- ✅ src/app/api/v2/health/route.ts (created)
- ✅ SMOKE_TESTS.md (created)
- ✅ TRADE_AI_OPERATIONAL_AUDIT.md (created)
- ✅ PHASE_2_ROUTE_AUDIT.md (created)

**Solution Needed:** 
1. User manually removes lock files on local machine: `rm -f .git/*.lock`
2. Then: `git add . && git commit && git push`
3. Or: Use Cloud Console to set up Cloud Build trigger manually (Cloud Build UI → Create Trigger)

---

## PHASE 2 — CONSOLIDATED EXECUTION PLAN
**Target:** 100% clarity on all 46 routes, delete dead code, standardize API responses

### PART 1: ROUTE VALIDATION (2 hrs)
**Goal:** Test all ACTIVE routes (17) to confirm they work

```bash
# 1. Health check endpoint (new)
curl https://trade-ai.../api/v2/health

# 2. Polymarket core
curl "https://trade-ai.../api/v2/polymarket?action=status"
curl "https://trade-ai.../api/v2/polymarket?action=scan&division=CRYPTO"
curl "https://trade-ai.../api/v2/polymarket?action=markets&division=TRENDING"

# 3. Auth
curl "https://trade-ai.../api/auth"

# 4. Dashboard
curl "https://trade-ai.../api/dashboard"

# ... (test all 17 routes)
```

**Checklist:**
- [ ] Each route responds with 2xx status
- [ ] Response JSON is valid (use `jq` to parse)
- [ ] Response contains expected fields
- [ ] Error responses follow consistent format

### PART 2: UNCERTAIN ROUTES INVESTIGATION (1 hr)
**Goal:** Understand what uncertain routes do, decide KEEP or DELETE

**A2A System (5 routes):**
- [ ] Read src/app/api/a2a/*/route.ts to understand purpose
- [ ] Trace which components use each
- [ ] Document if production-critical or experimental
- [ ] Decision: Keep all 5 or delete unused ones

**Signals (btc-signals, trade-reasoning, tradingview, indicators):**
- [ ] Verify if signals are used by Polymarket scanner
- [ ] Check if signals feed into trading decisions
- [ ] Decision: Keep if used, DELETE if not

**Cron routes (auto-promote, sentiment, positions):**
- [ ] Check if triggered by /api/cron scheduler
- [ ] Verify execution logs in Supabase
- [ ] Decision: Keep all or consolidate

**Example:**
```typescript
// BEFORE (uncertain)
src/app/api/btc-signals/route.ts - calls LLM but unclear if result used

// AFTER (documented)
src/app/api/btc-signals/route.ts
- Called by: Polymarket scanner cron job
- Purpose: Generate trading signals for BTC-related markets
- Used by: v2/polymarket/cron/scan/route.ts (when division = CRYPTO)
- Status: KEEP, working as intended
```

### PART 3: DELETE DEAD ROUTES (30 min)
**Routes to delete immediately:**

```
meme-signals
solana-signals
agent-card
live-stream
watchdog/ping
notifications
v2/dry-run
v2/test-live-cycle
v2/events
v2/pre-live
v2/supabase-check
v2/analytics
```

**Conditional deletes (if not found to be used in Part 2):**
- auto-trade
- moltbook-cron (if redundant with /cron)
- health (old — keep until /v2/health deployed)

**Commands:**
```bash
# Delete routes
rm src/app/api/meme-signals/route.ts
rm src/app/api/solana-signals/route.ts
# ... (repeat for all 14)

# Delete empty directories
find src/app/api -type d -empty -delete

# Verify no imports broke
grep -r "meme-signals" src/ && echo "WARNING: Still imported" || echo "✅ Clean"
```

### PART 4: STANDARDIZE API RESPONSE SCHEMA (2 hrs)
**Goal:** All API routes return same JSON shape

**Standard Response Format:**
```typescript
interface ApiResponse<T> {
  success: boolean;           // true/false
  data?: T;                    // Response payload
  error?: {
    code: string;              // "INVALID_INPUT", "AUTH_FAILED", "INTERNAL_ERROR"
    message: string;           // Human-readable error
  };
  timestamp: string;          // ISO 8601
  requestId: string;          // Unique request ID for tracing
}

// Examples
{ success: true, data: { overall_status: "HEALTHY" }, timestamp: "2026-04-14T..." }
{ success: false, error: { code: "NOT_FOUND", message: "Division not found" }, timestamp: "..." }
```

**Implementation:**
```bash
# 1. Create shared response utilities
cat > src/lib/api-response.ts <<'EOF'
export function successResponse<T>(data: T) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  };
}

export function errorResponse(code: string, message: string) {
  return {
    success: false,
    error: { code, message },
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  };
}
EOF

# 2. Update each route to use response helper
# Before:
return NextResponse.json({ status: "ok" });

# After:
import { successResponse } from "@/lib/api-response";
return NextResponse.json(successResponse({ status: "ok" }));
```

**Routes to update (all 17 ACTIVE):**
- [ ] v2/polymarket/route.ts
- [ ] v2/polymarket/cron/mtm/route.ts
- [ ] v2/polymarket/cron/scan/route.ts
- [ ] v2/polymarket/cron/resolve/route.ts
- [ ] auth/route.ts
- [ ] dashboard/route.ts
- [ ] v2/deepseek-status/route.ts
- [ ] v2/arena/route.ts
- [ ] cron/route.ts
- [ ] bot/route.ts
- [ ] exchanges/route.ts
- [ ] tokens/route.ts
- [ ] telegram/route.ts
- [ ] diagnostics/master/route.ts
- [ ] diagnostics/credits/route.ts
- [ ] diagnostics/signal-quality/route.ts
- [ ] a2a/*/route.ts (5 routes)

### PART 5: ADD ERROR BOUNDARIES (1 hr)
**Goal:** No unhandled exceptions leak to client

**Create middleware:**
```typescript
// src/app/api/_middleware.ts
export async function middleware(request: NextRequest) {
  try {
    // Routes will be wrapped automatically
    return NextResponse.next();
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Server error" } },
      { status: 500 }
    );
  }
}
```

**Wrap all route handlers:**
```typescript
// Before
export async function GET() {
  return NextResponse.json(data);
}

// After
export async function GET() {
  try {
    return NextResponse.json(successResponse(data));
  } catch (err) {
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", (err as Error).message),
      { status: 500 }
    );
  }
}
```

---

## PHASE 2 TIMELINE

| Task | Time | Owner |
|------|------|-------|
| Validate 17 ACTIVE routes | 2 hrs | Test each endpoint |
| Investigate UNCERTAIN routes | 1 hr | Read code + trace usage |
| Delete 14 DEAD routes | 30 min | Git rm + cleanup |
| Standardize response schema | 2 hrs | Create helper + update all routes |
| Add error boundaries | 1 hr | Middleware + error handling |
| **TOTAL** | **6.5 hrs** | |

---

## PHASE 2 VERIFICATION CHECKLIST

After completing all tasks:

- [ ] All 17 ACTIVE routes tested and working
- [ ] A2A system documented and purpose clear
- [ ] 14 DEAD routes deleted
- [ ] All ACTIVE routes return standard response format
- [ ] All ACTIVE routes have error boundaries
- [ ] No broken imports after deletions
- [ ] Smoke tests still pass
- [ ] git add + git commit (after lock resolved)
- [ ] git push → Cloud Build auto-deploys
- [ ] Smoke tests pass on deployed instance

---

## BLOCKERS

1. **Git Lock** — Prevent commits until resolved
   - Status: PERSISTENT in sandbox
   - Fix: User must manually remove lock files on local machine
   - Impact: Can't push Phase 2 changes until resolved

2. **Cloud Build Trigger** — Auto-deploy not configured
   - Status: gcloud CLI failed (argument validation error)
   - Fix: Use Cloud Console UI to create trigger
   - Impact: Must manually push each deployment

---

## NEXT STEPS (After Git Lock Resolved)

1. **START PART 1:** Test all 17 routes using SMOKE_TESTS.md variant
2. **START PART 2:** Document A2A system and uncertain routes
3. **START PART 3:** Delete dead routes and verify no imports broke
4. **START PART 4:** Standardize all response schemas using helper function
5. **COMMIT & PUSH:** Phase 2 changes to trigger Cloud Build

---
