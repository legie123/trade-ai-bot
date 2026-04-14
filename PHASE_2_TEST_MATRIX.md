# PHASE 2: OPERATIONAL + PROFIT TEST MATRIX

**Purpose**: Identify which failures directly impact profit vs which are secondary  
**Method**: Test scenarios for each weak point with profit measurement  
**Target**: Rank failures by (profit impact × implementation difficulty) for Phase 3  

---

## TEST MATRIX: 15 SCENARIOS

### TEST 1: Edge Scoring Pattern-Matching
**Scenario**: Scan 100 active markets, measure what % pass EDGE_THRESHOLD (40)

**Test Setup**:
```javascript
// src/test/test_edge_scoring.ts
const markets = await getTrendingMarkets(100);
const results = [];
for (const market of markets) {
  const opp = await evaluateOpportunity(market);
  results.push({
    marketId: market.id,
    edgeScore: opp.edgeScore,
    isPassed: opp.edgeScore >= 40,
    components: {
      mispricing: opp.mispricingScore,
      momentum: opp.momentumScore,
      volume: opp.volumeAnomalyScore,
      liquidity: opp.liquidityScore,
      spread: opp.spreadScore,
      timeDecay: opp.timeDecayScore
    }
  });
}

// Analyze results
const passedCount = results.filter(r => r.isPassed).length;
const avgEdgeScore = results.reduce((sum, r) => sum + r.edgeScore, 0) / results.length;
const avgMispricing = results.reduce((sum, r) => sum + r.components.mispricing, 0) / results.length;
```

**Expected Finding**:
- 40-60% of markets pass edge threshold
- Mispricing score heavily driven by price extremes (<0.2 or >0.8)
- Most markets cluster around 35-45 edge score (noise floor)

**Profit Impact**: **HIGH**  
- If edge scores are noise, all position sizing is wrong
- Kelly criterion is garbage-in (no real edge input)
- Expected return will underperform actual market

**Pass Criteria**: 
- [ ] Can identify markets with TRUE mispricing (need baseline)
- [ ] Edge score correlates with actual outcome accuracy

**Current Status**: ❌ FAIL (no baseline comparison)

---

### TEST 2: Agent Direction Mechanical Rules
**Scenario**: Check 50 consecutive markets, measure how many get SKIP vs action

**Test Setup**:
```typescript
// Check direction distribution
const directions = results.map(r => {
  const yesPrice = r.market.outcomes[0].price;
  return {
    price: yesPrice,
    direction: yesPrice < 0.35 ? 'BUY_YES' : yesPrice > 0.65 ? 'BUY_NO' : 'SKIP'
  };
});

const stats = {
  buyYes: directions.filter(d => d.direction === 'BUY_YES').length,
  buyNo: directions.filter(d => d.direction === 'BUY_NO').length,
  skip: directions.filter(d => d.direction === 'SKIP').length,
  avgPriceWhenBuyYes: // ...
  avgPriceWhenBuyNo: // ...
};
```

**Expected Finding**:
- 60-70% of markets are SKIP (price in 0.35-0.65 band)
- BUY_YES markets cluster around 0.25 price
- BUY_NO markets cluster around 0.75 price

**Profit Impact**: **CRITICAL**  
- Agents only trade on extremes (contrarian bets)
- Don't use actual market intelligence to determine direction
- Win rate depends entirely on mean reversion (not edge detection)

**Pass Criteria**: 
- [ ] Direction correlates with actual market outcome
- [ ] Win rate on BUY_YES trades > 50% (should be, market says <35%)
- [ ] Win rate on BUY_NO trades > 50% (should be, market says >65%)

**Current Status**: ❌ FAIL (no outcome correlation data)

---

### TEST 3: Readiness Score Inflation Test
**Scenario**: Simulate 50 trades with various win rates, measure readiness trajectory

**Test Setup**:
```typescript
// Start fresh gladiator
let g = spawnPolyGladiator(PolyDivision.CRYPTO, 'Test');  // readiness=10

// Scenario A: 50% win rate, 80 confidence each
for (let i = 0; i < 25; i++) {
  const isWin = Math.random() < 0.5;
  const bet = {
    confidence: 80,
    direction: 'BUY_YES' as const,
    outcome: isWin ? 'WIN' : 'LOSS' as const
  };
  recordPolyOutcome(g, 'test-' + i, isWin ? 'YES' : 'NO');
}
// Measure final readiness score

// Scenario B: 10 straight wins, then all losses
for (let i = 0; i < 10; i++) {
  recordPolyOutcome(g, 'test-' + i, 'YES');
}
// Measure readiness after 10 wins (should be ~90)
// Then lose 10
for (let i = 10; i < 20; i++) {
  recordPolyOutcome(g, 'test-' + i, 'NO');
}
// Measure final readiness (should be ~10-20 again)
```

