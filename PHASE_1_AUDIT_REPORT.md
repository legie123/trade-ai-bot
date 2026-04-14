# PHASE 1: HARD FAILURE AUDIT — POLYMARKET PRODUCTION READINESS

**Date**: 2026-04-14  
**System**: TRADE AI — Polymarket Paper Trading with LLM Consensus  
**Status**: ❌ CRITICAL FAILURES IDENTIFIED  

---

## EXECUTIVE SUMMARY

Code inspection reveals 15 profit-critical weak points across 6 layers. System relies heavily on heuristic pattern-matching with unreliable LLM fallbacks. **Edge scoring is not fundamental analysis**. Gladiator agents use mechanical price-based rules, not market intelligence.

**Immediate Actions Required**:
1. Fix /api/v2/*/cron/* route compilation 
2. Replace trivial fallback heuristics with basic fundamental checks
3. Implement live/paper trading separation validation
4. Add risk controls and circuit breakers
5. Validate data freshness and quality before use

---

## LAYER-BY-LAYER FAILURE ANALYSIS

### LAYER 1: BUILD & DEPLOYMENT

| Item | Status | Finding |
|------|--------|---------|
| Docker build | ✅ Pass | Node 20 Alpine, .next/standalone working |
| TypeScript compilation | ✅ Pass | tsconfig with skipLibCheck=true |
| Cloud Run deployment | ⚠️ Partial | Main routes (v2/polymarket) working, cron routes NOT compiled |
| Health check endpoint | ❌ Fail | /api/v2/health returns 404 (route file exists but not compiled) |

**Root Cause**: Cron and health route files exist but are not importing anything or have broken imports, so Next.js doesn't include them in standalone build.

**Fix Required**: 
```
- Verify /api/v2/health/route.ts compiles in isolation
- Verify /api/v2/polymarket/cron/*/route.ts all have working imports
- Run `npm run build` locally and check `.next/standalone/pages/api/v2/` contents
```

---

### LAYER 2: RUNTIME INITIALIZATION

**Finding**: Single-threaded initialization with race condition risk

```typescript
// polyState.ts line 22-23
let initialized = false;
let initPromise: Promise<void> | null = null;

// Line 58-63: Only one init() can run at a time, BUT:
// If Cloud Run gets 2 concurrent requests before initialized=true,
// both will try to call _doInit()
```

**Risk**: If Supabase write fails during init, second request will get partial state.

**Data Flow**:
1. First request calls `waitForInit()` → `initPolyState()` → `_doInit()`
2. _doInit() calls `loadPolyStateFromCloud()` (Supabase read)
3. If no saved state: spawns 16 blank Gladiators, calls `persistGladiators()`
4. State is now in memory but may not be persisted if Supabase timeout

**Critical Issue**: No transaction semantics. If persist fails, state is corrupted.

---

### LAYER 3: CORE TRADING ALGORITHMS

#### **3.1 — EDGE SCORING (marketScanner.ts)**

**Composite Score Formula**:
```
edgeScore = mispricing(30%) + momentum(20%) + volume(15%) + 
            liquidity(15%) + spread(10%) + timeDecay(10%)
