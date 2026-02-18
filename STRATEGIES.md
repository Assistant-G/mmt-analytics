# MMT Tight-Range LP Strategies

## Core Insight

**Problem**: Wide range = Low APY, Safe
**Solution**: Tight range = High APY, but goes out of range quickly
**Innovation**: Auto-cycle tight ranges = **10-100x higher APY** + Always in range

---

## Current Implementation

### 1. **Time-Based Tight Range Cycling** ⏰ (IMPLEMENTED)

**How it works:**
- Set tight range (e.g., ±2%)
- Set timer (e.g., 30 min, 1 hour, 4 hours)
- When timer expires → close position → reopen at current price

**Pros:**
- ✅ Simple and predictable
- ✅ Always recenters to current price
- ✅ Maximum fee collection in stable markets

**Cons:**
- ❌ May close when still in range (wasting gas)
- ❌ Fixed schedule doesn't adapt to volatility
- ❌ Could reopen just before big price move

**Best for:**
- Stable pairs (USDC/USDT, wBTC/tBTC)
- Low volatility periods
- Pairs that trend sideways

**Parameters:**
```typescript
range_bps: 200-500 (2-5%)
timer: 1-4 hours for stablecoins
        4-8 hours for volatile pairs
max_cycles: infinite
```

---

## Proposed New Strategies

### 2. **Out-of-Range Detection** 🎯 (HIGH PRIORITY)

**How it works:**
- Monitor current price vs position range
- Only rebalance when position goes **actually out of range**
- Uses pool's `sqrtPrice` vs position's `tickLower/tickUpper`

**Logic:**
```typescript
if (currentTick < tickLower || currentTick > tickUpper) {
  // Position is out of range → close & reopen
  executeRebalance();
}
```

**Pros:**
- ✅ Maximizes time in range = maximum fees
- ✅ No wasted gas on unnecessary rebalances
- ✅ Adaptive to volatility

**Cons:**
- ❌ Need to monitor chain continuously
- ❌ During high volatility, may miss some fees

**Best for:**
- All pairs
- Maximizing capital efficiency
- Reducing transaction costs

**Implementation requirements:**
- Backend: Poll pool price every 30-60 seconds
- Smart contract: Add check for out-of-range condition
- Frontend: Show "in range" / "out of range" status

---

### 3. **Divergence Loss Protection** 🛡️ (CRITICAL FOR RISK MANAGEMENT)

**How it works:**
- Track divergence loss (impermanent loss) in real-time
- If divergence loss > fees earned + buffer → close position
- Prevents holding positions during unfavorable price movements

**Logic:**
```typescript
// Calculate divergence loss
const hodlValue = initialAmountA * currentPrice + initialAmountB;
const lpValue = currentAmountA * currentPrice + currentAmountB + feesCollected;
const divergenceLoss = hodlValue - lpValue;
const netPnL = feesCollected - divergenceLoss;

if (divergenceLoss > (feesCollected * 1.5)) {
  // Divergence loss exceeds fees by 50% → close
  executeRebalance();
}
```

**Pros:**
- ✅ Protects capital during adverse moves
- ✅ Ensures LP stays profitable vs HODLing
- ✅ Can be combined with other strategies

**Cons:**
- ❌ Complex calculation
- ❌ May exit too early in temporary dips

**Best for:**
- Volatile pairs (SUI/USDC, etc.)
- Risk-averse users
- Combining with profit targets

**Parameters:**
```typescript
maxDivergenceLossPercent: 2-5% // Close if IL > this
minFeeBuffer: 1.5x // Fees must exceed IL by this much
checkInterval: 5 minutes
```

---

### 4. **Asymmetric Range (Trend Following)** 📈📉

**How it works:**
- Detect trend direction (EMA crossover, etc.)
- If **bullish**: wider upper range, tighter lower
- If **bearish**: wider lower range, tighter upper
- If **neutral**: symmetric range

**Example:**
```typescript
// Bullish trend detected
tickLower = currentTick - 100 // -1%
tickUpper = currentTick + 500 // +5%

// Bearish trend detected
tickLower = currentTick - 500 // -5%
tickUpper = currentTick + 100 // +1%

// Neutral
tickLower = currentTick - 300 // -3%
tickUpper = currentTick + 300 // +3%
```

