/**
 * MMT Escrow Backend Service
 *
 * Monitors escrow contracts and executes position closes when timers expire.
 * This service runs on a server and automatically closes positions for users
 * who have deposited them into escrow.
 *
 * Setup:
 * 1. Deploy the contracts and update PACKAGE_ID and CONFIG_ID below
 * 2. Fund the executor wallet with SUI for gas
 * 3. Set EXECUTOR_PRIVATE_KEY environment variable
 * 4. Run: npx ts-node escrow-service.ts
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import type { SuiObjectResponse } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { MmtSDK } from '@mmt-finance/clmm-sdk';

// ============ Configuration ============
// Our escrow contract (deployed to Sui Mainnet)
const ESCROW_PACKAGE_ID = '0x302a07fee2847fd203aaaac779b7a5a9454a028b515f288fc27a5fe83cce11f9';
const ESCROW_CONFIG_ID = '0x75ff1fbdbdf3e66aab9e490970e904a4e8d99a5f169ca3c7d2bdbf663ae8f369';

// MMT Finance contract addresses (from SDK config)
// packageId is the current/latest version for function calls
const MMT_PACKAGE_ID = '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1';
// publishedAt is where Position type was originally defined
const MMT_PUBLISHED_AT = '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860';
const MMT_VERSION_ID = '0x2375a0b1ec12010aaea3b2545acfa2ad34cfbba03ce4b59f4c39e1e25eed1b2a';

// Network and timing
const NETWORK = 'mainnet';
const POLLING_INTERVAL_MS = 10_000; // Check every 10 seconds
const CLOCK_OBJECT_ID = '0x6'; // Sui system clock object

// Position type (must use publishedAt - where the type was originally defined)
const MMT_POSITION_TYPE = `${MMT_PUBLISHED_AT}::position::Position`;

// ============ Types ============
interface EscrowData {
  id: string;
  owner: string;
  poolId: string;
  expiresAt: number;
  autoReopen: boolean;
  reopenRangePercent: number;
  remainingRepeats: number;
  positionId?: string;
}

interface PoolData {
  objectId: string;
  tokenXType: string;
  tokenYType: string;
  tickSpacing: number;
  rewarders: Array<{ coin_type: string }>;
}

interface PositionData {
  liquidity: string;
  tickLower: number;
  tickUpper: number;
}

// ============ Service Class ============
class EscrowService {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private sdk: MmtSDK;
  private executorAddress: string;
  private isRunning: boolean = false;

  constructor() {
    // Initialize Sui client
    this.client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

    // Initialize MMT SDK
    this.sdk = MmtSDK.NEW({ network: NETWORK });

    // Load executor keypair
    const privateKey = process.env.EXECUTOR_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('EXECUTOR_PRIVATE_KEY environment variable is required');
    }

    if (privateKey.startsWith('suiprivkey')) {
      this.keypair = Ed25519Keypair.fromSecretKey(privateKey);
    } else if (privateKey.length === 64) {
      this.keypair = Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
    } else {
      this.keypair = Ed25519Keypair.fromSecretKey(fromBase64(privateKey));
    }

    this.executorAddress = this.keypair.getPublicKey().toSuiAddress();
    console.log(`Executor address: ${this.executorAddress}`);
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('Starting Escrow Service...');
    console.log(`Escrow Package: ${ESCROW_PACKAGE_ID}`);
    console.log(`MMT Package: ${MMT_PACKAGE_ID}`);
    console.log(`Polling interval: ${POLLING_INTERVAL_MS}ms`);

    // Check executor balance
    const balance = await this.client.getBalance({ owner: this.executorAddress });
    console.log(`Executor balance: ${Number(balance.totalBalance) / 1e9} SUI`);

    if (BigInt(balance.totalBalance) < BigInt(10_000_000)) {
      console.warn('⚠️ Low executor balance! Add more SUI for gas.');
    }

    this.isRunning = true;
    this.poll();
  }

  /**
   * Stop the service
   */
  stop(): void {
    console.log('Stopping Escrow Service...');
    this.isRunning = false;
  }

  /**
   * Main polling loop
   */
  private async poll(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.checkAndExecuteExpiredEscrows();
      } catch (error) {
        console.error('Error in polling loop:', error);
      }

      await this.sleep(POLLING_INTERVAL_MS);
    }
  }

  /**
   * Find and execute all expired escrows
   */
  private async checkAndExecuteExpiredEscrows(): Promise<void> {
    const escrows = await this.getActiveEscrows();
    const now = Date.now();

    console.log(`Found ${escrows.length} active escrows`);

    for (const escrow of escrows) {
      if (escrow.expiresAt <= now) {
        console.log(`Escrow ${escrow.id} has expired (was due at ${new Date(escrow.expiresAt).toISOString()})`);
        try {
          await this.executeClose(escrow);
          console.log(`✅ Successfully closed escrow ${escrow.id}`);
        } catch (error) {
          console.error(`❌ Failed to close escrow ${escrow.id}:`, error);
        }
      }
    }
  }

  /**
   * Get all active escrow objects from the chain by querying events
   */
  private async getActiveEscrows(): Promise<EscrowData[]> {
    const escrows: EscrowData[] = [];
    const createdEscrowIds = new Set<string>();
    const closedEscrowIds = new Set<string>();

    // Query EscrowCreated events to find all escrows
    const createdEventType = `${ESCROW_PACKAGE_ID}::simple_escrow::EscrowCreated`;
    let cursor: { txDigest: string; eventSeq: string } | null = null;
    let hasMore = true;

    console.log('Querying EscrowCreated events...');

    while (hasMore) {
      const response = await this.client.queryEvents({
        query: { MoveEventType: createdEventType },
        cursor: cursor || undefined,
        order: 'ascending',
      });

      for (const event of response.data) {
        const data = event.parsedJson as { escrow_id: string };
        if (data?.escrow_id) {
          createdEscrowIds.add(data.escrow_id);
        }
      }

      cursor = response.nextCursor ?? null;
      hasMore = response.hasNextPage;
    }

    console.log(`Found ${createdEscrowIds.size} created escrows`);

    // Query EscrowExecuted and EscrowCancelled events to find closed ones
    const executedEventType = `${ESCROW_PACKAGE_ID}::simple_escrow::EscrowExecuted`;
    const cancelledEventType = `${ESCROW_PACKAGE_ID}::simple_escrow::EscrowCancelled`;

    for (const eventType of [executedEventType, cancelledEventType]) {
      cursor = null;
      hasMore = true;

      while (hasMore) {
        const response = await this.client.queryEvents({
          query: { MoveEventType: eventType },
          cursor: cursor || undefined,
          order: 'ascending',
        });

        for (const event of response.data) {
          const data = event.parsedJson as { escrow_id: string };
          if (data?.escrow_id) {
            closedEscrowIds.add(data.escrow_id);
          }
        }

        cursor = response.nextCursor ?? null;
        hasMore = response.hasNextPage;
      }
    }

    console.log(`Found ${closedEscrowIds.size} closed escrows`);

    // Get active escrow IDs (created but not closed)
    const activeEscrowIds = [...createdEscrowIds].filter(id => !closedEscrowIds.has(id));
    console.log(`Active escrows: ${activeEscrowIds.length}`);

    // Fetch each active escrow object
    for (const escrowId of activeEscrowIds) {
      try {
        const obj = await this.client.getObject({
          id: escrowId,
          options: { showContent: true },
        });

        const escrow = this.parseEscrowObject(obj);
        if (escrow) {
          escrows.push(escrow);
        }
      } catch (error) {
        console.warn(`Failed to fetch escrow ${escrowId}:`, error);
      }
    }

    return escrows;
  }

  /**
   * Parse escrow object data
   */
  private parseEscrowObject(obj: SuiObjectResponse): EscrowData | null {
    if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
      return null;
    }

    const fields = obj.data.content.fields as Record<string, unknown>;

    return {
      id: obj.data.objectId,
      owner: fields.owner as string,
      poolId: fields.pool_id as string,
      expiresAt: Number(fields.expires_at),
      autoReopen: fields.auto_reopen as boolean,
      reopenRangePercent: Number(fields.reopen_range_percent),
      remainingRepeats: Number(fields.remaining_repeats),
    };
  }

  /**
   * Get pool data from MMT SDK
   */
  private async getPoolData(poolId: string): Promise<PoolData> {
    const pool = await this.sdk.Pool.getPool(poolId);
    if (!pool) {
      throw new Error(`Pool not found: ${poolId}`);
    }

    return {
      objectId: pool.poolId,
      tokenXType: pool.tokenXType,
      tokenYType: pool.tokenYType,
      tickSpacing: pool.tickSpacing,
      rewarders: pool.rewarders || [],
    };
  }

  /**
   * Get position data by querying the escrow's dynamic object field
   */
  private async getPositionFromEscrow(escrowId: string): Promise<{ positionId: string; liquidity: string } | null> {
    try {
      // Query the dynamic object field where position is stored
      const dynamicFields = await this.client.getDynamicFields({
        parentId: escrowId,
      });

      for (const field of dynamicFields.data) {
        if (field.objectType?.includes('Position')) {
          const positionObj = await this.client.getObject({
            id: field.objectId,
            options: { showContent: true },
          });

          if (positionObj.data?.content && positionObj.data.content.dataType === 'moveObject') {
            const fields = positionObj.data.content.fields as Record<string, unknown>;
            return {
              positionId: field.objectId,
              liquidity: String(fields.liquidity || '0'),
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.warn('Failed to get position from escrow:', error);
      return null;
    }
  }

  /**
   * Execute a position close for an expired escrow
   * Uses direct Move calls to MMT contracts
   */
  private async executeClose(escrow: EscrowData): Promise<void> {
    console.log(`Executing close for escrow ${escrow.id}...`);
    console.log(`  Owner: ${escrow.owner}`);
    console.log(`  Pool: ${escrow.poolId}`);

    // Get pool data for token types
    const pool = await this.getPoolData(escrow.poolId);
    console.log(`  Token X: ${pool.tokenXType}`);
    console.log(`  Token Y: ${pool.tokenYType}`);

    // Get position data (liquidity)
    const positionInfo = await this.getPositionFromEscrow(escrow.id);
    if (!positionInfo) {
      throw new Error('Failed to get position from escrow');
    }
    console.log(`  Position: ${positionInfo.positionId}`);
    console.log(`  Liquidity: ${positionInfo.liquidity}`);

    // Build transaction
    const tx = new Transaction();

    // 1. Call our escrow contract to withdraw position
    // Returns: (Position, ownerAddress)
    const [position, _owner] = tx.moveCall({
      target: `${ESCROW_PACKAGE_ID}::simple_escrow::execute`,
      typeArguments: [MMT_POSITION_TYPE],
      arguments: [
        tx.object(ESCROW_CONFIG_ID),
        tx.object(escrow.id),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });

    // 2. Remove all liquidity using direct Move call to MMT
    const liquidity = BigInt(positionInfo.liquidity);
    const [coinX, coinY] = tx.moveCall({
      target: `${MMT_PACKAGE_ID}::liquidity::remove_liquidity`,
      typeArguments: [pool.tokenXType, pool.tokenYType],
      arguments: [
        tx.object(pool.objectId),
        position,  // Use transaction result directly
        tx.pure.u128(liquidity),
        tx.pure.u64(0), // min_amount_x (accept any)
        tx.pure.u64(0), // min_amount_y (accept any)
        tx.object(CLOCK_OBJECT_ID),
        tx.object(MMT_VERSION_ID),
      ],
    });

    // 3. Collect trading fees
    const [feeX, feeY] = tx.moveCall({
      target: `${MMT_PACKAGE_ID}::collect::fee`,
      typeArguments: [pool.tokenXType, pool.tokenYType],
      arguments: [
        tx.object(pool.objectId),
        position,
        tx.object(CLOCK_OBJECT_ID),
        tx.object(MMT_VERSION_ID),
      ],
    });

    // 4. Collect rewards for each rewarder
    const rewardCoins: any[] = [];
    for (const rewarder of pool.rewarders) {
      const rewardCoin = tx.moveCall({
        target: `${MMT_PACKAGE_ID}::collect::reward`,
        typeArguments: [pool.tokenXType, pool.tokenYType, rewarder.coin_type],
        arguments: [
          tx.object(pool.objectId),
          position,
          tx.object(CLOCK_OBJECT_ID),
          tx.object(MMT_VERSION_ID),
        ],
      });
      rewardCoins.push(rewardCoin);
    }

    // 5. Transfer all coins to original owner
    tx.transferObjects([coinX, coinY, feeX, feeY, ...rewardCoins], escrow.owner);

    // 6. Transfer the (now empty) position NFT back to owner
    tx.transferObjects([position], escrow.owner);

    // Set gas budget and sender (50M = 0.05 SUI)
    tx.setGasBudget(50_000_000);
    tx.setSender(this.executorAddress);

    // Build and sign
    const builtTx = await tx.build({ client: this.client });
    const signature = (await this.keypair.signTransaction(builtTx)).signature;

    // Execute
    const result = await this.client.executeTransactionBlock({
      transactionBlock: builtTx,
      signature,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    if (result.effects?.status?.status !== 'success') {
      throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
    }

    console.log(`Transaction successful: ${result.digest}`);
    console.log(`View: https://suivision.xyz/txblock/${result.digest}`);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Main ============
async function main() {
  console.log('\n=== MMT Escrow Backend Service ===\n');

  const service = new EscrowService();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down...');
    service.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down...');
    service.stop();
    process.exit(0);
  });

  await service.start();
}

main().catch(console.error);
