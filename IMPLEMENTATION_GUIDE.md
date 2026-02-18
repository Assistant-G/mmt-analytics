# Strategy Implementation Guide

## What We Created

This guide shows how to implement the advanced strategies for tight-range LP position cycling.

---

## Files Created

### 1. **STRATEGIES.md**
Comprehensive document explaining:
- Why tight ranges work (10-100x APY boost)
- 8 different strategy types
- How to avoid impermanent loss
- What to do when market moves up/down
- Expected results and priorities

### 2. **src/types/strategies.ts**
TypeScript types for all strategies:
- Strategy interfaces for each type
- Strategy presets (5 ready-to-use configs)
- Helper functions
- Risk level definitions

### 3. **src/utils/strategyCalculations.ts**
Calculation utilities:
- Divergence loss (IL) calculations
- Out-of-range detection
- Volatility calculations
- Trend detection (EMA crossover)
- Fee velocity monitoring
- Optimal parameter recommendations

---

## Implementation Roadmap

### Phase 1: Backend Enhancements (HIGH PRIORITY)

#### 1.1 Out-of-Range Detection

**File**: `contracts/mmt_automation/backend/vault-service.ts`

Add this function:

```typescript
async function isPositionOutOfRange(
  vaultId: string,
  poolId: string
): Promise<boolean> {
  try {
    // Get pool current tick
    const pool = await fetchPool(poolId);
    const currentTick = pool.currentTick;

    // Get position ticks from vault
    const position = await getVaultPosition(vaultId);
    if (!position) return false;

    const { tickLower, tickUpper } = position;

    // Check if out of range
    const outOfRange = currentTick < tickLower || currentTick > tickUpper;

    if (outOfRange) {
      console.log(`🎯 Vault ${vaultId} is OUT OF RANGE`, {
        currentTick,
        tickLower,
        tickUpper,
        priceMove: ((currentTick - (tickLower + tickUpper) / 2) / 100).toFixed(2) + '%'
      });
    }

    return outOfRange;
  } catch (error) {
    console.error('Error checking out-of-range:', error);
    return false;
  }
}
```

Update `shouldExecuteCycle`:

```typescript
async function shouldExecuteCycle(
  vault: VaultInfo,
  pool: PoolInfo
): Promise<{ should: boolean; reason: string }> {
  // 1. Check if paused
  if (!vault.is_active) {
    return { should: false, reason: 'Vault is paused' };
  }

  // 2. Check max cycles
  if (vault.max_cycles !== 0 && vault.cycles_completed >= vault.max_cycles) {
    return { should: false, reason: 'Max cycles reached' };
  }

  // 3. Check if position exists
  if (!vault.has_position) {
    return { should: false, reason: 'No position to cycle' };
  }

  // 4. PRIMARY CHECK: Out of range? (NEW!)
  const outOfRange = await isPositionOutOfRange(vault.id, vault.pool_id);
  if (outOfRange) {
    return { should: true, reason: '🎯 Position out of range - rebalancing' };
  }

  // 5. BACKUP CHECK: Timer expired?
  const currentTime = Date.now();
  const timerExpired = currentTime >= vault.next_execution_at;
  if (timerExpired) {
    return { should: true, reason: '⏰ Timer expired - rebalancing' };
  }

  // 6. SAFETY CHECK: Divergence loss too high? (NEW!)
  const divergenceLoss = await calculateDivergenceLoss(vault);
  const maxDivergenceLoss = 3; // 3% max IL
  if (divergenceLoss > maxDivergenceLoss) {
    return { should: true, reason: `🛡️ Divergence loss ${divergenceLoss.toFixed(2)}% > ${maxDivergenceLoss}% - rebalancing` };
  }

  return { should: false, reason: 'All conditions normal' };
}
```

#### 1.2 Divergence Loss Monitoring

```typescript
async function calculateDivergenceLoss(vault: VaultInfo): Promise<number> {
  try {
    // Get position details
    const position = await getVaultPosition(vault.id);
    if (!position) return 0;

    // Get initial and current prices
    const initialPrice = position.openPrice; // Need to store this
    const pool = await fetchPool(vault.pool_id);
    const currentPrice = tickToPrice(pool.currentTick, pool.decimalsA, pool.decimalsB);

    // Calculate price ratio change
    const priceRatio = currentPrice / initialPrice;

    // IL formula: 2 * sqrt(k) / (1 + k) - 1
    const sqrtRatio = Math.sqrt(priceRatio);
    const il = (2 * sqrtRatio) / (1 + priceRatio) - 1;

    return Math.abs(il) * 100; // Return as percentage
  } catch (error) {
    console.error('Error calculating divergence loss:', error);
    return 0;
  }
}

function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  const price = Math.pow(1.0001, tick);
  const decimalAdjustment = Math.pow(10, decimalsB - decimalsA);
  return price * decimalAdjustment;
}
```

#### 1.3 Enhanced Logging

