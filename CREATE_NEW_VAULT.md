# Creating a New Vault with Reward Tracking

## The Problem

Your existing vault was created with the OLD package (`0x781c1aa...`). This vault object doesn't have the `rewards_collected` table field that's needed for tracking xSUI rewards.

Even though Railway is using the NEW package ID, it can't add reward tracking to an old vault object that's missing that field.

## The Solution

Create a **NEW vault** with the NEW package that has reward tracking built-in.

## Step 1: Withdraw from Old Vault

First, you need to withdraw your funds from the old vault:

1. **In your UI, click "Withdraw"** on the current vault
2. This will close the position and return all your tokens (SUI + USDC)
3. All accumulated fees will be included in the withdrawal

**Important:** Make sure the vault has completed its current cycle and doesn't have an active position before withdrawing.

## Step 2: Verify New Package in Frontend

Check that your frontend is using the new package ID:

**File:** `src/services/vaultService.ts`

Should show:
```typescript
export const VAULT_CONFIG = {
  packageId: '0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50',  // NEW
  configId: '0xc1dcb5fc12e9eea1763f8a8ef5c3b22c1869c62d7d03d599f060cbba4691bfdb',    // NEW
  // ...
};
```

If it shows `0x781c1aa...` (old), you need to update it and rebuild the frontend.

## Step 3: Create New Vault

1. **Go to your MMT Analytics UI**
2. **Click "Create Vault"** (or similar button)
3. **Enter your parameters:**
   - Pool: SUI/USDC (same as before)
   - Amount SUI: (your withdrawn amount)
   - Amount USDC: (your withdrawn amount)
   - Range: ±1.5% (or your preferred range)
   - Timer: 12s (or your preferred duration)
   - Max Cycles: 0 (infinite) or your preferred number

4. **Submit the transaction**

## Step 4: Verify New Vault Has Reward Tracking

After creating the new vault, verify it has reward tracking:

### Check 1: Vault Object Type

Run this command with your new vault ID:
```bash
sui client object <NEW_VAULT_ID> --json | jq -r '.data.content.type'
```

**Expected:** Should show `0x782bf73...::cycling_vault::Vault<...>`
**NOT:** `0x781c1aa...::cycling_vault::Vault<...>`

### Check 2: Check for rewards_collected Field

```bash
sui client object <NEW_VAULT_ID> --json | jq '.data.content.fields.rewards_collected'
```

**Expected:** Should show a table object (not null)
**Example:**
```json
{
  "type": "0x2::table::Table<0x1::string::String, u64>",
  "fields": {
    "id": {
      "id": "0x..."
    },
    "size": "0"
  }
}
```

If you see this, your new vault has reward tracking! ✅

## Step 5: Wait for First Cycle with Rewards

1. **Wait for the new vault to complete a cycle**
2. **Check SuiScan for the cycle transaction**
3. **Look for:**
   - Function call: `deposit_reward`
   - Event: `RewardsCollected`
   - xSUI transfer to your wallet

4. **Check your UI:**
   - Rewards Earned: Should show xSUI amount!
   - Gas: Should show actual cost (~$0.02-0.03)
   - Total PnL: Should include rewards

## Comparison: Old vs New Vault

### Old Vault (0x781c1aa...)
```
❌ No rewards_collected field
❌ xSUI goes directly to wallet (not tracked)
❌ No RewardsCollected events
❌ UI shows $0.00 rewards
❌ Gas estimates too high
```

### New Vault (0x782bf73...)
```
✅ Has rewards_collected table
✅ xSUI tracked on-chain + sent to wallet
✅ Emits RewardsCollected events
✅ UI shows actual xSUI rewards
✅ Actual gas costs from transactions
```

## What Happens to Old Vault?

After you withdraw:
1. Old vault becomes inactive
2. All funds (principal + fees) returned to you
3. You can delete/ignore the old vault
4. Create new vault with same parameters

## Alternative: Keep Both Vaults

You could also:
1. Keep old vault running (won't track rewards, but still works)
2. Create new vault with smaller amount to test reward tracking
3. Once confirmed working, move all funds to new vault

## Troubleshooting

### "Create Vault" button not working

**Problem:** Frontend might be using old package ID

**Solution:**
```bash
# Check frontend package ID
grep "packageId" src/services/vaultService.ts

# Should show: 0x782bf73...
# If shows: 0x781c1aa... → Update and rebuild

# Update
# (Already done in your code)

# Rebuild frontend
npm run build

# Redeploy
```

### Transaction fails when creating vault

**Problem:** VaultConfig might be from old package

**Solution:** Verify `VAULT_CONFIG_ID` in frontend:
```
Should be: 0xc1dcb5fc12e9eea1763f8a8ef5c3b22c1869c62d7d03d599f060cbba4691bfdb
```

### New vault created but still no rewards

**Problem:** Backend might not be restarted

**Solution:**
1. Check Railway deployment logs
2. Verify backend is using new package:
   ```
   VAULT_PACKAGE_ID=0x782bf73...
   ```
3. Manually trigger redeploy if needed

## Expected Timeline

1. **Withdraw from old vault:** Immediate
2. **Create new vault:** 1 transaction
3. **First cycle completes:** Wait for timer (e.g., 12 seconds)
4. **See rewards in UI:** After first cycle with rewards

## Summary

Your old vault can't be upgraded - it's a different type. You need to:

1. ✅ Withdraw from old vault
2. ✅ Create new vault (will use new package automatically)
3. ✅ Wait for first cycle
4. ✅ See rewards tracking in UI!

The new vault will have the `rewards_collected` table and can track xSUI rewards properly.
