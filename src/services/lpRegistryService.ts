/**
 * LP Registry Service
 *
 * Frontend service to interact with the LP Registry smart contract.
 * Enables users to register positions for automated rebalance and compound.
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import type { LPRegistryPosition, LPRegistrySettings } from '../types';
import { getSDK } from './mmtService';

// ============ Configuration ============
// Deployed on mainnet - Transaction: DzuXaEwQTYZ3yLDVG69DY8Lh49BFxYFZJ42QMK4u2opi

export const LP_REGISTRY_CONFIG = {
  // Package ID - New deployment
  packageId: '0x302a07fee2847fd203aaaac779b7a5a9454a028b515f288fc27a5fe83cce11f9',
  // LPRegistry shared object
  registryId: '0x3bb1ff6d52796c8ea1f29ad20cf348eb5ddb0cae0b4afc98edfcb83aaea82afa',
  // Clock object
  clockId: '0x6',
  // MMT Position type prefix (without generics)
  mmtPositionTypePrefix: '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860::position::Position',
};

// Cache for pool token types
let poolTokenTypesCache: Map<string, { tokenXType: string; tokenYType: string }> | null = null;

/**
 * Get token types for a pool by poolId
 * Uses cached pool data to avoid repeated API calls
 */
export async function getPoolTokenTypes(poolId: string): Promise<{ tokenXType: string; tokenYType: string } | null> {
  try {
    // Build cache if not exists
    if (!poolTokenTypesCache) {
      const sdk = getSDK();
      const pools = await sdk.Pool.getAllPools();
      poolTokenTypesCache = new Map();
      for (const pool of pools) {
        poolTokenTypesCache.set(pool.poolId, {
          tokenXType: pool.tokenXType,
          tokenYType: pool.tokenYType,
        });
      }
    }

    return poolTokenTypesCache.get(poolId) || null;
  } catch (e) {
    console.error('Failed to get pool token types:', e);
    return null;
  }
}

// Shared Sui client instance
let suiClientInstance: SuiClient | null = null;

function getSuiClient(): SuiClient {
  if (!suiClientInstance) {
    suiClientInstance = new SuiClient({ url: getFullnodeUrl('mainnet') });
  }
  return suiClientInstance;
}

/**
 * Fetch the actual type of a position object from the blockchain
 * This ensures we use the exact type string that matches the object
 */
export async function getPositionType(positionId: string): Promise<string | null> {
  try {
    const client = getSuiClient();
    const obj = await client.getObject({
      id: positionId,
      options: { showType: true },
    });

    if (obj.data?.type) {
      console.log('Position type from blockchain:', obj.data.type);
      return obj.data.type;
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch position type:', error);
    return null;
  }
}

// ============ Transaction Builders ============

/**
 * Build transaction to register a position for automated management
 * Fetches the actual position type from blockchain to avoid TypeArityMismatch
 */
export async function buildRegisterPositionTransactionAsync(
  positionId: string,
  poolId: string,
  settings: LPRegistrySettings
): Promise<Transaction> {
  // Fetch actual position type from blockchain
  const positionType = await getPositionType(positionId);

  if (!positionType) {
    throw new Error('Could not fetch position type from blockchain');
  }

  const tx = new Transaction();

  tx.moveCall({
    target: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::register_position`,
    typeArguments: [positionType],
    arguments: [
      tx.object(LP_REGISTRY_CONFIG.registryId),
      tx.object(positionId),
      tx.pure.address(poolId),
      tx.pure.bool(settings.autoRebalance),
      tx.pure.bool(settings.autoCompound),
      tx.pure.u64(settings.recurringCount),
      tx.pure.u64(settings.rebalanceDelayMs),
      tx.pure.u64(settings.rangePercentBps),
      tx.pure.bool(settings.useZap),
      tx.object(LP_REGISTRY_CONFIG.clockId),
    ],
  });

  return tx;
}

/**
 * Build transaction to register a position (sync version - uses provided type)
 * @deprecated Use buildRegisterPositionTransactionAsync instead
 */
export function buildRegisterPositionTransaction(
  positionId: string,
  poolId: string,
  tokenXType: string,
  tokenYType: string,
  settings: LPRegistrySettings
): Transaction {
  const tx = new Transaction();

  // Construct the position type - no spaces in generics
  const positionType = `${LP_REGISTRY_CONFIG.mmtPositionTypePrefix}<${tokenXType},${tokenYType}>`;

  tx.moveCall({
    target: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::register_position`,
    typeArguments: [positionType],
    arguments: [
      tx.object(LP_REGISTRY_CONFIG.registryId),
      tx.object(positionId),
      tx.pure.address(poolId),
      tx.pure.bool(settings.autoRebalance),
      tx.pure.bool(settings.autoCompound),
      tx.pure.u64(settings.recurringCount),
      tx.pure.u64(settings.rebalanceDelayMs),
      tx.pure.u64(settings.rangePercentBps),
      tx.pure.bool(settings.useZap),
      tx.object(LP_REGISTRY_CONFIG.clockId),
    ],
  });

  return tx;
}

/**
 * Build transaction to update position settings
 */
export function buildUpdateSettingsTransaction(
  registeredPositionId: string,
  settings: LPRegistrySettings
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::update_settings`,
    arguments: [
      tx.object(registeredPositionId),
      tx.pure.bool(settings.autoRebalance),
      tx.pure.bool(settings.autoCompound),
      tx.pure.u64(settings.recurringCount),
      tx.pure.u64(settings.rebalanceDelayMs),
      tx.pure.u64(settings.rangePercentBps),
      tx.pure.bool(settings.useZap),
      tx.object(LP_REGISTRY_CONFIG.clockId),
    ],
  });

  return tx;
}

/**
 * Build transaction to update settings AND trigger immediate rebalance
 * This combines update_settings with request_rebalance (owner can call this)
 */
export function buildUpdateSettingsWithRebalanceNowTransaction(
  registeredPositionId: string,
  settings: LPRegistrySettings
): Transaction {
  const tx = new Transaction();

  // First update settings (with minimal delay for immediate rebalance)
  tx.moveCall({
    target: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::update_settings`,
    arguments: [
      tx.object(registeredPositionId),
      tx.pure.bool(settings.autoRebalance),
      tx.pure.bool(settings.autoCompound),
      tx.pure.u64(settings.recurringCount),
      tx.pure.u64(1000), // 1 second delay for immediate rebalance
      tx.pure.u64(settings.rangePercentBps),
      tx.pure.bool(settings.useZap),
      tx.object(LP_REGISTRY_CONFIG.clockId),
    ],
  });

  // Then request rebalance (marks position as pending rebalance)
  // This can be called by the owner (unlike mark_out_of_range which is operator-only)
  tx.moveCall({
    target: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::request_rebalance`,
    arguments: [
      tx.object(registeredPositionId),
      tx.object(LP_REGISTRY_CONFIG.clockId),
    ],
  });

  return tx;
}

/**
 * Build transaction to pause position automation
 */
export function buildPauseTransaction(registeredPositionId: string): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::pause`,
    arguments: [
      tx.object(registeredPositionId),
      tx.object(LP_REGISTRY_CONFIG.clockId),
    ],
  });

  return tx;
}

