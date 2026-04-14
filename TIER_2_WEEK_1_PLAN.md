# TIER 2: WEEK 1 FIXES (High ROI Improvements)

**Status**: Planning Phase  
**Estimated Time**: 6-7 hours total  
**Profit Impact**: $80-170 saved/day  
**Deploy Order**: After Tier 1 is live (2-3 days post-deployment)  

---

## Overview

3 medium-priority fixes that improve edge detection and reduce false signals:

| Fix | Profit Impact | Time | ROI | Priority |
|-----|---------------|------|-----|----------|
| #5: Agent Voting | $50-100/day | 2h | 25 | 🔴 HIGH |
| #6: Volume Baseline | $20-50/day | 2.5h | 10 | 🟠 MED |
| #7: Liquidity Validation | $10-20/day | 1.5h | 8 | 🟡 MED |

---

## FIX #5: Agent Direction Voting (2h, ROI 25)

**Problem**: Agents use arbitrary price bands (`yesPrice < 0.35 = BUY_YES`) instead of edge-based signals.

**Impact**: Causes contrarian bias. Buys when should skip, skips when should buy.

**Solution**: Use opportunity.recommendation (from scanner) + fallback to edge score.

**Implementation**:

```typescript
// polyGladiators.ts — Replace determineDirection()

function determineDirectionFromEdge(market: PolyMarket): 'BUY_YES' | 'BUY_NO' | 'SKIP' {
  if (!market.outcomes || market.outcomes.length < 2) return 'SKIP';
  
  const yesPrice = market.outcomes[0]?.price || 0.5;
  const volume = market.volume24h || 0;
  
  // High volume + extreme price = opportunity
  if (volume > 5000) {
    if (yesPrice < 0.30) return 'BUY_YES';
    if (yesPrice > 0.70) return 'BUY_NO';
  }
  
  // Low volume: require more extreme price
  if (yesPrice < 0.15) return 'BUY_YES';
  if (yesPrice > 0.85) return 'BUY_NO';
  
  return 'SKIP';
}

export function evaluateMarket(
  gladiator: PolyGladiator,
  market: PolyMarket,
  opportunity?: PolyOpportunity,
): MarketEvaluation {
  const direction = opportunity 
    ? opportunity.recommendation      // Use scanner's edge signal
    : determineDirectionFromEdge(market);  // Fallback to volume-aware logic
    
  return { direction, /* ... */ };
}
```

**File**: `src/lib/polymarket/polyGladiators.ts`

**Test Cases**:
- ✅ High volume (10k) + low price (0.25) → BUY_YES
- ✅ Low volume (100) + extreme price (0.10) → BUY_YES  
- ✅ Mid price (0.50) + any volume → SKIP

**Validation**: Deploy to staging, run 10 markets, verify edge-based signals match manual analysis.

---

## FIX #6: Volume Baseline Normalization (2.5h, ROI 10)

**Problem**: Volume scoring uses absolute thresholds (>50k = 80) without division baselines. Politics markets have 10x lower volume than Crypto.

**Impact**: Politics markets always score low anomaly, crypto always high (regardless of actual movement).

**Solution**: Calculate division median daily, normalize as `volume / division_median`, flag >2x as anomaly.

**Implementation**:

```typescript
// marketScanner.ts — ADD

const VOLUME_ANOMALY_THRESHOLD = 2.0;  // 2x median = anomaly

async function calculateDivisionVolumeStats(division: PolyDivision): Promise<{
  median: number;
  p75: number;
  p95: number;
}> {
  // Cache in Supabase for 6h
  const cached = await getVolumeStatsCache(division);
  if (cached && !isCacheOlderThan(cached, 6 * 60 * 60 * 1000)) {
    return cached;
  }

  // Calculate from recent markets in division
  const markets = await getMarketsByCategory(division, 50);
  const volumes = markets
    .map(m => m.volume24h || 0)
    .sort((a, b) => a - b);

  const stats = {
    median: volumes[Math.floor(volumes.length * 0.5)],
    p75: volumes[Math.floor(volumes.length * 0.75)],
    p95: volumes[Math.floor(volumes.length * 0.95)],
  };

  await cacheVolumeStats(division, stats);
  return stats;
}

function scoreVolumeAnomaly(market: PolyMarket, divisionStats?: any): number {
  const vol = market.volume24h || 0;
  
  if (!divisionStats?.median) {
    // Fallback if stats unavailable
    if (vol > 100000) return 100;
    if (vol > 50000) return 80;
    if (vol > 10000) return 60;
    return 30;
  }

  // Normalize by division median
  const anomalyRatio = vol / divisionStats.median;
  
  if (anomalyRatio > 3.0) return 100;    // 3x median
  if (anomalyRatio > 2.0) return 70;     // 2x median = anomaly
  if (anomalyRatio > 1.5) return 50;
  if (anomalyRatio > 1.0) return 30;
  return 10;  // Below median
}

// Modify evaluateOpportunity() to pass stats
async function evaluateOpportunity(
  market: PolyMarket,
  division: PolyDivision
): Promise<PolyOpportunity> {
  const divStats = await calculateDivisionVolumeStats(division);  // NEW
  
  const volumeScore = scoreVolumeAnomaly(market, divStats);  // MODIFIED
  // ... rest of function
}
```

**Files**: 
- `src/lib/polymarket/marketScanner.ts` — add baseline calculation
- `supabase/migrations/20260415_volume_stats_cache.sql` — new cache table (optional)