**Expected Finding**:
- 50% win rate: readiness stays near 10-30 (noisy, high variance)
- 10 wins then 10 losses: readiness goes 10→90→10 (volatile!)
- Promotion requires just 60 readiness + 25 trades

**Profit Impact**: **HIGH**  
- Cannot trust readiness score to identify good gladiators
- May promote agents with lucky streaks
- Leaderboard is unreliable

**Pass Criteria**: 
- [ ] Readiness stable under 50% win rate (should converge, not bounce)
- [ ] Promotion criteria are harder (e.g., require 75+ readiness, 50+ trades)

**Current Status**: ❌ FAIL (metric design is flawed)

---

### TEST 4: Phantom PnL Oversimplification
**Scenario**: Compare phantom PnL vs actual position value decay

**Test Setup**:
```typescript
// Create position: BUY_YES at 0.30
const position = {
  entryPrice: 0.30,
  shares: 100,
  direction: 'BUY_YES' as const
};

// Market moves to 0.35 (favorable)
// Phantom PnL would be: win = 1.0 - 0.30 = 0.70 profit (WRONG!)
// Actual value: 100 shares × 0.35 = $35 (vs $30 entry = $5 profit)

// Market resolves YES
// Phantom: 100 × (1.0 - 0.30) = 70 profit
// Actual: 100 × (1.0 - 0.30) = 70 profit ✓ (at 1.0)

// BUT: Market doesn't reach 1.0 before resolution
// Market locked at 0.95 (high confidence YES)
// Actual: 100 × (0.95 - 0.30) = 65 profit
// Phantom: 70 profit (overstated by 5)
```

**Expected Finding**:
- Phantom PnL assumes instant exit at 1.0 or 0.0
- Real world: exit at mid-market price (0.90-0.98 range for YES)
- Phantom overestimates wins by 5-10%, underestimates losses

**Profit Impact**: **MEDIUM**  
- PnL tracking is off by ~5-10%
- Affects reported returns, not actual profitability (positions still close correctly)
- Phantom wins understate due to lower exit prices

**Pass Criteria**: 
- [ ] Track actual vs phantom PnL for resolved bets
- [ ] Phantom overestimate ratio < 5%

**Current Status**: ⚠️ PARTIAL (affects reporting, not logic)

---

### TEST 5: LLM Consensus Fallback Rate
**Scenario**: Call analyzeMarket() 20 times, measure how often fallback is used

**Test Setup**:
```typescript
// Add logging to polySyndicate.ts
// Track when each LLM fails/times out
// Measure fallback rate

let stats = {
  totalMarkets: 0,
  deepseekSuccess: 0,
  deepseekTimeout: 0,
  openaiSuccess: 0,
  openaiTimeout: 0,
  geminiSuccess: 0,
  geminiTimeout: 0,
  fallbackUsed: 0
};

for (let i = 0; i < 20; i++) {
  const result = await analyzeMarket(market, division);
  // Check logs to see which provider succeeded
}
```

**Expected Finding**:
- DeepSeek: 30-50% success (shared infra, rate limits)
- OpenAI: 70-80% success (rate limits on account)
- Gemini: 60-70% success
- Fallback: 10-20% of markets

**Profit Impact**: **HIGH**  
- If 20% use fallback heuristics, analysis is garbage for those
- Fallback = "price < 0.4 = YES" + "volume > 500 = YES"
- No actual fundamental analysis for 1/5 of markets

**Pass Criteria**: 
- [ ] All markets analyzed successfully within timeout
- [ ] LLM API latency < 2s (not 8s each cascade)
- [ ] Fallback rate < 5%

**Current Status**: ❌ FAIL (expect high fallback rate)

---

### TEST 6: Volume Anomaly Baseline Test
**Scenario**: Compare 24h volume across divisions and markets, measure anomaly distribution