**Pros:**
- ✅ Captures more fees in trending markets
- ✅ Reduces rebalancing frequency
- ✅ Adapts to market conditions

**Cons:**
- ❌ Needs reliable trend detection
- ❌ Can be wrong-footed on reversals

**Best for:**
- Trending markets
- Pairs with clear momentum
- Longer hold periods

**Implementation:**
```typescript
// Simple trend detection
const ema20 = calculateEMA(prices, 20);
const ema50 = calculateEMA(prices, 50);
const trend = ema20 > ema50 ? 'bullish' :
              ema20 < ema50 ? 'bearish' : 'neutral';
```

---

### 5. **Volatility-Adaptive Range** 📊

**How it works:**
- Calculate recent volatility (standard deviation of returns)
- High volatility → slightly wider ranges (±5-8%)
- Low volatility → tighter ranges (±1-3%)
- Auto-adjust timer based on volatility

**Logic:**
```typescript
const volatility = calculateVolatility(priceHistory, period=24h);

if (volatility > 20%) {
  range_bps = 800; // ±8%
  timer = 2 hours;
} else if (volatility > 10%) {
  range_bps = 500; // ±5%
  timer = 4 hours;
} else {
  range_bps = 200; // ±2%
  timer = 8 hours;
}
```

**Pros:**
- ✅ Adapts to market conditions automatically
- ✅ Balance between tight range and staying in range
- ✅ Reduces gas costs in stable periods

**Cons:**
- ❌ Historical volatility ≠ future volatility
- ❌ More complex logic

**Best for:**
- Pairs with variable volatility
- Advanced users
- Long-term automated strategies

---

### 6. **Profit Target + Stop Loss** 🎯🛑

**How it works:**
- Set profit target (e.g., +5% PnL)
- Set stop loss (e.g., -2% PnL)
- Close position when either is hit
- Combines time-based with PnL-based triggers

**Logic:**
```typescript
const pnlPercent = calculatePnL();

if (pnlPercent >= profitTarget) {
  closePosition(); // Take profits
  if (autoReinvest) reopenPosition();
}

if (pnlPercent <= -stopLoss) {
  closePosition(); // Cut losses
  if (retryAfterCooldown) {
    waitCooldown(1 hour);
    reopenPosition();
  }
}
```

**Pros:**
- ✅ Clear profit-taking mechanism
- ✅ Risk management built-in
- ✅ Emotion-free execution

**Cons:**
- ❌ May exit too early
- ❌ Stop loss can lock in losses during dips

**Best for:**
- Active traders
- Volatile pairs
- Users who want defined risk/reward

**Parameters:**
```typescript
profitTarget: 3-10% PnL
stopLoss: 1-3% PnL
cooldownPeriod: 30min - 2hours
autoReinvest: true/false
```

---

### 7. **Fee Velocity Strategy** 💰

**How it works:**
- Track fee collection rate (fees per hour)
- If fee velocity drops below threshold → likely out of range or low volume
- Rebalance to higher-volume range or tighter range

**Logic:**
```typescript
const feesPerHour = calculateFeeVelocity();
const expectedFeesPerHour = tvl * expectedAPR / 365 / 24;

if (feesPerHour < expectedFeesPerHour * 0.3) {
  // Earning < 30% of expected → rebalance
  executeRebalance();
}
```

**Pros:**
- ✅ Focuses on actual fee generation
- ✅ Responds to volume changes
- ✅ Maximizes yield

**Cons:**
- ❌ Needs historical fee data
- ❌ May be slow to react

**Best for:**
- Maximizing fee collection
- Pairs with variable volume
- Long-term positions

---

### 8. **Multi-Range Portfolio** 🎯🎯🎯

**How it works:**
- Split capital into multiple positions with different ranges
- **Position 1**: Tight (±2%) - 50% capital - highest APY
- **Position 2**: Medium (±5%) - 30% capital - balance
- **Position 3**: Wide (±10%) - 20% capital - always earning

**Example:**
```typescript
vault1: range_bps=200, amount=50% // Tight range
vault2: range_bps=500, amount=30% // Medium range
vault3: range_bps=1000, amount=20% // Wide range
```

