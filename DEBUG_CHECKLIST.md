# Debug Checklist - Why Rewards Aren't Showing

You've confirmed:
✅ NEW vault created with new package ID
✅ Railway has correct environment variables
✅ Variable names are correct

## Quick Diagnostic Questions

### 1. Which Vault is the Backend Cycling?

**Check Railway logs:**
- Go to Railway → Your backend service → "Logs" or "Deployments"
- Look for log messages about vault execution
- **Question:** What vault ID is the backend processing?

**Expected:** Should match your NEW vault ID
**Problem if:** Backend is still processing old vault ID

**How to check:**
```
Look for logs like:
"Executing vault 0x..."
"Position cycled successfully"

Compare the vault ID in logs with your NEW vault ID
```

### 2. Has the NEW Vault Completed Any Cycles Yet?

**Check your new vault in UI:**
- **Current Cycle:** Should be > 0
- **Time Active:** Should show elapsed time

**If cycle is 0:**
- Vault was just created
- Wait for first cycle to complete
- Then check for rewards

**If cycle is > 0:**
- Great! Cycles have happened
- But we need to check if rewards were collected

### 3. Check Transaction for deposit_reward Call

**Go to SuiScan:**
1. Find a recent cycle transaction from your NEW vault
2. Look at "Function Calls" section
3. **Do you see:** `cycling_vault::deposit_reward`?

**Yes:** Backend IS calling deposit_reward ✅
**No:** Backend is NOT calling deposit_reward ❌

**Also check "Events":**
- **Do you see:** `RewardsCollected` event?

**Yes:** Rewards ARE being tracked! ✅
**No:** Either no rewards, or deposit_reward not called ❌

### 4. Did the Pool Have Rewards to Collect?

**This is important:** Not every cycle has rewards!

xSUI rewards accumulate over time in the pool. If the pool didn't have any rewards to claim during that cycle, there will be:
- ✅ No `RewardsCollected` event (normal)
- ✅ No xSUI transfer (normal)
- ✅ $0.00 shown in UI (correct!)

**How to verify pool has rewards:**
Go to MMT Finance and check if the SUI/USDC pool shows xSUI rewards available.

### 5. Is Frontend Built with Latest Code?

**Check if frontend is using new code:**

**If using Vercel/Netlify:**
- Check deployment timestamp
- Should be AFTER you pushed the new package IDs

**If running locally:**
```bash
cd /home/user/mmtanal
npm run build
# Check build output - should complete successfully
```

**Verify package ID in built code:**
```bash
grep -r "782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50" dist/
```
Should find the new package ID in the built files.

### 6. Browser Cache Issue?

**Hard refresh your browser:**
- Chrome/Edge: Ctrl + Shift + R (Windows) or Cmd + Shift + R (Mac)
- Firefox: Ctrl + F5 (Windows) or Cmd + Shift + R (Mac)
- Safari: Cmd + Option + R

**Or clear site data:**
1. Open Developer Tools (F12)
2. Application tab
3. Clear site data for your domain
4. Refresh page

## Most Likely Scenarios

### Scenario A: Backend Still Processing Old Vault
**Symptoms:**
- Railway logs show old vault ID
- New vault sitting idle

**Solution:**
- Backend only processes vaults it knows about
- Check backend startup logs for vault discovery
- You may need to restart backend to discover new vault

**Check:**
```
Railway logs should show:
"Found vault: 0x..." → Should be NEW vault ID
```

### Scenario B: No Rewards in Pool Yet
**Symptoms:**
- deposit_reward is called
- But amount is 0
- No RewardsCollected event (amount was 0)

**Solution:**
- Wait for rewards to accumulate in pool
- Check MMT Finance pool page for xSUI APR
- If APR > 0%, rewards will come

### Scenario C: First Cycle Hasn't Completed
**Symptoms:**
- New vault shows Cycle 0
- Timer still counting down

**Solution:**
- Wait for timer to reach 0
- Backend will execute first cycle
- Then check for rewards

### Scenario D: Frontend Not Rebuilt
**Symptoms:**
- Code has new package IDs
- But UI still queries old events

**Solution:**
- Rebuild frontend: `npm run build`
- Redeploy to hosting
- Hard refresh browser

## Immediate Action Items

**Do these NOW:**

1. **Check Railway Logs**
   ```
   Railway → Backend Service → Logs
   Look for: "Executing vault 0x..."
   Question: Is it processing your NEW vault?
   ```

2. **Check New Vault Cycles**
   ```
   Your UI → New Vault
   Question: How many cycles completed?
   If 0: Wait for first cycle
   If > 0: Continue to step 3
   ```

3. **Check Latest Transaction**
   ```
   SuiScan → Search your latest cycle transaction
   Look for:
   - Function: deposit_reward (should exist)
   - Event: RewardsCollected (may not exist if no rewards)
   Screenshot and share
   ```

4. **Check Browser Console**
   ```
   F12 → Console tab
   Look for errors
   Screenshot any errors about:
   - Failed to fetch
   - Query failed
   - Package not found
   ```

## What to Share

Please share:
1. **New vault ID:** `0x...`
2. **Cycles completed:** `__`
3. **Railway log snippet:** Showing which vault is being processed
4. **SuiScan transaction:** Link to latest cycle transaction
5. **Browser console:** Any errors?

This will help me pinpoint exactly what's wrong!

## Expected vs Actual

### What SHOULD Happen (Working Correctly)

**Transaction:**
```
Functions Called:
✓ cycling_vault::retrieve_position
✓ pool::removeLiquidity
✓ pool::collectFee
✓ pool::collectReward
✓ cycling_vault::deposit_reward ← KEY!
✓ cycling_vault::deposit_proceeds

Events:
✓ CycleExecuted
✓ FeesCompounded
✓ RewardsCollected ← KEY!
  {
    vault_id: "0x...",
    coin_type: "0x...::xsui::XSUI",
    amount: "147768"
  }
```

**UI:**
```
✓ Rewards Earned: 0.000147768 xSUI ($0.29)
✓ Gas: $0.028 (actual)
✓ Total PnL: Includes rewards
```

### What You're Seeing (Not Working)

**UI:**
```
✗ Rewards Earned: Not visible / $0.00
```

**We need to find out WHERE in the chain it's breaking!**
