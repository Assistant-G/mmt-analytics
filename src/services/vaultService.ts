/**
 * Vault Service for Cycling Vault Contract
 *
 * Frontend service to interact with the cycling vault smart contract.
 * Enables users to deposit tokens for automatic LP position cycling.
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import { MmtSDK } from '@mmt-finance/clmm-sdk';

// ============ Configuration ============
// Deployed on mainnet - Transaction: AER81wERMSuxU75G6XCaZxwACVREV8pNDWP8sJZsjdCS

export const VAULT_CONFIG = {
  // Package ID - deployed with auto-rebalance, ZAP, fee routing, and stats tracking
  packageId: process.env.NEXT_PUBLIC_VAULT_PACKAGE_ID || '0x302a07fee2847fd203aaaac779b7a5a9454a028b515f288fc27a5fe83cce11f9',
  // VaultConfig shared object - deployed
  configId: process.env.NEXT_PUBLIC_VAULT_CONFIG_ID || '0xf5df31a91a1a9bb38d713844051d2d97cd20577d71a162a03f181e436d0a74b7',
  // Clock object
  clockId: '0x6',
  // Is deployed flag
  isDeployed: true,
};

// ============ Types ============

export interface VaultInfo {
  id: string;
  owner: string;
  poolId: string;
  balanceX: string;
  balanceY: string;
  feesX: string;
  feesY: string;
  rangeBps: number;
  timerDurationMs: number;
  nextExecutionAt: number;
  maxCycles: number;
  cyclesCompleted: number;
  isActive: boolean;
  hasPosition: boolean;
  tokenXType: string;
  tokenYType: string;
}

export interface CreateVaultParams {
  coinXId: string;
  coinYId: string;
  coinXType: string;
  coinYType: string;
  poolId: string;
  rangeBps: number; // e.g., 500 = 5%
  timerDurationMs: number;
  maxCycles: number; // 0 = infinite
}

// ============ Transaction Builders ============

/**
 * Build transaction to create a new cycling vault
 */
export function buildCreateVaultTransaction(params: CreateVaultParams): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::create_and_share_vault`,
    typeArguments: [params.coinXType, params.coinYType],
    arguments: [
      tx.object(VAULT_CONFIG.configId),
      tx.object(params.coinXId),
      tx.object(params.coinYId),
      tx.pure.id(params.poolId),
      tx.pure.u64(params.rangeBps),
      tx.pure.u64(params.timerDurationMs),
      tx.pure.u64(params.maxCycles),
      tx.object(VAULT_CONFIG.clockId),
    ],
  });

  return tx;
}

/**
 * Build transaction to deposit more tokens into vault
 */
export function buildDepositTransaction(
  vaultId: string,
  coinXId: string,
  coinYId: string,
  coinXType: string,
  coinYType: string
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::deposit`,
    typeArguments: [coinXType, coinYType],
    arguments: [
      tx.object(vaultId),
      tx.object(coinXId),
      tx.object(coinYId),
    ],
  });

  return tx;
}

/**
 * Build transaction to pause vault
 */
export function buildPauseVaultTransaction(
  vaultId: string,
  coinXType: string,
  coinYType: string
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::pause`,
    typeArguments: [coinXType, coinYType],
    arguments: [tx.object(vaultId)],
  });

  return tx;
}

/**
 * Build transaction to resume vault
 */
export function buildResumeVaultTransaction(
  vaultId: string,
  coinXType: string,
  coinYType: string
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::resume`,
    typeArguments: [coinXType, coinYType],
    arguments: [
      tx.object(vaultId),
      tx.object(VAULT_CONFIG.clockId),
    ],
  });

  return tx;
}

/**
 * Build transaction to withdraw all and close vault (when no active position)
 */