```typescript
async function monitorVault(vaultId: string) {
  const vault = await getVaultInfo(vaultId);
  const pool = await fetchPool(vault.pool_id);

  const { should, reason } = await shouldExecuteCycle(vault, pool);

  console.log(`
┌─────────────────────────────────────────────────
│ Vault: ${vaultId.slice(0, 8)}...
│ Pool: ${pool.tokenA}/${pool.tokenB}
│ Status: ${vault.has_position ? '🟢 Active Position' : '⚪ No Position'}
│
│ Price: $${pool.currentPrice.toFixed(4)}
│ Current Tick: ${pool.currentTick}
│ ${vault.has_position ? `Range: ${vault.tickLower} - ${vault.tickUpper}` : ''}
│ ${vault.has_position ? `In Range: ${pool.currentTick >= vault.tickLower && pool.currentTick <= vault.tickUpper ? '✅' : '❌'}` : ''}
│
│ Cycles: ${vault.cycles_completed}${vault.max_cycles > 0 ? `/${vault.max_cycles}` : ' (infinite)'}
│ Next Execution: ${new Date(vault.next_execution_at).toISOString()}
│ Time Until: ${Math.max(0, vault.next_execution_at - Date.now()) / 1000 / 60} min
│
│ Decision: ${should ? '🚀 EXECUTE CYCLE' : '⏸️  Hold'}
│ Reason: ${reason}
└─────────────────────────────────────────────────
  `);

  if (should) {
    await executeCycle(vault, pool);
  }
}
```

---

### Phase 2: Smart Contract Updates (MEDIUM PRIORITY)

#### 2.1 Add Strategy Config to Vault

**File**: `contracts/mmt_automation/sources/cycling_vault.move`

Add to Vault struct:

```move
public struct Vault<phantom X, phantom Y> has key {
    // ... existing fields ...

    // Strategy configuration
    strategy_type: u8, // 0=time, 1=out-of-range, 2=combined
    max_divergence_loss_bps: u64, // e.g., 300 = 3% max IL
    check_out_of_range: bool,
    min_time_between_rebalances_ms: u64,
}
```

Update `create_vault` to accept strategy params:

```move
public fun create_vault<X, Y>(
    config: &mut VaultConfig,
    coin_x: Coin<X>,
    coin_y: Coin<Y>,
    pool_id: ID,
    range_bps: u64,
    timer_duration_ms: u64,
    max_cycles: u64,
    strategy_type: u8,  // NEW
    max_divergence_loss_bps: u64,  // NEW
    clock: &Clock,
    ctx: &mut TxContext
): Vault<X, Y> {
    // ... existing code ...

    vault.strategy_type = strategy_type;
    vault.max_divergence_loss_bps = max_divergence_loss_bps;
    vault.check_out_of_range = strategy_type >= 1; // Enable for strategies 1+
    vault.min_time_between_rebalances_ms = 1800000; // 30 min default

    // ... rest of code ...
}
```

Add helper for asymmetric ranges:

```move
public struct AsymmetricRange has store, copy, drop {
    lower_bps: u64,
    upper_bps: u64,
}

// Store as dynamic field if needed
```

---

### Phase 3: Frontend Components (MEDIUM PRIORITY)

#### 3.1 Strategy Selector Component

**File**: `src/components/StrategySelector.tsx`

```typescript
import { STRATEGY_PRESETS, type StrategyPreset } from '../types/strategies';

export function StrategySelector({
  onSelect
}: {
  onSelect: (preset: StrategyPreset) => void
}) {
  const [selected, setSelected] = useState('smart-rebalance');

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Select Strategy</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {STRATEGY_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => {
              setSelected(preset.id);
              onSelect(preset);
            }}
            className={`p-4 border rounded-lg text-left ${
              selected === preset.id ? 'border-primary bg-primary/10' : ''
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-semibold">{preset.name}</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {preset.description}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded ${
                preset.riskLevel === 'low' ? 'bg-green-500/20 text-green-500' :
                preset.riskLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-500' :
                'bg-red-500/20 text-red-500'
              }`}>
                {preset.riskLevel.toUpperCase()}
              </span>
            </div>

            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <div>Expected APY: {preset.expectedAprMultiplier} baseline</div>
              <div>Gas Cost: {preset.gasCostLevel}</div>
              <div>Best for: {preset.bestFor.join(', ')}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

#### 3.2 Update CreateVaultModal

**File**: `src/components/CreateVaultModal.tsx`

Add strategy selection:

```typescript
import { StrategySelector } from './StrategySelector';
import { STRATEGY_PRESETS } from '../types/strategies';

// In the modal:
const [selectedStrategy, setSelectedStrategy] = useState(STRATEGY_PRESETS[0]);

// Add before the range input:
<StrategySelector onSelect={setSelectedStrategy} />