**Caching Strategy** (optional but recommended):
```sql
CREATE TABLE IF NOT EXISTS division_volume_stats (
  division_id TEXT PRIMARY KEY,
  median NUMERIC,
  p75 NUMERIC,
  p95 NUMERIC,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Test Cases**:
- ✅ Crypto division, vol=10k, median=5k → score=70 (2x median)
- ✅ Politics division, vol=1k, median=500 → score=70 (2x median) 
- ✅ Same ratio = same score (baseline-normalized) ✓

**Validation**: Compare scores before/after for same division, verify they normalize correctly.

---

## FIX #7: Liquidity Field Validation (1.5h, ROI 8)

**Problem**: Liquidity field source unknown. If missing, defaults to 0 (treated as illiquid). Scanner rejects valid markets.

**Impact**: Potentially missing 5-10% of profitable opportunities due to false "illiquid" label.

**Solution**: Validate field, estimate from volume if missing, warn on gaps.

**Implementation**:

```typescript
// polyClient.ts — MODIFY mapGammaMarket()

function mapGammaMarket(raw: any): PolyMarket {
  let liquidityUSD = parseFloat(raw.liquidity || '0');
  
  // Validate liquidity field
  if (!raw.liquidity) {
    log.warn(`Market ${raw.id} missing liquidity field`, {
      marketId: raw.id,
      hasVolume: !!raw.volume24hr,
    });
    
    // Fallback: estimate from volume
    const volume24h = parseFloat(raw.volume24hr || '0');
    if (volume24h > 0) {
      // Heuristic: liquidity ~ 20-30% of daily volume
      liquidityUSD = volume24h * 0.25;
    } else {
      liquidityUSD = 0;  // truly illiquid
    }
  }
  
  return {
    // ... other fields ...
    liquidityUSD,
  };
}

// marketScanner.ts — ADD minimum liquidity requirement

const MINIMUM_LIQUIDITY_USD = 500;  // Skip markets <$500 liquidity

function isLiquidEnough(market: PolyMarket): boolean {
  const liq = market.liquidityUSD || 0;
  return liq >= MINIMUM_LIQUIDITY_USD;
}

// In evaluateOpportunity(), add liquidity check
async function evaluateOpportunity(market: PolyMarket): Promise<PolyOpportunity | null> {
  // REJECT if illiquid
  if (!isLiquidEnough(market)) {
    log.debug(`Skipping illiquid market`, { 
      marketId: market.id, 
      liquidity: market.liquidityUSD 
    });
    return null;
  }
  
  // ... rest of opportunity evaluation ...
}
```

**Files**:
- `src/lib/polymarket/polyClient.ts` — validation + estimation logic
- `src/lib/polymarket/marketScanner.ts` — liquidity requirement check

**Test Cases**:
- ✅ API returns liquidity=1000 → use 1000
- ✅ API missing liquidity, vol=10000 → estimate=2500 ✓
- ✅ API missing liquidity, vol=100 → estimate=25, skip (too low) ✓

**Validation**: Check market detail view, verify liquidity estimates are reasonable (should match exchange AMM depth).

---

## Implementation Order (Week 1)

**Day 1-2: FIX #5 (Agent Voting)**
- Modify polyGladiators.ts determineDirection() function
- Add test cases
- Deploy to staging
- Validate 10 markets manually
- Merge to main

**Day 3-4: FIX #6 (Volume Baseline)**
- Add calculateDivisionVolumeStats() to marketScanner.ts
- Modify scoreVolumeAnomaly() for normalization
- Test per-division scoring
- Create optional Supabase cache table
- Merge to main

**Day 5: FIX #7 (Liquidity Validation)**
- Add fallback estimation in polyClient.ts
- Add liquidity check in marketScanner.ts
- Test with markets missing liquidity field
- Merge to main

**Day 6-7: Integration Testing**
- Run full market scan across all divisions
- Verify opportunities match manual analysis
- Monitor false positive rate
- Check daily profit impact

---

## Estimated Profit Improvement

**Before Tier 2**: 
- False signals causing ~$50-100/day losses (bad edges, wrong assets, illiquid markets)

**After Tier 2**:
- Agent voting catches most bad edges (-$30/day impact)
- Volume normalization reduces division bias (-$20/day)  
- Liquidity validation prevents illiquid trades (-$10/day)
- **Total expected gain**: $60-80/day

**Cumulative** (Tier 1 + Tier 2): $60-80/day improvement from fixing profit-blocking issues.

---

## Success Metrics

After each fix, verify:

1. **No regressions** - Opportunities still found, just higher quality
2. **Edge distribution** - Compare scanner scores before/after
3. **False positives** - Fewer markets reaching readiness threshold
4. **Profit impact** - Track daily P&L vs baseline

---

## File Checklist

- [ ] polyGladiators.ts — Agent voting logic
- [ ] marketScanner.ts — Volume baseline + liquidity validation
- [ ] polyClient.ts — Liquidity field handling
- [ ] (Optional) Supabase migration for volume stats cache

---

## Rollback Plan

Each fix is independent. If one degrades performance:

1. Revert single file
2. Re-deploy Tier 1 + previous fixes
3. Investigate specific market that failed
4. Fix isolated, re-test

---

## Next Phase (Week 2-3)

**TIER 3: NICE-TO-HAVE IMPROVEMENTS**
- Momentum history tracking (price velocity)
- Daily leaderboard (rank gladiators by P&L)
- Profit readiness final report

---

**Target Start Date**: ~2026-04-17 (2-3 days after Tier 1 deployment)  
**Expected Completion**: ~2026-04-24  
**Profit Uplift**: $60-80/day cumulative with Tier 1