**Test Setup**:
```typescript
// Get markets from each division
const divisions = Object.values(PolyDivision);
const volumeStats = {};

for (const div of divisions) {
  const markets = await getMarketsByCategory(div, 50);
  const volumes = markets.map(m => m.volume24h || 0).sort((a, b) => a - b);
  
  volumeStats[div] = {
    min: volumes[0],
    p25: volumes[Math.floor(volumes.length * 0.25)],
    median: volumes[Math.floor(volumes.length * 0.5)],
    p75: volumes[Math.floor(volumes.length * 0.75)],
    max: volumes[volumes.length - 1],
    mean: volumes.reduce((s, v) => s + v, 0) / volumes.length
  };
}

// Check: Does 50k volume mean "anomaly" in POLITICS vs CRYPTO?
```

**Expected Finding**:
- POLITICS: median ~$5k-10k, 50k = very high anomaly
- CRYPTO: median ~$20k-50k, 50k = normal
- Hard threshold (50k for all) is meaningless

**Profit Impact**: **MEDIUM**  
- Volume scoring ignores division/market differences
- Some divisions naturally have lower volume
- "Anomaly" threshold is arbitrary

**Pass Criteria**: 
- [ ] Volume scoring normalized by division median
- [ ] Anomaly = 2-3x division median, not absolute threshold

**Current Status**: ❌ FAIL (no baseline normalization)

---

### TEST 7: Liquidity Field Validation
**Scenario**: Parse 50 markets, check liquidityUSD distribution and missing values

**Test Setup**:
```typescript
const markets = await getTrendingMarkets(50);
const liquidityStats = {
  present: 0,
  missing: 0,
  zero: 0,
  aboveThreshold: 0
};

const values = [];
for (const m of markets) {
  const liq = m.liquidityUSD;
  if (liq === undefined || liq === null) liquidityStats.missing++;
  else if (liq === 0) liquidityStats.zero++;
  else if (liq > 1000) liquidityStats.aboveThreshold++;
  else values.push(liq);
}

console.log('Liquidity distribution:', liquidityStats);
console.log('Non-zero values:', values.sort((a, b) => a - b));
```

**Expected Finding**:
- 10-20% missing (default to 0)
- 30-40% zero
- Wide range: $100 - $1M
- No way to know if "unknown" is really illiquid or API missing it

**Profit Impact**: **MEDIUM**  
- Can't distinguish real illiquidity from data unavailability
- May skip tradeable markets (false HIGH risk)
- May trade illiquid markets (true HIGH risk, missed)

**Pass Criteria**: 
- [ ] Validate liquidity field is present and > 0
- [ ] Skip markets if liquidity data unavailable

**Current Status**: ⚠️ PARTIAL (works but fragile)

---

### TEST 8: Momentum Calculation Reality Check
**Scenario**: Track 20 markets for 6 hours, measure price velocity vs volume

**Test Setup**:
```typescript
// Store snapshots every 30min for 6h
const snapshots = [];
for (let hour = 0; hour < 6; hour++) {
  const markets = await getTrendingMarkets(20);
  for (const m of markets) {
    const price = m.outcomes[0].price;
    snapshots.push({ marketId: m.id, time: Date.now(), price, volume: m.volume24h });
  }
  await new Promise(r => setTimeout(r, 30 * 60 * 1000)); // Wait 30min
}

// Calculate actual price velocity for each market
// Compare to momentumScore calculated at time T
```

**Expected Finding**:
- Momentum scores based on volume, not actual velocity
- Real velocity data shows 10-40% of trending markets change direction in 2h
- Historical data is too sparse to capture momentum

**Profit Impact**: **MEDIUM**  
- Momentum signals are unreliable
- Can't distinguish true momentum from volume-driven prices

**Pass Criteria**: 
- [ ] Momentum score correlates with actual price direction over next 2h
- [ ] Win rate on high-momentum trades > 50%

**Current Status**: ❌ FAIL (no real-time tracking)

---

### TEST 9: Data Staleness Impact
**Scenario**: Compare scan results across 1 hour, measure price/volume changes

