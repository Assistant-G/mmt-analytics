/**
 * Escrow Service
 *
 * Frontend service for interacting with the MMT Automation escrow contracts.
 * Handles depositing positions into escrow for auto-close functionality.
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import type { EventId } from '@mysten/sui/client';

// ============ Configuration ============
// Deployed to Sui Mainnet
export const ESCROW_CONFIG = {
  packageId: '0x302a07fee2847fd203aaaac779b7a5a9454a028b515f288fc27a5fe83cce11f9',
  configId: '0x75ff1fbdbdf3e66aab9e490970e904a4e8d99a5f169ca3c7d2bdbf663ae8f369',
  registryId: '0x14d288bb6d57746aeb57bde5f3532420eceed654d4da4be43b94b10d727c8fe0',
  clockId: '0x6', // Sui system clock
  isDeployed: true, // Contracts are live on mainnet
};

// Position type from MMT Finance (Momentum DEX v3)
// Package ID from: https://developers.mmt.finance/clmm-smart-contracts/deployments
const MMT_POSITION_TYPE = '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860::position::Position';

// ============ Types ============
export interface EscrowPosition {
  escrowId: string;
  positionId: string;
  owner: string;
  poolId: string;
  expiresAt: number;
  autoReopen: boolean;
  reopenRangePercent: number;
  remainingRepeats: number;
}

export interface CreateEscrowParams {
  positionId: string;
  poolId: string;
  expiresAt: number; // Unix timestamp in milliseconds
  autoReopen?: boolean;
  reopenRangePercent?: number;
  remainingRepeats?: number;
}

// ============ Service Functions ============

/**
 * Check if escrow contracts are deployed and configured
 */
export function isEscrowAvailable(): boolean {
  return ESCROW_CONFIG.isDeployed && !ESCROW_CONFIG.packageId.includes('TODO');
}

/**
 * Build a transaction to deposit a position into escrow
 *
 * @param params - Escrow parameters
 * @returns Transaction object ready to sign
 */
export function buildCreateEscrowTransaction(params: CreateEscrowParams): Transaction {
  const {
    positionId,
    poolId,
    expiresAt,
    autoReopen = false,
    reopenRangePercent = 500, // 5% default
    remainingRepeats = 0,
  } = params;

  // Add 2 minutes buffer to the expiry to account for:
  // 1. Clock skew between browser and blockchain
  // 2. Transaction signing time
  // 3. Dry run simulation time
  // 4. Block finalization time
  const safeExpiresAt = expiresAt + 120000; // Always add 2 minutes

  const tx = new Transaction();

  // Call simple_escrow::create_escrow
  tx.moveCall({
    target: `${ESCROW_CONFIG.packageId}::simple_escrow::create_escrow`,
    typeArguments: [MMT_POSITION_TYPE],
    arguments: [
      tx.object(ESCROW_CONFIG.configId), // config
      tx.object(positionId), // position NFT
      tx.pure.address(poolId), // pool_id
      tx.pure.u64(safeExpiresAt), // expires_at (with safety buffer)
      tx.pure.bool(autoReopen), // auto_reopen
      tx.pure.u64(reopenRangePercent), // reopen_range_percent (basis points * 100)
      tx.pure.u64(remainingRepeats), // remaining_repeats
      tx.object(ESCROW_CONFIG.clockId), // clock
    ],
  });

  return tx;
}

/**
 * Build a transaction to cancel an escrow and return position to owner
 *
 * @param escrowId - The escrow object ID
 * @returns Transaction object ready to sign
 */