```

**Threshold**: 40 points minimum to flag as opportunity.

**FAILURE #1: Edge Scoring Is Pattern Matching, Not Analysis** ⚠️ CRITICAL

| Component | Implementation | Issue | Impact |
|-----------|----------------|-------|--------|
| Mispricing (30%) | Checks if price <0.1 or >0.9, assigns +45 points | **Not comparing to fair value**—just looks for extreme prices | Most "mispricing" signals are just tail events, not actual edges |
| Momentum (20%) | Tries to use price history, falls back to volume | **Only 1 price snapshot available** (current price). Can't calculate velocity from 1 point. Falls back to volume>50k=score 40 | Momentum = volume proxy, not actual price momentum |
| Volume (15%) | Linear thresholds: >100k=100, >50k=80, etc. | **No baseline**. Is 50k volume high for this market? For this division? | Volume anomaly not actually detected, just absolute magnitude |
| Liquidity (15%) | Uses market.liquidityUSD field | **Source unknown**. If missing, defaults to 0 | Can't distinguish "illiquid" from "unset" |
| Spread (10%) | Fetches order book, calculates bid-ask | **Order book may be hours old**. CLOB updates asynchronously | Spread data is stale |
| TimeDecay (10%) | Hours to expiry | **Rewards markets close to expiration**, not actual time value | Incentivizes last-minute bets (high risk) |

**Real Impact**: 
- Edge score 40 = arbitrary threshold with no calibration
- A market with price=0.05 + volume=50k + 12h expiry gets score~75 without any fundamental reason to trade
- System is reacting to market structure, not detecting mispricing

**Fallback Risk**:
```typescript
// marketScanner.ts line 209-213
// If price history fetch fails:
if (vol > 50000) score += 40;  // Same as having momentum!
else if (vol > 20000) score += 30;
```
This IS the momentum score for most markets.

---

#### **FAILURE #2: Agent Direction Determined by Price Level Only** ⚠️ CRITICAL

**Code** (polyGladiators.ts line 162-177):
```typescript
function determineDirection(market: PolyMarket): 'BUY_YES' | 'BUY_NO' | 'SKIP' {
  const yesPrice = yesOutcome.price;
  if (yesPrice < 0.35) return 'BUY_YES';     // Mechanical rule!
  if (yesPrice > 0.65) return 'BUY_NO';      // Mechanical rule!
  return 'SKIP';
}
```

**Issue**: Direction is determined by 3 hardcoded price bands, not by analysis
- Price 0.34 = BUY_YES (regardless of edge, liquidity, time, confidence)
- Price 0.66 = BUY_NO (same)
- Price 0.35-0.65 = SKIP (even if massive edge)

**Real Impact**: Agents are **contrarian bots**, not traders
- When market says 30% chance (price=0.30), they buy YES
- When market says 70% chance (price=0.70), they buy NO
- No use of actual edge scores, confidence, or market signals

---

#### **FAILURE #3: Readiness Score Is Easily Gamed** ⚠️ HIGH

**Code** (polyGladiators.ts line 212-227):
```typescript
if (outcome === 'WIN') {
  gladiator.readinessScore = Math.min(95, readinessScore + confidence * 0.1);
} else {
  gladiator.readinessScore = Math.max(10, readinessScore - confidence * 0.15);
}
```

**Promotion Criteria** (line 275):
```typescript
if (readinessScore >= 60 && totalTrades >= 25) {
  gladiator.isLive = true;  // Promoted!
}
```

**Example Path to Promotion**:
- Gladiator starts with readinessScore=10
- Makes 25 high-confidence bets with actual 50% win rate:
  - 12-13 wins: +confidence×0.1 each = +80-130 readiness points
  - 12-13 losses: -confidence×0.15 each = -180-195 readiness points
  - Net = -100 to +0 readiness points (back to 10)
  
**BUT**: If gladiator makes only 10 high-confidence WINS:
  - Readiness: 10 + (10 × 80 × 0.1) = 10 + 80 = 90 (if no losses)
  - Promoted immediately after 10 trades if they're all wins

**Real Impact**: 
- A gladiator that got lucky on 10 trades can promote and go live
- Leaderboard sorting by readiness doesn't identify skill
- Low sample size → high variance → promoted noise

---

#### **FAILURE #4: Phantom PnL Calculation Oversimplifies Reality** ⚠️ HIGH

**Code** (polyGladiators.ts line 196):
```typescript
const pnl = isCorrect ? 1.0 - bet.entryPrice : -(bet.entryPrice);
```

**Issue**: 
- If bet is correct: profit = 1.0 - entry_price
- If bet is wrong: loss = -entry_price
- This assumes position can ALWAYS be exited at:
  - 1.0 if correct (market resolved with certainty)
  - 0.0 if wrong (not in this formula, but implied)

**Real Impact**:
- Ignores slippage (you can't sell at 1.0 with 1 second to expiry)
- Ignores liquidity constraints (your position size might move the market)
- Ignores position value decay (market price may move away before resolution)
- P&L numbers are fiction

---

#### **FAILURE #5: LLM Consensus Unreliable** ⚠️ HIGH

**Architecture** (polySyndicate.ts):
```
Analyze Market
  ├─ Architect LLM (fundamental)
  │  └─ DeepSeek/OpenAI/Gemini (8s timeout)
  │     └─ Fallback: price<0.4=YES, confidence=35
  └─ Oracle LLM (sentiment)
     └─ DeepSeek/OpenAI/Gemini (8s timeout)
        └─ Fallback: volume>500&&liquidity>1000=YES, confidence=25