/**
 * Build transaction to resume position automation
 */
export function buildResumeTransaction(registeredPositionId: string): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::resume`,
    arguments: [
      tx.object(registeredPositionId),
      tx.object(LP_REGISTRY_CONFIG.clockId),
    ],
  });

  return tx;
}

/**
 * Build transaction to exit and retrieve position
 */
export function buildExitTransaction(
  registeredPositionId: string,
  tokenXType: string,
  tokenYType: string,
  rawPositionType?: string // Exact type from blockchain (preferred)
): Transaction {
  const tx = new Transaction();

  // Use exact position type from blockchain if available, otherwise construct it
  let positionType: string;
  if (rawPositionType) {
    positionType = rawPositionType;
    console.log('Using exact position type from blockchain:', positionType);
  } else {
    // Fallback: construct the position type
    if (!tokenXType || !tokenYType) {
      console.error('Exit: Missing token types!', { tokenXType, tokenYType, registeredPositionId });
      throw new Error('Cannot exit: token types not loaded. Please refresh and try again.');
    }
    positionType = `${LP_REGISTRY_CONFIG.mmtPositionTypePrefix}<${tokenXType},${tokenYType}>`;
    console.log('Constructed position type (fallback):', positionType);
  }

  console.log('Building exit transaction:', {
    registeredPositionId,
    positionType,
    registryId: LP_REGISTRY_CONFIG.registryId,
  });

  tx.moveCall({
    target: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::exit_and_return`,
    typeArguments: [positionType],
    arguments: [
      tx.object(LP_REGISTRY_CONFIG.registryId),
      tx.object(registeredPositionId),
    ],
  });

  return tx;
}

// ============ Query Functions ============

/**
 * Fetch all registered positions for an owner
 */