export function buildWithdrawVaultTransaction(
  vaultId: string,
  coinXType: string,
  coinYType: string
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::withdraw_and_transfer`,
    typeArguments: [coinXType, coinYType],
    arguments: [
      tx.object(VAULT_CONFIG.configId),
      tx.object(vaultId),
    ],
  });

  return tx;
}

// MMT Position type constant (use published package ID, not MVR name)
const MMT_PUBLISHED_AT = '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860';
const MMT_POSITION_TYPE = `${MMT_PUBLISHED_AT}::position::Position`;

/**
 * Build transaction to close position and withdraw everything from vault
 * This handles the case when vault has an active position
 * Uses SDK helper methods for reliable transaction building
 */
export function buildClosePositionAndWithdrawTransaction(
  vaultId: string,
  poolId: string,
  coinXType: string,
  coinYType: string,
  liquidity: string,
  ownerAddress: string,
  _positionType: string // Kept for API compatibility but we use constant
): Transaction {
  const tx = new Transaction();

  // Get SDK for MMT contract info
  const sdk = MmtSDK.NEW({ network: 'mainnet' });

  const poolParams = {
    objectId: poolId,
    tokenXType: coinXType,
    tokenYType: coinYType,
  };

  // Step 1: Retrieve position from vault (owner can call this)
  // Use the constant MMT_POSITION_TYPE (actual package ID, not MVR name)
  const position = tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::retrieve_position`,
    typeArguments: [coinXType, coinYType, MMT_POSITION_TYPE],
    arguments: [
      tx.object(VAULT_CONFIG.configId),
      tx.object(vaultId),
    ],
  });

  // Step 2: Remove liquidity using SDK helper (handles all types correctly)
  // Cast position to any since SDK accepts TransactionResult at runtime but TS types are strict
  const liquidityBigInt = BigInt(liquidity);
  const { removeLpCoinA, removeLpCoinB } = sdk.Pool.removeLiquidity(
    tx,
    poolParams,
    position as any, // SDK accepts TransactionResult at runtime
    liquidityBigInt,
    BigInt(0), // min_x
    BigInt(0), // min_y
    undefined,
    true, // return coins
  );

  // Step 3: Collect fees using SDK helper
  const { feeCoinA, feeCoinB } = sdk.Pool.collectFee(
    tx,
    poolParams,
    position as any, // SDK accepts TransactionResult at runtime
    undefined,
    true, // return coins
  );

  // Step 4: Merge fee coins with liquidity coins
  tx.mergeCoins(removeLpCoinA, [feeCoinA]);
  tx.mergeCoins(removeLpCoinB, [feeCoinB]);

  // Step 5: Transfer coins to owner
  tx.transferObjects([removeLpCoinA, removeLpCoinB], ownerAddress);

  // Step 6: Transfer empty position NFT to owner (position has 0 liquidity now)
  tx.transferObjects([position], ownerAddress);

  // Step 7: Withdraw remaining balance from vault to owner
  tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::withdraw_and_transfer`,
    typeArguments: [coinXType, coinYType],
    arguments: [
      tx.object(VAULT_CONFIG.configId),
      tx.object(vaultId),
    ],
  });

  return tx;
}

/**
 * Build transaction to update vault settings
 */
export function buildUpdateSettingsTransaction(
  vaultId: string,
  coinXType: string,
  coinYType: string,
  rangeBps: number,
  timerDurationMs: number,
  maxCycles: number
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::update_settings`,
    typeArguments: [coinXType, coinYType],
    arguments: [
      tx.object(vaultId),
      tx.pure.u64(rangeBps),
      tx.pure.u64(timerDurationMs),
      tx.pure.u64(maxCycles),
    ],
  });

  return tx;
}

/**
 * Build transaction to update rebalance settings (ZAP, auto-rebalance, delay, slippage)
 */
