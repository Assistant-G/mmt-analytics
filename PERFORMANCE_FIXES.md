# Performance Metrics Fixes

## Issues Fixed ✅

### 1. Time in Range showing 0.0%
**Problem:** Was counting ALL snapshots, including those without position/tick data
**Fix:** Now only counts snapshots where `hasPosition = true` and `isInRange !== undefined`
**Result:** Will now show accurate % of time position was in range

### 2. Range Changes showing -1
**Problem:** Calculated as `ranges.length - 1`, which gave -1 when no ranges existed
**Fix:** Added `Math.max(0, ranges.length - 1)` to prevent negative values
**Result:** Will show 0 or positive number

### 3. Gas Estimation Too Low
**Problem:** Estimated $0.01 per cycle (0.01 SUI @ $1)
**Fix:** Updated to $0.05 per cycle (0.025 SUI @ $2)
**Calculation:**
- Open position: ~0.005-0.01 SUI
- Close + reopen: ~0.01-0.02 SUI
- Compound fees: ~0.005 SUI
- Deposit leftover: ~0.005 SUI
- **Total: ~0.025 SUI @ $2 = $0.05 per cycle**

**Note:** This is still an estimate. Actual gas tracking from transactions is TODO.

### 4. Reward Tracking Infrastructure Added
**What was added:**
- `rewardsCollected` field in `PerformanceSnapshot` type
- `totalRewardsUsd` field in metrics
- Rewards included in `netPnl` calculation: `netPnl = fees + rewards - IL`

## Still TODO 🔧

### 1. Track Actual Gas Costs
Currently using estimated $0.05/cycle. Need to:
- Query transaction events for each cycle
- Extract actual gas fees paid
- Sum up real costs instead of estimation

**Where to get gas data:**
- Transaction effects have `gasUsed` field
- Need to track transaction digests for each cycle
- Query and sum actual gas costs

### 2. Track xSUI Rewards
The SUI/USDC pool earns xSUI rewards, but they're not being tracked yet.

**What needs to be done:**

#### Backend Changes:
Currently (in `vault-service.ts` lines 820-835):
```typescript
// Collect rewards and send to owner
for (const rewarder of sdkPool.rewarders || []) {
  const rewardCoin = this.sdk.Pool.collectReward(
    tx, poolParams, oldPosition, rewarder.coin_type, undefined, true,
  );

  // Send rewards to vault owner
  tx.transferObjects([rewardCoin], vault.owner);
}
```

Rewards currently go directly to owner's wallet and aren't tracked.

**Options:**

**Option A:** Keep sending to owner, but emit event for tracking
```move
public struct RewardsCollected has copy, drop {
    vault_id: address,
    coin_type: String,
    amount: u64,
}
```

**Option B:** Add reward tracking to vault
```move
// In Vault struct:
public struct Vault<phantom X, phantom Y> has key, store {
    // ... existing fields
    rewards_collected: Table<String, u64>, // coin_type -> amount
}
```

**Option C:** Query owner's wallet for reward coins (complex, not recommended)

#### Frontend Changes:
After backend tracking is added:
1. Query reward events in `useVaultPerformance.ts`
2. Calculate USD value for each reward token
3. Display in UI:
   - Add "Rewards Earned" card showing xSUI amount
   - Include in Total PnL calculation
   - Show breakdown by reward token type

## Current Stats After Fix

After refreshing your browser, you should see:

**Before:**
- Time in Range: 0.0% ❌
- Range Changes: -1 ❌
- Est. Gas: $0.30 (for 30 cycles) ❌

**After:**
- Time in Range: Actual % (e.g., 95%) ✅
- Range Changes: Actual count (e.g., 0 or higher) ✅
- Est. Gas: $1.50 (30 cycles × $0.05) ✅

**Still Missing:**
- xSUI Rewards: Not tracked yet 🔧
- Actual Gas Costs: Still estimated 🔧

## Next Steps

1. **Immediate:** Refresh frontend to see fixes
2. **Short term:** Implement reward tracking (requires backend changes)
3. **Long term:** Track actual gas costs from transactions