**Test Setup**:
```typescript
// Scan at T=0
const scan1 = await scanAllDivisions(10);
const opportunities1 = scan1.flatMap(s => s.opportunities);

// Wait 1 hour, scan again
await sleep(60 * 60 * 1000);
const scan2 = await scanAllDivisions(10);
const opportunities2 = scan2.flatMap(s => s.opportunities);

// Compare
for (const opp of opportunities1) {
  const market2 = opportunities2.find(o => o.marketId === opp.marketId);
  if (!market2) {
    // Market no longer in top 10
    console.log('Dropped:', opp.marketId, 'Score was', opp.edgeScore);
  } else {
    const scoreDelta = market2.edgeScore - opp.edgeScore;
    console.log('Score delta:', scoreDelta);
  }
}
```

**Expected Finding**:
- Edge scores change 20-40% in 1 hour
- Top picks from T=0 may not be top picks at T=60min
- Stale data → bad trading decisions

**Profit Impact**: **MEDIUM**  
- If acting on old scan results, misprice entire trades
- Volatility makes yesterday's edge irrelevant today

**Pass Criteria**: 
- [ ] Scan results refreshed every 15-30min max
- [ ] No trading on data older than 5min

**Current Status**: ⚠️ PARTIAL (hourly cron, but no freshness tracking)

---

### TEST 10: Position Sizing Validation
**Scenario**: Open 20 positions across divisions, verify Kelly sizing logic

**Test Setup**:
```typescript
// Create positions with varying edges and confidences
const wallet = createPolyWallet();
const testCases = [
  { edge: 30, confidence: 50 },  // Low edge, medium confidence
  { edge: 70, confidence: 95 },  // High edge, high confidence
  { edge: 90, confidence: 30 },  // High edge, low confidence
];

for (const test of testCases) {
  const market = /* find market with price=0.3 */;
  const pos = openPosition(
    wallet, market.id, PolyDivision.CRYPTO, market.outcomes[0].id,
    'BUY_YES', 0.30, test.confidence, test.edge
  );
  
  console.log(`Edge=${test.edge}, Conf=${test.confidence}`, {
    shares: pos?.shares,
    capital: pos?.capitalAllocated
  });
}
```

**Expected Finding**:
- Edge 30 + Confidence 50 = small bet
- Edge 70 + Confidence 95 = large bet
- Edge 90 + Confidence 30 = medium bet
- All still capped at 10% of division balance

**Profit Impact**: **MEDIUM**  
- Sizing logic is correct (Kelly)
- But edge input is garbage (heuristic scores)
- Result: correct sizing of wrong estimates

**Pass Criteria**: 
- [ ] Bet sizes scale appropriately with edge
- [ ] No position > 10% of division balance
- [ ] Min bet size 10 (enforced)

**Current Status**: ✅ PARTIAL PASS (logic works, but edge scores are wrong)

---

### TEST 11: Paper/Live Trading Separation
**Scenario**: Verify code cannot accidentally execute live trades

**Test Setup**:
```typescript
// 1. Check for execute_trade function
// 2. Check if wallet is marked as PAPER or LIVE
// 3. Check if there are any env vars for live API keys

grep -r "execute.*trade\|live.*execute\|real.*money" src/
grep -r "LIVE_API\|REAL_WALLET\|TRADING_ACCOUNT" .env*

// 3. Verify wallet type
const wallet = getWallet();
console.log('Wallet is:', wallet.id, 'type:', typeof wallet);  // No type field!

// 4. Check Supabase writes
// Are we writing to paper wallet table or live wallet table?
```

**Expected Finding**:
- No execute_trade function exists (good)
- But wallet has no "type" field (no protection if added later)
- Could accidentally execute against wallet without protection

**Profit Impact**: **CRITICAL**  
- If execution layer added without understanding code, real money could be lost
- No guards to prevent this scenario

**Pass Criteria**: 
- [ ] Wallet type field = 'PAPER' (enforced)
- [ ] execute_trade() function throws error if wallet.type !== 'PAPER'
- [ ] Documentation: "Paper trading only, no live execution"

**Current Status**: ❌ FAIL (no type field, no guards)

---

### TEST 12: Risk Controls Existence
**Scenario**: Attempt to trigger emergency liquidation and risk limits

**Test Setup**:
```typescript
// 1. Try to create 10 positions in one division (max is 5)
const wallet = createPolyWallet();
for (let i = 0; i < 10; i++) {
  const pos = openPosition(wallet, `market-${i}`, PolyDivision.CRYPTO, /* ... */);
  console.log(`Position ${i}:`, pos ? 'OPENED' : 'REJECTED');
}
// Expected: positions 6-10 rejected due to MAX_POSITIONS_PER_DIVISION = 5

// 2. Simulate 50% loss and check if auto-liquidation happens
const divBalance = wallet.divisionBalances.get(PolyDivision.CRYPTO);
divBalance.balance = divBalance.peakBalance * 0.5;  // 50% loss
// Check: does anything trigger?

// 3. Check for daily loss limits
// None exist! No daily limit check in code.
```

