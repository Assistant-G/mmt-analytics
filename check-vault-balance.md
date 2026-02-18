# How to Check Vault Balance

## Using SuiVision/Explorer

1. Go to https://suivision.xyz/
2. Search for your vault object ID
3. Look at the vault fields:
   - `balance_x` - Main SUI balance (includes compounded fees)
   - `balance_y` - Main USDC balance (includes compounded fees)
   - `fees_x` - Uncollected SUI fees (usually 0 after compounding)
   - `fees_y` - Uncollected USDC fees (usually 0 after compounding)

## Using Sui CLI

```bash
sui client object <VAULT_ID>
```

## In Your UI

The UI shows:
- **Balance (top right):** Current uncollected fees (fees_x + fees_y)
- **Current (Cycle N):** Total balance including compounded fees
- **Fees Collected:** Cumulative trading fees across all cycles

## Where Your Money Is

Your money is distributed as:
1. **In the LP position** (currently earning fees)
2. **In vault.balance_x/balance_y** (waiting for next cycle)
3. **In vault.fees_x/fees_y** (uncollected fees, usually small)

Total = All three combined!

## Example from Your Vault

```
Initial Deposit:
- 5000 SUI
- 2000 USDC

Current State:
- 5053.15 SUI (includes compounded fees)
- 1904.53 USDC (includes compounded fees)

Fees Collected:
- $0.45 total (trading fees earned across 10 cycles)

Where the $0.45 is:
- Already compounded into your 5053.15 SUI and 1904.53 USDC balance
- NOT sitting separately - it's part of your total!
```

## Why Current Shows Different Amounts

Notice your current balance changed:
- SUI: 5000 → 5053.15 (+1.1%)
- USDC: 2000 → 1904.53 (-4.8%)

This is due to:
1. **Impermanent Loss** - Price changed, so token ratio changed
2. **Trading Fees** - Offset some of the IL
3. **Compounded Leftover** - Tokens returned from addLiquidity

Net result: +$10.83 profit even with IL!
