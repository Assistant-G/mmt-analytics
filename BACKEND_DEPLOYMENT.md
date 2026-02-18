# Backend Deployment Guide

## Current Issue

Your backend service is running the OLD code with OLD package IDs. This is why xSUI rewards are being sent directly to your wallet instead of being tracked.

## Where is Your Backend Running?

Based on your transactions, the backend is actively running somewhere. Check:
- **Railway**: https://railway.app/dashboard
- **VPS/Server**: SSH into your server
- **Locally**: Check if a terminal/screen session is running

## How to Update

### Option 1: Railway (Most Common)

1. **Push code to GitHub:**
   ```bash
   cd /home/user/mmtanal
   git push origin claude/review-project-structure-QDz8J
   ```

2. **Go to Railway Dashboard:**
   - Open https://railway.app
   - Find your backend service
   - Click on "Variables" tab

3. **Update Environment Variables:**
   ```
   VAULT_PACKAGE_ID=0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50
   VAULT_CONFIG_ID=0xc1dcb5fc12e9eea1763f8a8ef5c3b22c1869c62d7d03d599f060cbba4691bfdb
   EXECUTOR_PRIVATE_KEY=<your_actual_private_key>
   ```

4. **Redeploy:**
   - Railway should auto-deploy when you push to GitHub
   - Or click "Deploy" manually
   - Watch logs for: "Gas used: X SUI"

### Option 2: VPS/Server

1. **SSH into your server:**
   ```bash
   ssh your-server
   ```

2. **Navigate to project:**
   ```bash
   cd /path/to/mmtanal/contracts/mmt_automation/backend
   ```

3. **Pull latest code:**
   ```bash
   git pull origin claude/review-project-structure-QDz8J
   ```

4. **Update .env file:**
   ```bash
   nano .env
   ```

   Make sure it has:
   ```
   VAULT_PACKAGE_ID=0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50
   VAULT_CONFIG_ID=0xc1dcb5fc12e9eea1763f8a8ef5c3b22c1869c62d7d03d599f060cbba4691bfdb
   EXECUTOR_PRIVATE_KEY=<your_actual_private_key>
   ```

5. **Restart service:**
   ```bash
   # If using PM2:
   pm2 restart vault-service

   # If using systemd:
   sudo systemctl restart vault-service

   # Or kill and restart manually:
   pkill -f vault-service
   npm run start
   ```

### Option 3: Local (If Running Locally)

1. **Find the process:**
   ```bash
   ps aux | grep vault-service
   ```

2. **Kill it:**
   ```bash
   kill <process_id>
   ```

3. **Start with new code:**
   ```bash
   cd /home/user/mmtanal/contracts/mmt_automation/backend

   # Make sure .env has your private key
   nano .env

   # Install dependencies (if needed)
   npm install

   # Start service
   npm run start
   ```

## Verification

After redeploying, check:

### 1. Backend Logs

You should see:
```
Gas used: 0.014235 SUI (computation: 12450000, storage: 3785000, rebate: 2000000)
Position cycled successfully
```

### 2. On-Chain Events

Query for RewardsCollected events:
```bash
sui client events --query '{"MoveEventType":"0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50::cycling_vault::RewardsCollected"}'
```

You should see events like:
```json
{
  "vault_id": "0x...",
  "coin_type": "0x...::xsui::XSUI",
  "amount": "147768"
}
```

### 3. Frontend UI

After the next cycle:
- **Rewards Earned**: Should show xSUI amount
- **Gas**: Should show actual cost (much lower!)
- **Total PnL**: Should include rewards

### 4. Transaction Details

In SuiScan, the next RemoveAndAddLiquidity transaction should:
- Call `deposit_reward` function
- Emit `RewardsCollected` event
- Still transfer xSUI to your wallet (but tracked!)

## Troubleshooting

### Backend still using old package

**Check environment variables:**
```bash
# On server/Railway, verify:
echo $VAULT_PACKAGE_ID
echo $VAULT_CONFIG_ID
```

Should output: `0x782bf73...` (new package)
NOT: `0x781c1aa...` (old package)

### Rewards still not tracked

**Verify contract deployment:**
```bash
sui client object 0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50 --json | jq
```

Should show modules: `cycling_vault`, `escrow_registry`, `simple_escrow`

**Check if deposit_reward exists:**
```bash
sui client call --package 0x782bf7363056e6ed13c235cc475c6ae2f413242aec6310afa6d4c47652cdfc50 --module cycling_vault --function deposit_reward --help
```

Should show the function signature (won't execute, just verify it exists)

### Backend won't start

**Check Node.js version:**
```bash
node --version  # Should be 18+
```

**Check dependencies:**
```bash
cd /home/user/mmtanal/contracts/mmt_automation/backend
npm install
```

**Check logs:**
```bash
npm run start 2>&1 | tee backend.log
```

## Expected Results After Update

### Before (Current):
```
RemoveAndAddLiquidity
+0.000147768 xSUI  → Directly to wallet
No RewardsCollected event
Gas: $0.20 (estimated)
```

### After (Fixed):
```
RemoveAndAddLiquidity
+0.000147768 xSUI  → Tracked via deposit_reward()
RewardsCollected event emitted
+0.000147768 xSUI  → Transferred to wallet
Gas: $0.028 (actual, from tx effects)
```

## Important Notes

1. **Rewards Still Go to Your Wallet**: The `deposit_reward` function tracks the amount on-chain, then transfers the coins to you. You still get the xSUI!

2. **No Need to Migrate Old Vaults**: Old vaults will automatically use the new tracking once backend is updated.

3. **Gas Costs Will Be Lower**: Actual gas is much cheaper than our estimates. You'll see ~$0.02-0.03 per cycle instead of $0.05.

## Quick Checklist

- [ ] Find where backend is deployed (Railway/VPS/Local)
- [ ] Update VAULT_PACKAGE_ID to `0x782bf73...`
- [ ] Update VAULT_CONFIG_ID to `0xc1dcb5fc...`
- [ ] Ensure EXECUTOR_PRIVATE_KEY is set (not placeholder)
- [ ] Restart/redeploy backend service
- [ ] Wait for next cycle (10 cycles completed → wait for cycle 11)
- [ ] Check UI for rewards
- [ ] Verify RewardsCollected events on-chain