// Update the range based on strategy:
useEffect(() => {
  if ('rangeBps' in selectedStrategy.strategy) {
    setRangePercent([selectedStrategy.strategy.rangeBps / 100]);
  }
}, [selectedStrategy]);
```

#### 3.3 Strategy Performance Display

**File**: `src/components/StrategyPerformance.tsx`

```typescript
export function StrategyPerformance({ vaultId }: { vaultId: string }) {
  const metrics = useStrategyMetrics(vaultId);

  return (
    <div className="space-y-4">
      <h3>Strategy Performance</h3>
      <div className="grid grid-cols-2 gap-4">
        <MetricCard
          label="Total PnL"
          value={`${metrics.netPnlPercent.toFixed(2)}%`}
          trend={metrics.netPnlPercent > 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="Fees Collected"
          value={`$${metrics.totalFeesCollected.toFixed(2)}`}
        />
        <MetricCard
          label="Divergence Loss"
          value={`${metrics.totalDivergenceLoss.toFixed(2)}%`}
          trend="neutral"
        />
        <MetricCard
          label="Time in Range"
          value={`${metrics.avgTimeInRange.toFixed(1)}%`}
        />
        <MetricCard
          label="Rebalances"
          value={metrics.numberOfRebalances}
        />
        <MetricCard
          label="Avg Fees/Rebalance"
          value={`$${metrics.avgFeesPerRebalance.toFixed(2)}`}
        />
      </div>
    </div>
  );
}
```

---

### Phase 4: Testing & Optimization

#### 4.1 Backtesting Script

Create `scripts/backtest-strategy.ts`:

```typescript
import { calculateDivergenceLoss, detectTrend } from '../src/utils/strategyCalculations';

async function backtestStrategy(
  poolId: string,
  strategyId: string,
  startDate: Date,
  endDate: Date
) {
  // Fetch historical pool data
  const historicalData = await fetchHistoricalPoolData(poolId, startDate, endDate);

  // Simulate strategy
  const results = simulateStrategy(historicalData, strategyId);

  console.log('Backtest Results:', {
    totalReturn: results.totalReturn,
    sharpeRatio: results.sharpeRatio,
    maxDrawdown: results.maxDrawdown,
    numberOfTrades: results.numberOfTrades,
    winRate: results.winRate,
  });
}
```

#### 4.2 Strategy Comparison Tool

```typescript
async function compareStrategies(poolId: string, timeframe: string) {
  const strategies = ['time-based', 'out-of-range', 'smart-rebalance'];

  for (const strategy of strategies) {
    const results = await backtestStrategy(poolId, strategy, ...);
    console.log(`${strategy}: ${results.totalReturn}%`);
  }
}
```

---

## Quick Start: Implement Smart Rebalancing (1-2 days)

### Step 1: Update Backend Service (2-4 hours)

1. Add `isPositionOutOfRange()` function to `vault-service.ts`
2. Update `shouldExecuteCycle()` to check out-of-range first
3. Add better logging

### Step 2: Test with Existing Vaults (1 hour)

1. Deploy updated backend
2. Monitor logs
3. Verify it triggers on out-of-range

### Step 3: Add Divergence Protection (2 hours)

1. Implement `calculateDivergenceLoss()`
2. Add to `shouldExecuteCycle()` checks
3. Test with thresholds

### Step 4: Frontend Strategy Selector (3-4 hours)

1. Create `StrategySelector` component
2. Update `CreateVaultModal` to use it
3. Add preset strategies

### Total Time: 1-2 days of focused work

**Expected Result**:
- 30-50% reduction in unnecessary rebalances
- Better capital efficiency
- Same or better APY with lower gas costs

---

## Advanced Features (Phase 2+)

### Trend Following (1 week)
- Implement EMA calculation
- Add trend detection
- Create asymmetric range support in contracts
- UI for manual trend bias selection

### Volatility Adaptive (1 week)
- Collect historical price data
- Calculate rolling volatility
- Auto-adjust ranges based on volatility
- Dashboard showing current volatility state

### Multi-Range Portfolio (2 weeks)
- Support multiple vaults per user
- Portfolio view showing all positions
- Aggregate PnL across all vaults
- Rebalancing coordination

---

## Expected Impact

### Current System:
- APY: 50-200% vs wide range
- Gas efficiency: Medium
- Capital efficiency: Good
- User control: Basic

### With Smart Rebalancing:
- APY: **70-300%** vs wide range ✅
- Gas efficiency: **High** (30-50% reduction) ✅
- Capital efficiency: **Excellent** ✅
- User control: Enhanced ✅

### With Full Strategy Suite:
- APY: **100-500%+** vs wide range 🚀
- Gas efficiency: **Optimal** 🚀
- Capital efficiency: **Maximum** 🚀
- User control: **Professional Grade** 🚀
- Risk management: **Built-in** 🚀

---

## Questions?

Key concepts to understand:

1. **Tight ranges = High APY** because liquidity is concentrated
2. **Auto-cycling = Stay in range** prevents earning from stopping
3. **Out-of-range detection > time-based** because it's more efficient
4. **Divergence loss protection = Risk management** prevents losses from price movements
5. **Strategy flexibility = User satisfaction** different users have different goals

The core innovation is making automated market making **intelligent** rather than just automatic.