**Pros:**
- ✅ Diversification reduces risk
- ✅ Always have some position earning
- ✅ Balanced approach

**Cons:**
- ❌ More complex management
- ❌ More gas costs
- ❌ Lower capital efficiency

**Best for:**
- Large capital allocations
- Risk-averse users
- Uncertain market conditions

---

## Combination Strategies (RECOMMENDED)

### Strategy A: **Smart Rebalancing** (Best Overall)

Combines:
1. Out-of-range detection (primary trigger)
2. Max timer (safety backup - e.g., 24h)
3. Divergence loss protection (risk management)

```typescript
const strategy = {
  primary: 'out-of-range',
  maxTimer: 24 * 3600, // 24 hours max
  divergenceLossLimit: 3%, // Stop if IL > 3%
  range_bps: 300, // ±3%
}
```

**Result**: Maximum efficiency + Safety

---

### Strategy B: **Aggressive Yield Farming**

Combines:
1. Very tight range (±1-2%)
2. Time-based cycling (short intervals)
3. Volatility-adaptive
4. Fee velocity monitoring

```typescript
const strategy = {
  range_bps: 100-200, // ±1-2%
  timer: 'adaptive', // 1-4 hours based on volatility
  minFeeVelocity: 'high',
  rebalanceOnLowFees: true,
}
```

**Result**: Maximum APY, higher gas costs, requires stable markets

---

### Strategy C: **Conservative Yield**

Combines:
1. Medium range (±5%)
2. Longer timers (8-12 hours)
3. Profit target + stop loss
4. Pause during extreme volatility

```typescript
const strategy = {
  range_bps: 500, // ±5%
  timer: 8-12 hours,
  profitTarget: 5%,
  stopLoss: 2%,
  pauseIfVolatility: > 30%,
}
```

**Result**: Lower APY but more stable, lower gas costs

---

## How to Avoid Impermanent Loss

### Understanding IL in Tight Ranges

**Formula:**
```
IL = (2 * sqrt(price_ratio) / (1 + price_ratio)) - 1
```

For tight ranges, IL compounds differently:
- **±2% price move**: ~0.02% IL
- **±5% price move**: ~0.12% IL
- **±10% price move**: ~0.5% IL
- **±50% price move**: ~5.7% IL

**Key insight**: Frequent rebalancing **resets** the IL calculation!

### IL Mitigation Strategies

#### 1. **Frequent Recentering** (Current Approach)
- Rebalance every X hours
- Each rebalance resets IL to 0
- Net effect: IL never accumulates significantly

#### 2. **Fee Earnings Must Exceed IL**
```typescript
const breakEvenAPR = estimatedPriceVolatility * rebalanceFrequency;
// Example: 10% daily volatility, 4x/day rebalancing → need >40% APR
```

#### 3. **Directional Positioning**
- If expecting price up → skew range upward
- If expecting price down → skew range downward
- Reduces IL by following the trend

#### 4. **Pair Selection**
- **Low IL pairs**: Stablecoins (USDC/USDT), correlated assets (ETH/stETH)
- **High IL pairs**: Uncorrelated (SUI/USDC)
- Choose based on risk tolerance

#### 5. **Dynamic Exit**
- Exit when IL > accumulated fees
- Use stop-loss on total PnL
- Don't fight strong trends

---

## Market Movement Strategies

### When Market Moves UP 📈

**Option 1: Follow the trend**
```typescript
// Shift range upward
tickLower = currentTick - 100
tickUpper = currentTick + 500
```

**Option 2: Take profits & recenter**
```typescript
// Close position
// Convert accumulated tokenA → tokenB at higher price
// Reopen centered range
```

**Option 3: Wider range**
```typescript
// If expecting more volatility
range_bps = 800 // ±8%
```

### When Market Moves DOWN 📉

**Option 1: Follow the trend**
```typescript
// Shift range downward
tickLower = currentTick - 500
tickUpper = currentTick + 100
```

**Option 2: Cut losses**
```typescript
// If trending strongly down
if (pnl < -2%) {
  closePosition();
  waitForReversal();
}
```