Result: confidence = architect(60%) + oracle(40%)
```

**Failure Mode**:
- DeepSeek timeout (likely, shared infra): 8s wait
- Falls back to OpenAI: 8s wait
- Falls back to Gemini: 8s wait
- **Total: 24 seconds** for one market analysis with cascading timeouts
- **Or**: All 3 timeout → use fallback heuristics (price<0.4=YES)

**Fallback Heuristics** (polySyndicate.ts line 386-411):
```typescript
function fallbackArchitectOpinion(market) {
  // This is what runs if LLM APIs fail/timeout
  const yesPrice = outcomes[0].price;
  const direction = yesPrice < 0.4 ? 'YES' : yesPrice > 0.6 ? 'NO' : 'SKIP';
  return { direction, confidence: 35, reasoning: 'Fallback: price heuristic' };
}

function fallbackOracleOpinion(market) {
  const hasVolume = volume > 500;
  const hasLiquidity = liquidity > 1000;
  return { direction: hasVolume && hasLiquidity ? 'YES' : 'SKIP', 
           confidence: 25 };  // Very low!
}
```

**Real Impact**:
- Most markets use fallback heuristics (LLM timeout)
- "Dual consensus" is marketing—it's really just 2 fallback rules
- No actual fundamental analysis happening
- LLM is cosmetic

---

#### **FAILURE #6: Volume Interpretation Lacks Context** ⚠️ HIGH

**Code** (marketScanner.ts line 159-169):
```typescript
function scoreVolumeAnomaly(market: PolyMarket): number {
  const vol = market.volume24h || 0;
  if (vol > 100000) return 100;  // Magic numbers!
  if (vol > 50000) return 80;
  if (vol > 10000) return 60;
  // ...
}
```

**Issue**:
- Absolute thresholds with no context
- Is 50k volume high for "Will AI reach AGI by 2030?" vs "Trump approval >45%?"
- No comparison to:
  - Market historical average
  - Division baseline
  - Polymarket platform average
- Could be bot activity or whale wash trading

**Real Impact**: Volume "anomaly" is just "big number", not actual anomaly detection

---

#### **FAILURE #7: Liquidity Field Source Unknown & Unvalidated** ⚠️ MEDIUM

**Code** (polyClient.ts line 207):
```typescript
liquidityUSD: parseFloat(raw.liquidity || '0'),  // What is liquidity?
```

**Unknown**:
- Does `raw.liquidity` come from Gamma API?
- Is it AMM liquidity, CLOB orderbook depth, or something else?
- If API doesn't return it, defaults to 0 (treated as "no liquidity")
- No validation that it's > 0 or reasonable

**Real Impact**: Liquidity-based decisions (skip if liquidity<$1000) may be wrong

---

#### **FAILURE #8: Momentum Calculation Is Fallback Volume Proxy** ⚠️ MEDIUM

**Code** (marketScanner.ts line 173-221):
```typescript
async function scoreMomentum(market: PolyMarket): Promise<number> {
  const history = await getPriceHistory(market.id, 24);  // Get last 24h
  
  if (history.length >= 2) {
    // Calculate velocity
    const current = history[history.length - 1];
    const previous = history[Math.max(0, history.length - 2)];
    const velocity = (current.price - previous.price) / hours_elapsed;
    if (Math.abs(velocity) > 0.05) score += 50;
  } else {
    // Fallback: volume heuristic
    if (vol > 50000) score += 40;
  }
}
```

**Issue**:
- Price history only updated when `evaluateOpportunity()` is called (sparse)
- For new markets: length=1 (just added), can't calculate velocity
- Falls back to volume>50k=score 40 (same as having momentum)
- **Momentum = volume for most markets**

**Real Impact**: Can't distinguish price momentum from volume

---

#### **FAILURE #9: Market Data Staleness Not Managed** ⚠️ MEDIUM

**Data Freshness**:
- Price history: only updated on evaluation call (sparse, hours old)
- Order book: from CLOB, may be hours stale
- Market data: from Gamma API, may be 5-10min old
- No timestamp validation before use
- No cache invalidation

**Real Impact**: Scanner uses potentially outdated market data

---

#### **FAILURE #10: Position Sizing Doesn't Match Edge Magnitude** ⚠️ MEDIUM

**Code** (polyWallet.ts line 139-143):
```typescript
const edgeFraction = (edgeScore / 100) * 0.15;  // 0-15% edge max
const myProb = Math.min(0.95, impliedProb + edgeFraction);
const kellyBet = calculateKellyBetSize(...);
const betSize = Math.min(maxBet, kellyBet);
```

**Issue**:
- Edge score (0-100) maps to 0-15% edge
- But edge score is heuristic pattern-matching (not real edge!)
- Result: Kelly sizing is garbage-in, garbage-out
- Max bet is still 10% of division balance regardless

**Real Impact**: Position sizes don't reflect actual mispricing magnitude

---

#### **FAILURE #11: No Live/Paper Trading Separation** ⚠️ CRITICAL

**Finding**: Code doesn't distinguish between paper and live execution

**Risk Scenario**:
1. Paper trading running on Cloud Run
2. Add live execution layer (execute_trade function) to trading agent
3. Agent calls execute_trade() with wallet balance
4. **If wallet points to live account**: real money traded!

**Current State**:
- Wallet = paper wallet (no real money)
- All bets = phantom bets (no execution)
- But code has no flags, comments, or validation to prevent live execution

**Real Impact**: **If someone adds live execution layer without understanding architecture, system could trade real money against paper wallet state.**

---

#### **FAILURE #12: No Risk Controls or Circuit Breakers** ⚠️ CRITICAL

**Missing**:
- Max loss per division (only 50% emergency liquidation trigger)
- Daily/weekly loss limits
- Correlation limits across divisions
- Max positions per market
- Position concentration limits
- Slippage limits

**Code** (polyWallet.ts line 255-274):
```typescript
export function emergencyLiquidate(
  wallet: PolyWallet,
  division: PolyDivision,
  exitPrices: Map<string, number>,
): void {
  // Triggered when division down 50%
  // But NOT auto-called anywhere!
}
```

**Issue**: Emergency liquidation exists but is **never called** (manual trigger only)

**Real Impact**: Drawdown can exceed 50% before anything stops it

---

#### **FAILURE #13: Gladiator Leaderboard Sorts by Gamed Metrics** ⚠️ MEDIUM

**Code** (polyGladiators.ts line 256-271):
```typescript
return filtered.sort((a, b) => {
  if (b.readinessScore !== a.readinessScore)
    return b.readinessScore - a.readinessScore;  // Primary: gamed metric!
  return b.cumulativeEdge - a.cumulativeEdge;     // Secondary: phantom PnL sum
});
```

**Metrics**:
- readinessScore: heavily influenced by variance, not skill
- cumulativeEdge: sum of phantom PnLs (oversimplified)

**Real Impact**: Top gladiators may not be best performers

---

#### **FAILURE #14: Consensus Score Is Misleading** ⚠️ MEDIUM

**Code** (polySyndicate.ts line 440-448):
```typescript
function computeAgreement(confA: number, confO: number, directionMatch: number) {
  const avgConf = (confA + confO) / 2;
  return Math.round(avgConf * 0.7 + directionMatch * 0.3);
}
// directionMatch = 0 (disagree) or 100 (agree)
```

**Issue**:
- High score if both confident + agree, even if both wrong
- No calibration against actual outcomes
- Consensus ≠ accuracy

**Real Impact**: High consensus score might indicate confidence, not correctness

---

#### **FAILURE #15: No Input Validation on API Responses** ⚠️ LOW

**Risks**:
- Market prices not range-checked (could be <0 or >1)
- Outcome names could be null/empty
- Division slugs not validated against enum

**Code** (polyClient.ts line 191):
```typescript
price: parseFloat(prices[i] || '0.5'),  // No range check!
```

**Real Impact**: Downstream errors if API returns malformed data (low probability)

---

## CRITICAL RISK SUMMARY TABLE

| # | Failure Point | Severity | Status | Fixability |
|---|---|---|---|---|
| 1 | Edge scoring is pattern-matching | ⚠️ CRITICAL | Active | Requires redesign |
| 2 | Agent direction is mechanical | ⚠️ CRITICAL | Active | Easy fix |
| 3 | Readiness score is gamed | ⚠️ HIGH | Active | Medium fix |
| 4 | Phantom PnL oversimplified | ⚠️ HIGH | Active | Hard fix |
| 5 | LLM consensus unreliable | ⚠️ HIGH | Active | Easy fix |
| 6 | Volume lacks context | ⚠️ HIGH | Active | Medium fix |
| 7 | Liquidity field unknown | ⚠️ MEDIUM | Active | Medium fix |
| 8 | Momentum is volume fallback | ⚠️ MEDIUM | Active | Medium fix |
| 9 | Data staleness unmanaged | ⚠️ MEDIUM | Active | Easy fix |
| 10 | Position sizing doesn't match edge | ⚠️ MEDIUM | Active | Medium fix |
| 11 | No live/paper separation | ⚠️ CRITICAL | Active | Medium fix |
| 12 | No risk controls | ⚠️ CRITICAL | Active | Medium fix |
| 13 | Leaderboard sorts by gamed metrics | ⚠️ MEDIUM | Active | Easy fix |
| 14 | Consensus score misleading | ⚠️ MEDIUM | Active | Easy fix |
| 15 | No input validation | ⚠️ LOW | Active | Easy fix |

---

## OPERATIONAL TEST FAILURES

**Cron Routes Not Compiled**:
```
GET /api/v2/polymarket/cron/scan → 404
GET /api/v2/polymarket/cron/mtm → 404
GET /api/v2/polymarket/cron/resolve → 404
GET /api/v2/health → 404
```

**These endpoints are required for**:
- Cloud Scheduler hourly market scanning
- Mark-to-market updates (every 30min)
- Position resolution (every 6h)
- Health monitoring

**Impact**: **Cron jobs cannot run.** System cannot autonomously scan markets or resolve positions.

---

## PHASE 1 VERDICT

**Production Readiness**: ❌ **NOT READY**

**Why**:
1. Edge scoring is heuristic pattern-matching, not fundamental analysis
2. Agent trading rules are mechanical price bands, not market intelligence
3. LLM consensus falls back to trivial heuristics on any delay
4. Cron infrastructure not deployed (scanning/MTM cannot run)
5. No risk controls (system can lose >50% before stopping)
6. Paper/live separation not enforced (execution layer could be added dangerously)

**Recommended Actions**:
1. **Immediate**: Fix cron route compilation
2. **High Priority**: Add basic risk controls (daily loss limit, position limits)
3. **High Priority**: Validate paper vs live trading separation
4. **Medium Priority**: Replace trivial LLM fallbacks with basic checks
5. **Medium Priority**: Improve edge scoring with baseline comparisons
6. **Design**: Reconsider agent direction logic (don't use mechanical price bands)

**Do NOT start official paper trading until**:
- Cron routes are live and tested
- Risk controls are in place
- Data staleness is managed
- Agent direction logic is validated

---

*Report Generated: 2026-04-14 | TRADE AI Production Audit*
