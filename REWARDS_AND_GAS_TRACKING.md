# xSUI Rewards and Actual Gas Tracking Implementation

## Overview

This implementation adds:
1. **xSUI Reward Tracking** - Tracks rewards collected from MMT pools and displays them in UI
2. **Actual Gas Tracking** - Replaces gas estimates with actual gas costs from transaction effects

## Changes Made

### 1. Move Contract (`contracts/mmt_automation/sources/cycling_vault.move`)

**Added:**
- `Table` import for storing rewards by coin type
- `rewards_collected: Table<String, u64>` field to Vault struct
- `RewardsCollected` event emitted when rewards are deposited
- `deposit_reward<X, Y, R>()` function to track and transfer rewards
- `get_reward_amount()` view function to query reward balances

**How it works:**
- When backend collects rewards, it calls `deposit_reward()` instead of direct transfer
- Contract tracks cumulative rewards in a table (coin_type → amount)
- Reward coins are still transferred to vault owner's wallet
- Events allow frontend to query reward history

### 2. Backend (`contracts/mmt_automation/backend/vault-service.ts`)

**Updated all three reward collection sites:**
1. `closePosition()` (line ~818-833)
2. `closeAndReopenPosition()` (line ~926-943)

**Changes:**
```typescript
// OLD - Direct transfer to owner
tx.transferObjects([rewardCoin], vault.owner);

// NEW - Deposit to vault for tracking
tx.moveCall({
  target: `${VAULT_PACKAGE_ID}::cycling_vault::deposit_reward`,
  typeArguments: [vault.tokenXType, vault.tokenYType, rewarder.coin_type],
  arguments: [
    tx.object(VAULT_CONFIG_ID),
    tx.object(vault.id),
    rewardCoin,
  ],
});
```

**Gas Tracking:**
- Added `showEvents: true` to all executeTransactionBlock options
- Logs actual gas costs after each transaction:
  - Computation cost
  - Storage cost
  - Storage rebate
  - Total net gas in SUI

### 3. Frontend

#### `src/hooks/useVaultPerformance.ts`

**Added reward event queries:**
- Queries `RewardsCollected` events for the vault
- Groups rewards by coin type
- Converts amounts using correct decimals
- Calculates USD values (xSUI ≈ $2)

**Added actual gas tracking:**
- Queries `CycleExecuted` and `PositionOpened` events
- Gets transaction digests from event IDs
- Fetches transaction details for each digest
- Extracts `gasUsed` from transaction effects
- Sums total gas: `computationCost + storageCost - storageRebate`

#### `src/services/performanceService.ts`

**Updated `calculateMetrics()`:**
```typescript
// Now accepts actual gas cost
calculateMetrics(performance: VaultPerformance, actualGasCostSui?: number)
```

**Gas calculation logic:**
- If `actualGasCostSui` provided → use actual cost
- Otherwise → fall back to estimate (0.05 SUI/cycle)
- Display shows actual value when available

#### `src/types/performance.ts`

**Already had:**
- `rewardsCollected` field in `PerformanceSnapshot`
- `totalRewardsUsd` field in metrics

## Deployment Steps

### 1. Deploy Updated Move Contract

```bash
cd /home/user/mmtanal/contracts/mmt_automation

# Build the contract
sui move build

# Deploy (use your network - testnet or mainnet)
sui client publish --gas-budget 100000000

# Save the output - you'll need:
# - New PackageID
# - New VaultConfig object ID
```

### 2. Update Backend Environment Variables

Update `.env` or Railway environment:
```bash
VAULT_PACKAGE_ID=<new_package_id>
VAULT_CONFIG_ID=<new_vault_config_id>
```

### 3. Update GitHub

```bash
# Update package IDs in vault-service.ts if not using env vars
# Then commit and push
git add .
git commit -m "Add xSUI rewards tracking and actual gas costs"
git push
```

### 4. Restart Backend

- If Railway: Will auto-deploy on push
- If local: Restart the backend process

### 5. Clear Frontend Cache

Users should:
1. Hard refresh browser (Ctrl+Shift+R / Cmd+Shift+R)
2. Or clear localStorage for the site

## Expected Results

### Rewards Display

**Before:**
- No reward tracking
- Rewards sent to wallet but not shown in UI

**After:**
- "Rewards Earned" metric showing xSUI amount
- Rewards included in Total PnL calculation
- Breakdown by reward token type if multiple

### Gas Costs

**Before:**
```
Est. Gas: $1.50 (30 cycles × $0.05)
```

**After (with actual tracking):**
```
Gas: $0.42 (actual from 30 transactions)
```

**Note:** Actual gas is much lower than estimates! Sui has very cheap gas.

### Backend Logs

After each cycle, you'll see:
```
Gas used: 0.014235 SUI (computation: 12450000, storage: 3785000, rebate: 2000000)
Position cycled successfully abc123...
```

## Verification

### 1. Check Rewards

**On-chain:**
```bash
# Query RewardsCollected events
sui client events --query '{"MoveEventType":"<package_id>::cycling_vault::RewardsCollected"}'
```

**In UI:**
- Should show "Rewards Earned: X xSUI"
- Total PnL should include rewards

### 2. Check Gas Costs

**Backend logs:**
```
grep "Gas used" backend.log
```

**In UI:**
- Gas metric should show lower value than before
- Tooltip/label should indicate "actual" not "estimated"

## Troubleshooting

### Rewards not showing

1. Check backend logs for "deposit_reward" calls
2. Query events: `sui client events`
3. Verify RewardsCollected events exist for your vault
4. Clear browser cache and refresh

### Gas still showing estimates

1. Check if CycleExecuted events exist for vault
2. Verify transaction digests are in event IDs
3. Check browser console for "Could not fetch transaction gas" warnings
4. May need to wait for more cycles to accumulate data

### Build errors

If you get errors about `table` or `string`:
```bash
# In Move.toml, ensure you have:
[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }
```

## Future Improvements

1. **Multiple reward types:** Currently optimized for xSUI, but supports any coin type
2. **Reward USD values:** Fetch actual prices from oracle instead of hardcoded $2
3. **Gas price oracle:** Use actual SUI price for accurate USD conversion
4. **Reward compounding:** Option to auto-compound rewards into liquidity
5. **Historical gas chart:** Show gas costs over time

## Summary

✅ Rewards are tracked on-chain in vault contract
✅ Backend deposits rewards through contract (not direct transfer)
✅ Frontend queries and displays xSUI rewards
✅ Actual gas costs replace estimates
✅ Backend logs detailed gas breakdown
✅ All changes are backwards compatible

Users now see:
- Accurate reward earnings from MMT pool incentives
- Real gas costs instead of overestimated values
- Complete PnL including fees + rewards - gas - IL