export function buildUpdateRebalanceSettingsTransaction(
  vaultId: string,
  coinXType: string,
  coinYType: string,
  autoRebalance: boolean,
  useZap: boolean,
  autoCompound: boolean,
  rebalanceDelayMs: number,
  maxZapSlippageBps: number = 0
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${VAULT_CONFIG.packageId}::cycling_vault::update_rebalance_settings`,
    typeArguments: [coinXType, coinYType],
    arguments: [
      tx.object(vaultId),
      tx.pure.bool(autoRebalance),
      tx.pure.bool(useZap),
      tx.pure.bool(autoCompound),
      tx.pure.u64(rebalanceDelayMs),
      tx.pure.u64(maxZapSlippageBps),
    ],
  });

  return tx;
}

// ============ Query Functions ============

/**
 * Fetch all vaults owned by an address
 */
export async function fetchUserVaults(
  client: SuiClient,
  ownerAddress: string
): Promise<VaultInfo[]> {
  const vaults: VaultInfo[] = [];

  try {
    // Query VaultCreated events for this owner
    const events = await client.queryEvents({
      query: {
        MoveEventType: `${VAULT_CONFIG.packageId}::cycling_vault::VaultCreated`,
      },
      order: 'descending',
      limit: 50,
    });

    for (const event of events.data) {
      const eventData = event.parsedJson as {
        vault_id: string;
        owner: string;
        pool_id: string;
      };

      // Only process vaults owned by this user
      if (eventData.owner !== ownerAddress) continue;

      try {
        const vaultObj = await client.getObject({
          id: eventData.vault_id,
          options: { showContent: true, showType: true },
        });

        if (!vaultObj.data?.content || vaultObj.data.content.dataType !== 'moveObject') {
          continue;
        }

        const fields = vaultObj.data.content.fields as Record<string, unknown>;
        const objectType = vaultObj.data.content.type;

        // Extract token types from Vault<X, Y> type
        const typeMatch = objectType.match(/Vault<([^,]+),\s*([^>]+)>/);
        if (!typeMatch) continue;

        const [, tokenXType, tokenYType] = typeMatch;

        vaults.push({
          id: eventData.vault_id,
          owner: fields.owner as string,
          poolId: fields.pool_id as string,
          balanceX: String((fields.balance_x as any)?.fields?.value || '0'),
          balanceY: String((fields.balance_y as any)?.fields?.value || '0'),
          feesX: String((fields.fees_x as any)?.fields?.value || '0'),
          feesY: String((fields.fees_y as any)?.fields?.value || '0'),
          rangeBps: Number(fields.range_bps || 0),
          timerDurationMs: Number(fields.timer_duration_ms || 0),
          nextExecutionAt: Number(fields.next_execution_at || 0),
          maxCycles: Number(fields.max_cycles || 0),
          cyclesCompleted: Number(fields.cycles_completed || 0),
          isActive: fields.is_active as boolean,
          hasPosition: fields.has_position as boolean,
          tokenXType: tokenXType.trim(),
          tokenYType: tokenYType.trim(),
        });
      } catch (error) {
        console.warn(`Failed to fetch vault ${eventData.vault_id}:`, error);
      }
    }
  } catch (error) {
    console.error('Failed to fetch vaults:', error);
  }

  return vaults;
}

/**
 * Fetch a single vault by ID
 */
export async function fetchVault(
  client: SuiClient,
  vaultId: string
): Promise<VaultInfo | null> {
  try {
    const vaultObj = await client.getObject({
      id: vaultId,
      options: { showContent: true, showType: true },
    });

    if (!vaultObj.data?.content || vaultObj.data.content.dataType !== 'moveObject') {
      return null;
    }

    const fields = vaultObj.data.content.fields as Record<string, unknown>;
    const objectType = vaultObj.data.content.type;

    // Extract token types
    const typeMatch = objectType.match(/Vault<([^,]+),\s*([^>]+)>/);
    if (!typeMatch) return null;

    const [, tokenXType, tokenYType] = typeMatch;

    return {
      id: vaultId,
      owner: fields.owner as string,
      poolId: fields.pool_id as string,
      balanceX: String((fields.balance_x as any)?.fields?.value || '0'),
      balanceY: String((fields.balance_y as any)?.fields?.value || '0'),
      feesX: String((fields.fees_x as any)?.fields?.value || '0'),
      feesY: String((fields.fees_y as any)?.fields?.value || '0'),
      rangeBps: Number(fields.range_bps || 0),
      timerDurationMs: Number(fields.timer_duration_ms || 0),
      nextExecutionAt: Number(fields.next_execution_at || 0),
      maxCycles: Number(fields.max_cycles || 0),
      cyclesCompleted: Number(fields.cycles_completed || 0),
      isActive: fields.is_active as boolean,
      hasPosition: fields.has_position as boolean,
      tokenXType: tokenXType.trim(),
      tokenYType: tokenYType.trim(),
    };
  } catch (error) {
    console.error('Failed to fetch vault:', error);
    return null;
  }
}

// ============ Utility Functions ============

/**
 * Check if vault contract is deployed
 */
export function isVaultDeployed(): boolean {
  return VAULT_CONFIG.isDeployed &&
    !VAULT_CONFIG.packageId.includes('PLACEHOLDER') &&
    !VAULT_CONFIG.configId.includes('PLACEHOLDER');
}

/**
 * Format timer duration for display
 */
export function formatTimerDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Format cycles for display
 */
export function formatCycles(completed: number, max: number): string {
  if (max === 0) return `${completed}/∞`;
  return `${completed}/${max}`;
}

/**
 * Calculate time until next execution
 */
export function getTimeUntilExecution(nextExecutionAt: number): number {
  return Math.max(0, nextExecutionAt - Date.now());
}