**Option 3: Accumulate**
```typescript
// If bullish long-term
// Stay in position, collect fees
// Accumulate more tokenA at lower prices
```

### When Market is CHOPPY 🔄

**Best strategy: Tight range + frequent rebalancing**
```typescript
range_bps = 200 // ±2%
timer = 2-4 hours
strategy = 'out-of-range'
```

**Why**: Choppy markets = high volume = high fees, but need tight ranges to capture

---

## Implementation Priorities

### Phase 1: High Impact (Implement First)
1. ✅ **Out-of-range detection** - Maximizes efficiency
2. ✅ **Divergence loss protection** - Risk management
3. ✅ **Profit target + Stop loss** - User control

### Phase 2: Advanced Features
4. **Volatility-adaptive ranges** - Auto-optimization
5. **Fee velocity monitoring** - Performance tracking
6. **Asymmetric ranges** - Trend following

### Phase 3: Professional Tools
7. **Multi-range portfolio** - Diversification
8. **Advanced analytics** - Strategy backtesting
9. **Strategy marketplace** - Community strategies

---

## Code Changes Needed

### Smart Contract Updates

```move
// Add to cycling_vault.move
public struct VaultStrategy has store {
  strategy_type: u8, // 0=time, 1=out-of-range, 2=pnl, 3=combined
  max_divergence_loss_bps: u64, // e.g., 300 = 3%
  profit_target_bps: u64, // e.g., 500 = 5%
  stop_loss_bps: u64, // e.g., 200 = 2%
  check_out_of_range: bool,
  trend_bias: u8, // 0=neutral, 1=bullish, 2=bearish
}
```

### Backend Service Updates

```typescript
// vault-service.ts additions

async function checkOutOfRange(vault, pool) {
  const currentTick = pool.currentTick;
  const position = await getPosition(vault.positionId);

  return currentTick < position.tickLower ||
         currentTick > position.tickUpper;
}

async function calculateDivergenceLoss(vault, pool) {
  // Get initial amounts and prices
  // Calculate HODL value vs LP value
  // Return divergence loss percentage
}

async function shouldExecuteCycle(vault, pool) {
  // Check all conditions
  const timerExpired = Date.now() >= vault.nextExecutionAt;
  const outOfRange = await checkOutOfRange(vault, pool);
  const excessiveDivergence = await calculateDivergenceLoss(vault, pool) > vault.maxDivergenceLoss;

  return timerExpired || outOfRange || excessiveDivergence;
}
```

### Frontend Components

```typescript
// New component: StrategySelector.tsx
const strategies = [
  { id: 'time-based', name: 'Time-Based', risk: 'low' },
  { id: 'out-of-range', name: 'Out-of-Range', risk: 'medium' },
  { id: 'smart-rebalance', name: 'Smart Rebalancing', risk: 'low' },
  { id: 'aggressive', name: 'Aggressive Yield', risk: 'high' },
  { id: 'conservative', name: 'Conservative', risk: 'low' },
];
```

---

## Expected Results

### Current (Time-Based Only)
- APY: 50-200% (vs 5-20% wide range)
- Gas costs: Medium (fixed schedule)
- IL risk: Low (frequent recentering)

### With Smart Rebalancing
- APY: **70-300%** (less wasted rebalances)
- Gas costs: **30-50% lower** (only when needed)
- IL risk: **Very Low** (divergence protection)

### With Full Strategy Suite
- APY: **100-500%+** (optimal strategy selection)
- Gas costs: **Minimized** (efficient execution)
- IL risk: **Customizable** (user risk tolerance)
- User satisfaction: **High** (control + automation)

---

## Conclusion

The key to maximizing returns with tight ranges is:

1. **Always stay in range** → Out-of-range detection
2. **Minimize IL** → Frequent rebalancing + divergence protection
3. **Adapt to conditions** → Volatility-aware + trend-following
4. **Manage risk** → Stop loss + profit targets
5. **Optimize costs** → Only rebalance when needed

**Recommended immediate implementation**:
- Out-of-range detection (backend + contract)
- Divergence loss monitoring (backend)
- PnL-based triggers (contract)
- Strategy presets (frontend)

This will transform the project from "automated time-based cycling" to **"intelligent adaptive market making"** 🚀