export function buildCancelEscrowTransaction(escrowId: string): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${ESCROW_CONFIG.packageId}::simple_escrow::cancel_and_return`,
    typeArguments: [MMT_POSITION_TYPE],
    arguments: [
      tx.object(ESCROW_CONFIG.configId), // config
      tx.object(escrowId), // escrow
      tx.object(ESCROW_CONFIG.clockId), // clock
    ],
  });

  return tx;
}

/**
 * Query all escrows owned by an address
 *
 * @param client - SuiClient instance
 * @param ownerAddress - The owner's address
 * @returns Array of escrow positions
 */
export async function getEscrowsByOwner(
  client: SuiClient,
  ownerAddress: string
): Promise<EscrowPosition[]> {
  const escrows: EscrowPosition[] = [];

  // Query EscrowCreated events for this owner
  const eventType = `${ESCROW_CONFIG.packageId}::simple_escrow::EscrowCreated`;

  try {
    let cursor: EventId | null | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      const events = await client.queryEvents({
        query: { MoveEventType: eventType },
        order: 'descending',
        cursor: cursor ?? undefined,
        limit: 50,
      });

      for (const event of events.data) {
        const data = event.parsedJson as Record<string, unknown>;

        // Check if this escrow belongs to the owner
        if (data.owner !== ownerAddress) {
          continue;
        }

        const escrowId = data.escrow_id as string;

        // Check if escrow still exists (not cancelled/executed)
        try {
          const obj = await client.getObject({
            id: escrowId,
            options: { showContent: true },
          });

          if (obj.data?.content && 'fields' in obj.data.content) {
            const fields = obj.data.content.fields as Record<string, unknown>;
            escrows.push({
              escrowId,
              positionId: data.position_id as string,
              owner: fields.owner as string,
              poolId: fields.pool_id as string,
              expiresAt: Number(fields.expires_at),
              autoReopen: fields.auto_reopen as boolean,
              reopenRangePercent: Number(fields.reopen_range_percent),
              remainingRepeats: Number(fields.remaining_repeats),
            });
          }
        } catch {
          // Escrow no longer exists (cancelled or executed)
        }
      }

      cursor = events.nextCursor;
      hasMore = events.hasNextPage;
    }
  } catch (error) {
    console.error('Error querying escrows:', error);
  }

  return escrows;
}

/**
 * Get a single escrow by ID
 */
export async function getEscrowById(
  client: SuiClient,
  escrowId: string
): Promise<EscrowPosition | null> {
  try {
    const obj = await client.getObject({
      id: escrowId,
      options: { showContent: true },
    });

    if (obj.data?.content && 'fields' in obj.data.content) {
      const fields = obj.data.content.fields as Record<string, unknown>;
      return {
        escrowId,
        positionId: '', // Would need to query the dynamic object field
        owner: fields.owner as string,
        poolId: fields.pool_id as string,
        expiresAt: Number(fields.expires_at),
        autoReopen: fields.auto_reopen as boolean,
        reopenRangePercent: Number(fields.reopen_range_percent),
        remainingRepeats: Number(fields.remaining_repeats),
      };
    }
  } catch (error) {
    console.error('Error fetching escrow:', error);
  }

  return null;
}

/**
 * Calculate time remaining for an escrow
 */
export function getTimeRemaining(expiresAt: number): number {
  const now = Date.now();
  return Math.max(0, expiresAt - now);
}

/**
 * Check if an escrow has expired
 */
export function isExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}

/**
 * Format expiry time for display
 */
export function formatExpiryTime(expiresAt: number): string {
  const remaining = getTimeRemaining(expiresAt);

  if (remaining <= 0) {
    return 'Expired';
  }

  const seconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// ============ Configuration Update Helper ============
/**
 * Call this after deploying contracts to update configuration
 * This is meant to be called from the console or a setup script
 */
export function updateEscrowConfig(
  packageId: string,
  configId: string,
  registryId?: string
): void {
  console.log('Updating escrow configuration:');
  console.log('  Package ID:', packageId);
  console.log('  Config ID:', configId);
  console.log('  Registry ID:', registryId || 'N/A');
  console.log('\nUpdate ESCROW_CONFIG in src/services/escrowService.ts with these values.');
}
