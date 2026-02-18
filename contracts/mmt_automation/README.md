# MMT Position Auto-Close Escrow Contracts

Smart contracts for automatically closing MMT CLMM positions without requiring the user to keep their browser open.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend UI   │────►│  Smart Contract  │◄────│ Backend Service │
│  (Browser)      │     │  (Sui Mainnet)   │     │   (Server)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                        │
        │ 1. User deposits       │ 3. Backend checks      │
        │    position to         │    expired escrows     │
        │    escrow              │    every 10s           │
        │                        │                        │
        └────────────────────────┴────────────────────────┘
                                 │
                                 │ 2. Position held in
                                 │    shared object
                                 ▼
                    ┌─────────────────────────┐
                    │   When Timer Expires:   │
                    │   - Backend executes    │
                    │     close transaction   │
                    │   - Tokens sent to      │
                    │     original owner      │
                    └─────────────────────────┘
```

## Contracts

### `simple_escrow.move` (Recommended)
Simpler contract using address-based authorization:
- `create_escrow<T>` - User deposits position with timer
- `cancel_and_return<T>` - User cancels before timer expires
- `execute<T>` - Executor (backend) withdraws position after timer
- `set_executor` - Admin changes executor address

### `escrow_registry.move`
More complex version with admin capability tokens:
- Uses `AdminCap` for authorization
- Better for multi-sig setups
- Same core functionality

## Deployment

### Prerequisites
1. Sui CLI installed (`sui --version` should work)
2. SUI tokens for gas (~0.5 SUI should be plenty)
3. Wallet configured (`sui client active-address`)

### Step 1: Fund Deployment Wallet
```bash
# Check current address
sui client active-address

# If you need a new address:
sui client new-address ed25519

# Send SUI to this address (from exchange or another wallet)
```

### Step 2: Deploy Contracts
```bash
cd contracts/mmt_automation
sui move build
sui client publish --gas-budget 100000000 --json
```

### Step 3: Record Deployment Info
From the deployment output, note:
- **Package ID**: The deployed package address
- **EscrowConfig ID**: The shared config object ID (look for `simple_escrow::EscrowConfig`)

Example output:
```json
{
  "objectChanges": [
    {
      "type": "published",
      "packageId": "0x1234...abcd"
    },
    {
      "type": "created",
      "objectId": "0x5678...efgh",
      "objectType": "0x1234...abcd::simple_escrow::EscrowConfig"
    }
  ]
}
```

### Step 4: Update Frontend Configuration
Edit `src/services/escrowService.ts`:
```typescript
export const ESCROW_CONFIG = {
  packageId: '0x1234...abcd',  // Your package ID
  configId: '0x5678...efgh',    // Your EscrowConfig object ID
  isDeployed: true,             // Enable escrow feature
};
```

### Step 5: Deploy Backend Service
```bash
cd contracts/mmt_automation/backend

# Set executor private key
export EXECUTOR_PRIVATE_KEY="suiprivkey..."

# Update PACKAGE_ID and CONFIG_ID in escrow-service.ts
# Then run:
npx ts-node escrow-service.ts
```

## Usage Flow

### User Perspective
1. User opens AddLiquidity modal
2. Sets timer duration
3. Selects "Escrow (Works Offline)" method
4. Creates position → signs two transactions:
   - First: Create position
   - Second: Deposit to escrow
5. User can close browser - position closes automatically

### Backend Perspective
1. Service polls for expired escrows every 10s
2. When escrow expires:
   - Calls `execute<T>` to get position
   - Calls MMT `removeLiquidity`, `collectFee`, `collectRewards`
   - All tokens go to original owner
3. If auto-reopen enabled, creates new position

## Security Considerations

1. **Executor Key**: Keep the backend executor's private key secure. It can only execute closes after timer expires.

2. **User Control**: Users can always cancel their escrow before timer expires.

3. **No Custody Risk**: Tokens from close go directly to original owner, not through backend.

4. **Upgradability**: Contracts are not upgradeable by design for security.

## Development

### Build
```bash
sui move build
```

### Test (TODO)
```bash
sui move test
```

### Lint
Build output includes linter warnings. Address as needed.

## Contract Addresses (Mainnet)

After deployment, update these:

| Contract | Address |
|----------|---------|
| Package | `0xTODO` |
| EscrowConfig | `0xTODO` |

## Troubleshooting

### "Escrow contracts not deployed yet"
Update `ESCROW_CONFIG.isDeployed = true` in `src/services/escrowService.ts`

### Backend can't execute
- Check executor address matches config
- Ensure timer has actually expired (clock on-chain vs local time)
- Check executor has SUI for gas

### Position not found in escrow
- Verify escrow object exists on-chain
- Check position wasn't already cancelled/executed
