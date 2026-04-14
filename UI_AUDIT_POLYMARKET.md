# UI AUDIT: Polymarket Page

**Status**: Code review for profit-critical issues  
**File**: `src/app/polymarket/page.tsx` (831 lines)  
**Focus**: Loss prevention, data accuracy, user action validation

---

## 🔍 Issues Found (Profit-Critical)

### 1. ⚠️ NO LOSS LIMIT WARNING DISPLAY

**Severity**: 🔴 CRITICAL  
**Impact**: User trades into loss limits without warning

**Current State**:
- Loss limits enforced in backend (checkLossLimits returns {canTrade, reason})
- **UI never displays reason or prevents trade**
- User sees "trade executed" even if backend rejected it

**Evidence**:
- No `loss` state variable
- No check of `checkLossLimits.reason` in trade execution
- No modal/toast warning for daily/position limits

**Fix Required**:

```typescript
// Add to state:
const [tradeWarning, setTradeWarning] = useState<string | null>(null);

// Before openPosition() call:
const positionLoss = calculateUnrealizedLoss(position);  // NEW
if (positionLoss < -25) {
  setTradeWarning('Position loss would exceed -$25 limit');
  return;  // Don't execute
}

if (wallet?.dailyRealizedPnL < -50) {
  setTradeWarning('Daily loss limit reached (-$50)');
  return;  // Don't execute
}

// Display warning:
{tradeWarning && (
  <div style={{color: C.red, padding: '12px', border: `1px solid ${C.red}`}}>
    ⚠️ {tradeWarning}
  </div>
)}
```

**Priority**: 🔴 FIX BEFORE DEPLOYING (prevents UI confusion)

---

### 2. ⚠️ MARKET DETAIL VIEW MISSING CRITICAL DATA

**Severity**: 🟠 HIGH  
**Impact**: Can't see liquidity/volume before trading

**Current State**:
- Markets component shows: id, title, outcomes, volume24h, liquidityUSD, endDate, active
- **Market detail modal/page doesn't exist**
- User clicks market → no detail view, no ability to inspect before trade

**Evidence**:
- Line 400+: `<div onClick={() => setSelectedMarket(m)}>` but no detail panel
- No modal rendering selected market data
- No way to see liquidity/edge/analyst view before trading

**Fix Required**:

```typescript
// Add market detail modal:

{selectedMarket && (
  <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
               bg: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', 
               alignItems: 'center', justifyContent: 'center'}}>
    <div style={{bg: C.border, padding: '24px', borderRadius: '8px', 
                 maxWidth: '500px', color: C.text}}>
      <h2>{selectedMarket.title}</h2>
      <div>Volume 24h: ${selectedMarket.volume24h.toLocaleString()}</div>
      <div>Liquidity: ${selectedMarket.liquidityUSD.toLocaleString()}</div>
      <div>Ends: {selectedMarket.endDate}</div>
      <div style={{marginTop: '16px'}}>
        {selectedMarket.outcomes.map(o => (
          <div key={o.name}>
            {o.name}: {(o.price * 100).toFixed(0)}%
          </div>
        ))}
      </div>
      <button onClick={() => setSelectedMarket(null)}>Close</button>
    </div>
  </div>
)}
```

**Priority**: 🟠 ADD IN NEXT ITERATION (UX, not critical)

---

### 3. ⚠️ ANALYST VIEW NOT INTEGRATED

**Severity**: 🟠 HIGH  
**Impact**: Can't see LLM consensus before trading

**Current State**:
- `analyst` function exists in page but **never called**
- No display of architect/oracle scores
- No reasoning shown for trade recommendations

**Evidence**:
- Line 350+: `analyst()` function defined but not invoked anywhere
- Market detail shows only price, not edge analysis
- Gladiator page shows readiness but not per-market rationale

**Fix Required**:

```typescript
// In market detail modal, add analyst view:

const analysis = await analyst(selectedMarket.id, selectedDivision);

<div style={{marginTop: '16px', padding: '12px', bg: 'rgba(200,100,200,0.1)', borderRadius: '4px'}}>
  <div><strong>Analyst View</strong></div>
  <div>Architect: {analysis?.architect?.score}% - {analysis?.architect?.reasoning}</div>
  <div>Oracle: {analysis?.oracle?.score}% - {analysis?.oracle?.reasoning}</div>
  <div>Consensus: {analysis?.consensus}</div>
</div>
```

**Priority**: 🟠 ADD BEFORE WEEK 1 (important for trade confidence)

---

### 4. ⚠️ NO TRADE CONFIRMATION

**Severity**: 🟠 MEDIUM  
**Impact**: Accidental trades on touch/click

**Current State**:
- `executeTrade()` fires on button click immediately
- No confirmation, no "are you sure?" dialog
- No display of exact bet amount/odds before execution

**Evidence**:
- Line ~600: `onClick={() => executeTrade(...)}`
- No Modal/Dialog component shown before trade

**Fix Required**:

```typescript
const [tradeConfirm, setTradeConfirm] = useState<any | null>(null);

// On button click:
onClick={() => setTradeConfirm({market, direction, amount})}

// Render confirmation:
{tradeConfirm && (
  <ConfirmationModal 
    title={`Execute Trade: ${tradeConfirm.direction}`}
    market={tradeConfirm.market}
    onConfirm={() => executeTrade(tradeConfirm); setTradeConfirm(null)}
    onCancel={() => setTradeConfirm(null)}
  />
)}
```

**Priority**: 🟠 ADD BEFORE LIVE TRADING

---

### 5. ⚠️ DAILY P&L NOT DISPLAYED

**Severity**: 🟠 MEDIUM  
**Impact**: Can't see if hitting daily loss limit

**Current State**:
- `wallet.realizedPnL` shown but **doesn't differentiate daily vs lifetime**
- User doesn't know they're approaching -$50 daily limit
- No "daily loss: -$42 / -$50" indicator

**Evidence**:
- Wallet tab shows total P&L, not segmented by day
- No progress bar or warning for daily limit
- No reset indicator (what time does daily reset?)

**Fix Required**:

```typescript
// In wallet display:

const dailyLoss = wallet.realizedPnL;  // Assuming realizedPnL is daily
const dailyLossPercent = Math.abs(dailyLoss) / 50 * 100;

<div style={{marginTop: '12px'}}>
  <div>Daily Loss Limit</div>
  <div style={{position: 'relative', height: '8px', bg: C.borderLight, 
               borderRadius: '4px', overflow: 'hidden'}}>
    <div style={{height: '100%', width: `${Math.min(dailyLossPercent, 100)}%`, 
                 bg: dailyLossPercent > 80 ? C.red : dailyLossPercent > 50 ? C.yellow : C.green}}/>
  </div>
  <div style={{fontSize: '12px', color: C.muted}}>
    ${Math.abs(dailyLoss).toFixed(2)} / $50.00 
    {dailyLossPercent > 90 && ' ⚠️ APPROACHING LIMIT'}
  </div>
</div>
```

**Priority**: 🟠 ADD BEFORE LIVE TRADING

---

### 6. ⚠️ NO COOLDOWN AFTER LOSS LIMIT HIT

**Severity**: 🟡 LOW  
**Impact**: User keeps clicking trade button after hitting limit

**Current State**:
- If daily loss limit hit, trade is rejected
- **No UI feedback that limit was hit**
- User might click 10 more times wondering why it won't go through

**Evidence**:
- No `lastTradeError` state display
- No "Daily loss limit reached, trading paused until midnight UTC" message

**Fix Required**:

```typescript
const [lastTradeError, setLastTradeError] = useState<string | null>(null);

// After executeTrade fails:
if (response.status === 403) {  // Loss limit
  setLastTradeError('Daily loss limit reached. Trading paused until midnight UTC.');
  setTimeout(() => setLastTradeError(null), 5000);  // Clear after 5s
}

// Display:
{lastTradeError && (
  <div style={{bg: 'rgba(255,61,87,0.2)', border: `1px solid ${C.red}`,
               color: C.red, padding: '12px', borderRadius: '4px', marginBottom: '12px'}}>
    {lastTradeError}
  </div>
)}
```

**Priority**: 🟡 LOW (informational)

---

## ✅ What's Working Well

1. **Division selector** - Clean tabs, easy to switch
2. **Gladiator status display** - Clear visual for LIVE/READY/TRAINING
3. **Market list** - Scrollable, shows volume + liquidity
4. **Auto-refresh** - Toggle works, prevents stale data
5. **Logs panel** - Good for debugging, shows scan results

---

## 📋 Pre-Deployment Checklist

Before deploying Tier 1:

- [ ] Add loss limit warning display (CRITICAL)
- [ ] Add trade confirmation modal (HIGH)
- [ ] Display daily P&L progress bar (HIGH)
- [ ] Show analyst view in market detail (HIGH)
- [ ] Add error message for failed trades (MEDIUM)

Can deploy without these, but **recommend adding items 1-3 before live trading**.

---

## 🎯 Post-Deployment Fixes (Week 2)

After Tier 1 deploys and validates:

1. **Week 1**: Implement loss limit warning + trade confirmation
2. **Week 2**: Add market detail modal + analyst view
3. **Week 3**: Add daily P&L indicator, analyst reasoning

---

## Code Quality Notes

**Positive**:
- Proper TypeScript interfaces for all data types
- Good component organization (divisions, gladiators, scanner, markets, wallet)
- Auto-refresh logic with configurable interval
- Responsive color scheme matches dark theme

**Could Improve**:
- Extract modal/dialog components to separate files
- Add React Context for shared state (currently all in one component)
- Add loading skeleton for initial page load
- Add error boundary for API failures

---

**Current UI Ready For**: Basic market viewing, gladiator inspection  
**Still Needs Before Live Trading**: Loss limit warnings, trade confirmation, daily P&L display