**Expected Finding**:
- Position limits: YES (5 per division)
- Emergency liquidation: EXISTS but NEVER AUTO-CALLED
- Daily loss limits: NO
- Max loss per division: NO
- Position concentration: NO

**Profit Impact**: **CRITICAL**  
- No automatic stop-losses
- Can lose >50% of entire portfolio before anything happens
- Drawdown management is completely manual

**Pass Criteria**: 
- [ ] Daily loss limit: stop trading if down -$50 in a day
- [ ] Position limit: stop trading if down -$25 in open positions
- [ ] Emergency liquidation: auto-trigger at 40% drawdown (not 50%)
- [ ] Auto-execute liquidation, don't wait for manual trigger

**Current Status**: ❌ FAIL (controls exist but aren't auto-triggered)

---

### TEST 13: Leaderboard Metric Validation
**Scenario**: Run 16 gladiators for 30 synthetic trades each, compare leaderboard to actual performance

**Test Setup**:
```typescript
// Run 16 gladiators in simulation
const gladiators = Object.values(PolyDivision).map(div => 
  spawnPolyGladiator(div, `${div} Test`)
);

// Simulate 30 trades per gladiator
// Mix of outcomes to get various readiness scores
for (const g of gladiators) {
  for (let i = 0; i < 30; i++) {
    const isWin = Math.random() < 0.45;  // 45% win rate for all
    recordPolyOutcome(g, `trade-${i}`, isWin ? 'YES' : 'NO');
  }
}

// Get leaderboard
const board = getPolyLeaderboard(gladiators);

// Compare: does readiness score predict actual win rate?
for (const g of board) {
  const actualWinRate = g.stats.winRate;
  const readinessScore = g.readinessScore;
  console.log(`${g.id}: readiness=${readinessScore}, actualWR=${actualWinRate.toFixed(2)}`);
}
```

**Expected Finding**:
- Gladiators with readiness 80+ might have 45% actual win rate (same as others)
- Readiness driven by variance, not skill
- High readiness = lucky, not good

**Profit Impact**: **MEDIUM**  
- Can't identify best performers
- May promote underperformers, demote overperformers
- Leaderboard is entertainment, not useful

**Pass Criteria**: 
- [ ] Leaderboard readiness correlates with actual win rate (r² > 0.7)
- [ ] Top gladiators have consistent 55%+ win rate
- [ ] Metrics normalized for sample size

**Current Status**: ❌ FAIL (readiness is not predictive)

---

### TEST 14: Consensus Score Calibration
**Scenario**: Track 50 markets through resolution, compare consensus scores to outcomes

**Test Setup**:
```typescript
// Analyze 50 markets, store consensus scores
const analyses = await batchAnalyze(markets, PolyDivision.CRYPTO);
const stored = analyses.map(a => ({
  consensusScore: a.consensusScore,
  confidence: a.confidence,
  direction: a.direction
}));

// Wait for markets to resolve (variable time)
// Then check: was high consensus actually accurate?

// Metric: 
// - Average consensus score when CORRECT: ?
// - Average consensus score when WRONG: ?
// Difference should be significant if calibrated

console.log('Consensus when correct:', avgCorrectScore);
console.log('Consensus when wrong:', avgWrongScore);
console.log('Predictive value (AUC):', calculateAUC(/* ... */));
```

**Expected Finding**:
- Consensus when correct: 65-75
- Consensus when wrong: 60-70
- AUC close to 0.5 (random)

**Profit Impact**: **MEDIUM**  
- Consensus score doesn't predict accuracy
- Using it to rank markets is useless
- Both high and low consensus markets have similar success rates

**Pass Criteria**: 
- [ ] Consensus score AUC > 0.6 (better than random)
- [ ] High consensus (>70) has 55%+ accuracy
- [ ] Low consensus (<40) has <45% accuracy

**Current Status**: ❌ FAIL (not calibrated)

---

### TEST 15: Input Validation Robustness
**Scenario**: Send malformed API data through mapGammaMarket(), verify it doesn't crash

**Test Setup**:
```typescript
// Test edge cases
const edgeCases = [
  { price: -0.5 },        // Negative price
  { price: 1.5 },         // >100% probability
  { name: null },         // Null outcome name
  { endDate: 'invalid' }, // Invalid date
  { volume24h: -100 },    // Negative volume
  { liquidity: NaN },     // NaN liquidity
];

for (const testCase of edgeCases) {
  try {
    const market = mapGammaMarket(testCase);
    console.log('Processed:', testCase, '→', market);
  } catch (e) {
    console.log('Crashed:', testCase, 'error:', e.message);
  }
}
```

**Expected Finding**:
- price -0.5 → -0.5 (no range check)
- price 1.5 → 1.5 (no range check)
- Downstream errors when using invalid data

**Profit Impact**: **LOW**  
- Low probability Gamma API returns invalid data
- But if it does, system could crash or behave unexpectedly

**Pass Criteria**: 
- [ ] Range check: 0 <= price <= 1
- [ ] Validate: endDate is valid ISO string
- [ ] Validate: volume24h > 0
- [ ] Validate: outcome names are non-empty

**Current Status**: ⚠️ PARTIAL (some validation, but not comprehensive)

---

## PROFIT IMPACT SCORING

### Methodology
```
Profit Impact Score = (Probability of Failure × Financial Damage) + (Frequency × Severity)

Where:
- Probability of Failure: 0-1 (how often does this break?)
- Financial Damage: $100-$10k (if it breaks, how much lost?)
- Frequency: per day/week/month
- Severity: HIGH/MEDIUM/LOW
```

### Ranking by Profit Impact

| Rank | Failure | Probability | Damage | Frequency | Total Impact | Priority |
|------|---------|-------------|--------|-----------|--------------|----------|
| 1 | No risk controls | 0.9 | $500-1000 | 1/week | **CRITICAL** | IMMEDIATE |
| 2 | Paper/live separation | 0.3 | $10000 | rare | **CRITICAL** | IMMEDIATE |
| 3 | Edge scoring pattern-match | 0.8 | $100-200 | 1/day | **HIGH** | WEEK 1 |
| 4 | LLM consensus fallback | 0.7 | $50-100 | 1/day | **HIGH** | WEEK 1 |
| 5 | Agent direction rules | 0.6 | $50-100 | 1/day | **HIGH** | WEEK 1 |
| 6 | Readiness score gaming | 0.5 | $30-50 | 1/week | MEDIUM | WEEK 2 |
| 7 | Volume lacks baseline | 0.4 | $20-50 | 1/week | MEDIUM | WEEK 2 |
| 8 | Momentum fallback | 0.4 | $20-30 | 1/week | MEDIUM | WEEK 2 |
| 9 | Position sizing | 0.2 | $20-50 | rare | LOW | WEEK 3 |
| 10 | Data staleness | 0.3 | $10-20 | 1/day | LOW | WEEK 3 |
| 11 | Liquidity unknown | 0.3 | $10-20 | 1/week | LOW | WEEK 3 |
| 12 | Phantom PnL oversimplified | 0.2 | $5-10 | 1/week | LOW | WEEK 3 |
| 13 | Leaderboard metrics | 0.2 | $0 | N/A | NONE | COSMETIC |
| 14 | Consensus score misleading | 0.1 | $0 | N/A | NONE | COSMETIC |
| 15 | Input validation | 0.05 | $10-20 | rare | MINIMAL | LOW |

---

## PHASE 2 TEST MATRIX VERDICT

**Tests Required Before Paper Trading**: 13 of 15

**Quick Wins** (tests pass immediately):
- ✅ Position limits (5/division) working
- ✅ Kelly criterion logic correct
- ⚠️ Wallet persistence working (but no type field)

**Must Fix Before Paper Trading**:
1. Risk controls → implement daily loss limit + auto-liquidation
2. Paper/live separation → add wallet.type field + validate
3. Cron routes → fix compilation errors
4. LLM fallback → add timeout handling
5. Edge scoring → add baseline normalization

**Can Fix While Paper Trading** (low-frequency impact):
- Volume baselines
- Momentum history tracking
- Leaderboard metrics
- Input validation

---

*Test Matrix Generated: 2026-04-14 | TRADE AI Profit-First Audit*
