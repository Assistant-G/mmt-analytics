# MMT Vault Backend Service

Automated cycling vault backend that monitors and executes vault position cycles on Sui.

## Quick Deploy to Railway (Recommended)

1. **Push your code to GitHub**
   ```bash
   git add . && git commit -m "Add backend" && git push
   ```

2. **Deploy to Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Set the **Root Directory** to: `contracts/mmt_automation/backend`

3. **Add Environment Variables**
   In Railway dashboard → Variables:
   ```
   EXECUTOR_PRIVATE_KEY=suiprivkey...  (your executor wallet private key)
   SUI_RPC_URL=https://fullnode.mainnet.sui.io:443  (optional)
   POLL_INTERVAL=10000  (optional, in milliseconds)
   ```

4. **Done!** Railway will auto-deploy whenever you push to GitHub.

## Alternative: Render.com

1. Go to [render.com](https://render.com)
2. New → Background Worker
3. Connect your GitHub repo
4. Set **Root Directory**: `contracts/mmt_automation/backend`
5. Set **Build Command**: `npm install`
6. Set **Start Command**: `npm start`
7. Add environment variables

## Local Development

```bash
# Install dependencies
npm install

# Set environment variable
export EXECUTOR_PRIVATE_KEY=suiprivkey...

# Run the service
npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXECUTOR_PRIVATE_KEY` | Yes | - | Wallet private key to execute vault cycles |
| `SUI_RPC_URL` | No | Sui mainnet | Custom RPC endpoint |
| `POLL_INTERVAL` | No | 10000 | Polling interval in milliseconds |

## How It Works

1. Monitors all vaults created via the VaultCreated event
2. Checks each vault's timer status
3. When timer expires:
   - Closes the current LP position
   - Collects fees/rewards
   - Reopens a new position at current price range
4. Repeats until max cycles reached or vault is paused

## Security

- The executor wallet only needs SUI for gas fees
- User funds remain in their vaults (never sent to executor)
- Executor can only call specific vault functions (close/reopen positions)