export async function fetchUserRegisteredPositions(
  client: SuiClient,
  ownerAddress: string
): Promise<LPRegistryPosition[]> {
  const positions: LPRegistryPosition[] = [];

  try {
    // Query PositionRegistered events
    const events = await client.queryEvents({
      query: {
        MoveEventType: `${LP_REGISTRY_CONFIG.packageId}::lp_registry::PositionRegistered`,
      },
      order: 'descending',
      limit: 100,
    });

    for (const event of events.data) {
      const eventData = event.parsedJson as {
        position_id: string;
        registry_id: string;
        owner: string;
        pool_id: string;
        auto_rebalance: boolean;
        auto_compound: boolean;
        rebalance_delay_ms: string;
      };

      // Only process positions owned by this user
      if (eventData.owner !== ownerAddress) continue;

      try {
        // Fetch the RegisteredPosition object
        const regPosObj = await client.getObject({
          id: eventData.registry_id,
          options: { showContent: true, showType: true },
        });

        if (!regPosObj.data?.content || regPosObj.data.content.dataType !== 'moveObject') {
          continue;
        }

        const fields = regPosObj.data.content.fields as Record<string, unknown>;

        // Check if position still exists (not exited)
        if (!regPosObj.data) continue;

        positions.push({
          id: eventData.registry_id,
          positionId: eventData.position_id,
          owner: eventData.owner,
          poolId: eventData.pool_id,
          tokenXType: '', // Will be filled from type parsing
          tokenYType: '',

          // Feature toggles
          autoRebalance: fields.auto_rebalance as boolean || false,
          autoCompound: fields.auto_compound as boolean || false,
          recurringCount: Number(fields.recurring_count || 0),

          // Rebalance settings
          rebalanceDelayMs: Number(fields.rebalance_delay_ms || 0),
          rangePercentBps: Number(fields.range_percent_bps || 500),
          useZap: (fields.use_zap as boolean) ?? true,

          // State
          isPaused: fields.is_paused as boolean || false,
          isPositionHeld: fields.is_position_held as boolean || false,
          rebalancePending: fields.rebalance_pending as boolean || false,
          outOfRangeSince: Number(fields.out_of_range_since || 0),

          // Stats
          rebalanceCount: Number(fields.rebalance_count || 0),
          compoundCount: Number(fields.compound_count || 0),
          registeredAt: Number(fields.registered_at || 0),
          lastActivityAt: Number(fields.last_activity_at || 0),
        });

      } catch (error) {
        // Position might have been exited
        console.warn(`Position ${eventData.registry_id} not found (may have exited)`);
      }
    }
  } catch (error) {
    console.error('Failed to fetch registered positions:', error);
  }

  return positions;
}

/**
 * Fetch a single registered position by ID
 */
export async function fetchRegisteredPosition(
  client: SuiClient,
  registeredPositionId: string
): Promise<LPRegistryPosition | null> {
  try {
    const regPosObj = await client.getObject({
      id: registeredPositionId,
      options: { showContent: true, showType: true },
    });

    if (!regPosObj.data?.content || regPosObj.data.content.dataType !== 'moveObject') {
      return null;
    }

    const fields = regPosObj.data.content.fields as Record<string, unknown>;

    return {
      id: registeredPositionId,
      positionId: '', // Would need to look at dynamic fields
      owner: fields.owner as string,
      poolId: fields.pool_id as string,
      tokenXType: '',
      tokenYType: '',

      autoRebalance: fields.auto_rebalance as boolean || false,
      autoCompound: fields.auto_compound as boolean || false,
      recurringCount: Number(fields.recurring_count || 0),

      rebalanceDelayMs: Number(fields.rebalance_delay_ms || 0),
      rangePercentBps: Number(fields.range_percent_bps || 500),
      useZap: (fields.use_zap as boolean) ?? true,

      isPaused: fields.is_paused as boolean || false,
      isPositionHeld: fields.is_position_held as boolean || false,
      rebalancePending: fields.rebalance_pending as boolean || false,
      outOfRangeSince: Number(fields.out_of_range_since || 0),

      rebalanceCount: Number(fields.rebalance_count || 0),
      compoundCount: Number(fields.compound_count || 0),
      registeredAt: Number(fields.registered_at || 0),
      lastActivityAt: Number(fields.last_activity_at || 0),
    };
  } catch (error) {
    console.error('Failed to fetch registered position:', error);
    return null;
  }
}

/**
 * Check if registry contract is deployed
 */
export function isRegistryDeployed(): boolean {
  return !LP_REGISTRY_CONFIG.packageId.includes('PLACEHOLDER') &&
    !LP_REGISTRY_CONFIG.registryId.includes('PLACEHOLDER');
}

// ============ Utility Functions ============

/**
 * Format rebalance delay for display
 */
export function formatRebalanceDelay(ms: number): string {
  if (ms === 0) return 'Immediate';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

/**
 * Format range percent for display
 */
export function formatRangePercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/**
 * Format recurring count for display
 */
export function formatRecurringCount(count: number): string {
  if (count === 0) return '∞';
  return String(count);
}

/**
 * Get status label for position
 */
export function getPositionStatus(position: LPRegistryPosition): {
  label: string;
  color: 'green' | 'yellow' | 'red' | 'blue' | 'gray';
} {
  if (position.isPaused) {
    return { label: 'Paused', color: 'gray' };
  }
  if (position.isPositionHeld) {
    return { label: 'Processing', color: 'blue' };
  }
  if (position.rebalancePending) {
    return { label: 'Waiting to Rebalance', color: 'yellow' };
  }
  if (position.isInRange === false) {
    return { label: 'Out of Range', color: 'red' };
  }
  return { label: 'Active', color: 'green' };
}

/**
 * Calculate time remaining until rebalance (if pending)
 */
export function getTimeUntilRebalance(position: LPRegistryPosition): number | null {
  if (!position.rebalancePending || position.outOfRangeSince === 0) {
    return null;
  }
  const rebalanceAt = position.outOfRangeSince + position.rebalanceDelayMs;
  const remaining = rebalanceAt - Date.now();
  return remaining > 0 ? remaining : 0;
}
