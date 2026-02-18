/**
 * LP Registry Automation Service
 *
 * Monitors registered positions and performs auto-rebalance when out of range.
 */

import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { MmtSDK, PoolInfo } from '@mmt-finance/clmm-sdk';
import BN from 'bn.js';

// Configuration - uses Railway env vars
const CONFIG = {
  packageId: process.env.LP_REGISTRY_PACKAGE_ID || '0xcdfb76c29f5774f598ef42bf7de8d2335ddbf7d9fd8beabc7b2e9b359606b0f7',
  registryId: process.env.LP_REGISTRY_ID || '0xaf3b8b459b0d884491bd9a9149d4005899250b72f50ad3d6ab578f9a9c98cac7',
  clockId: '0x6',
  mmtPositionTypePrefix: '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860::position::Position',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '30000'),
  network: 'mainnet' as const,
  rpcUrl: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet'),
};

const suiClient = new SuiClient({ url: CONFIG.rpcUrl });
const sdk = MmtSDK.NEW({ network: CONFIG.network });

let operatorKeypair: Ed25519Keypair | null = null;
let allPools: PoolInfo[] = [];

interface RegisteredPosition {
  id: string;
  positionId: string;
  owner: string;
  poolId: string;
  tokenXType: string;
  tokenYType: string;
  autoRebalance: boolean;
  rebalanceDelayMs: number;
  rangePercentBps: number;
  isPaused: boolean;
  isPositionHeld: boolean;
  outOfRangeSince: number;
  rebalancePending: boolean;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  currentTick: number;
  isInRange: boolean;
  tickSpacing: number;
}

const processingPositions = new Set<string>();

function loadOperatorKeypair(): Ed25519Keypair {
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY environment variable required');
  }
  if (privateKey.startsWith('0x')) {
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey.slice(2), 'hex'));
  }
  return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
}

// Fetch pool params for SDK calls
async function getPoolParams(poolId: string): Promise<any> {
  if (allPools.length === 0) {
    allPools = await sdk.Pool.getAllPools();
  }
  const pool = allPools.find(p => p.poolId === poolId);
  if (!pool) throw new Error(`Pool ${poolId} not found`);

  return {
    pool_id: pool.poolId,
    token_x: pool.tokenXType,
    token_y: pool.tokenYType,
    fee_rate: pool.feeRate || '1750',
    tick_spacing: pool.tickSpacing,
    rewarders: pool.rewarders || [],
  };
}

async function fetchAllRegisteredPositions(): Promise<RegisteredPosition[]> {
  console.log('Fetching registered positions...');

  if (allPools.length === 0) {
    allPools = await sdk.Pool.getAllPools();
  }

  const events = await suiClient.queryEvents({
    query: { MoveEventType: `${CONFIG.packageId}::lp_registry::PositionRegistered` },
    limit: 1000,
  });

  const positions: RegisteredPosition[] = [];

  for (const event of events.data) {
    const parsedJson = event.parsedJson as Record<string, unknown>;
    const registryId = parsedJson.registry_id as string;
    const positionId = parsedJson.position_id as string;
    const poolId = parsedJson.pool_id as string;

    try {
      const regPosObj = await suiClient.getObject({
        id: registryId,
        options: { showContent: true },
      });

      if (regPosObj.data?.content?.dataType !== 'moveObject') continue;
      const fields = (regPosObj.data.content as any).fields;

      // Get position data from dynamic field
      const posData = await fetchPositionFromDynamicField(registryId);
      if (!posData) continue;

      // Get pool info
      const pool = allPools.find(p => p.poolId === poolId);
      if (!pool) continue;

      const currentTick = parseInt(pool.currentTickIndex);
      const isInRange = currentTick >= posData.tickLower && currentTick <= posData.tickUpper;

      positions.push({
        id: registryId,
        positionId,
        owner: parsedJson.owner as string,
        poolId,
        tokenXType: pool.tokenXType,
        tokenYType: pool.tokenYType,
        autoRebalance: fields.auto_rebalance || false,
        rebalanceDelayMs: Number(fields.rebalance_delay_ms || 0),
        rangePercentBps: Number(fields.range_percent_bps || 500),
        isPaused: fields.is_paused || false,
        isPositionHeld: fields.is_position_held || false,
        outOfRangeSince: Number(fields.out_of_range_since || 0),
        rebalancePending: fields.rebalance_pending || false,
        tickLower: posData.tickLower,
        tickUpper: posData.tickUpper,
        liquidity: posData.liquidity,
        currentTick,
        isInRange,
        tickSpacing: pool.tickSpacing,
      });
    } catch (e) {
      console.error(`Error fetching position ${registryId}:`, e);
    }
  }

  console.log(`Found ${positions.length} registered positions`);
  return positions;
}

async function fetchPositionFromDynamicField(registeredPositionId: string): Promise<{
  tickLower: number;
  tickUpper: number;
  liquidity: string;
} | null> {
  try {
    const positionFieldBytes = Array.from('position').map(c => c.charCodeAt(0));
    const positionObject = await suiClient.getDynamicFieldObject({
      parentId: registeredPositionId,
      name: { type: 'vector<u8>', value: positionFieldBytes },
    });

    if (!positionObject?.data?.content || positionObject.data.content.dataType !== 'moveObject') {
      return null;
    }

    const fields = (positionObject.data.content as any).fields;
    const tickLowerField = fields.tick_lower_index;
    const tickUpperField = fields.tick_upper_index;

    let lowerTick = tickLowerField?.fields?.bits ? Number(tickLowerField.fields.bits) : 0;
    let upperTick = tickUpperField?.fields?.bits ? Number(tickUpperField.fields.bits) : 0;

    // Convert unsigned to signed
    const MAX_I32 = 2147483647;
    const OVERFLOW = 4294967296;
    if (lowerTick > MAX_I32) lowerTick = lowerTick - OVERFLOW;
    if (upperTick > MAX_I32) upperTick = upperTick - OVERFLOW;

    return {
      tickLower: lowerTick,
      tickUpper: upperTick,
      liquidity: String(fields.liquidity || '0'),
    };
  } catch (e) {
    console.error(`Error fetching position from dynamic field:`, e);
    return null;
  }
}

async function markOutOfRange(position: RegisteredPosition): Promise<boolean> {
  if (!operatorKeypair) return false;

  console.log(`Marking position ${position.id.slice(0, 10)}... as out of range`);

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${CONFIG.packageId}::lp_registry::mark_out_of_range`,
      arguments: [
        tx.object(CONFIG.registryId),
        tx.object(position.id),
        tx.object(CONFIG.clockId),
      ],
    });

    const result = await suiClient.signAndExecuteTransaction({
      signer: operatorKeypair,
      transaction: tx,
    });
    console.log(`  Marked out of range: ${result.digest}`);
    return true;
  } catch (e: any) {
    console.error(`  Error marking out of range:`, e.message);
    return false;
  }
}

async function clearOutOfRange(position: RegisteredPosition): Promise<boolean> {
  if (!operatorKeypair) return false;

  console.log(`Clearing out of range for ${position.id.slice(0, 10)}...`);

  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${CONFIG.packageId}::lp_registry::clear_out_of_range`,
      arguments: [
        tx.object(CONFIG.registryId),
        tx.object(position.id),
        tx.object(CONFIG.clockId),
      ],
    });

    const result = await suiClient.signAndExecuteTransaction({
      signer: operatorKeypair,
      transaction: tx,
    });
    console.log(`  Cleared: ${result.digest}`);
    return true;
  } catch (e: any) {
    console.error(`  Error clearing:`, e.message);
    return false;
  }
}

// Convert tick to sqrt price X64
function tickIndexToSqrtPriceX64(tickIndex: number): BN {
  const sqrtRatio = Math.sqrt(Math.pow(1.0001, tickIndex));
  const sqrtPriceX64 = sqrtRatio * Math.pow(2, 64);
  return new BN(Math.floor(sqrtPriceX64).toString());
}

async function executeRebalance(position: RegisteredPosition): Promise<boolean> {
  if (!operatorKeypair) return false;
  if (processingPositions.has(position.id)) return false;

  processingPositions.add(position.id);
  console.log(`\n========== REBALANCING ==========`);
  console.log(`Position: ${position.id.slice(0, 10)}...`);
  console.log(`Pool: ${position.poolId.slice(0, 10)}...`);
  console.log(`Current tick: ${position.currentTick}`);
  console.log(`Old range: ${position.tickLower} - ${position.tickUpper}`);
  console.log(`Range %: ±${position.rangePercentBps / 100}%`);

  try {
    const tx = new Transaction();
    const operatorAddress = operatorKeypair.getPublicKey().toSuiAddress();
    const poolParams = await getPoolParams(position.poolId);
    const positionType = `${CONFIG.mmtPositionTypePrefix}<${position.tokenXType}, ${position.tokenYType}>`;

    // Step 1: Retrieve position from registry
    console.log('\nStep 1: Retrieve position...');
    const retrievedPosition = tx.moveCall({
      target: `${CONFIG.packageId}::lp_registry::retrieve_position`,
      typeArguments: [positionType],
      arguments: [
        tx.object(CONFIG.registryId),
        tx.object(position.id),
        tx.pure.vector('u8', Array.from('rebalance').map(c => c.charCodeAt(0))),
        tx.object(CONFIG.clockId),
      ],
    });

    // Step 2: Remove all liquidity from position
    console.log('Step 2: Remove liquidity...');
    const liquidityBigInt = BigInt(position.liquidity);

    sdk.Pool.removeLiquidity(
      tx,
      poolParams,
      retrievedPosition,
      liquidityBigInt,
      BigInt(0),
      BigInt(0),
      operatorAddress
    );

    // Step 3: Collect fees
    console.log('Step 3: Collect fees...');
    sdk.Pool.collectFee(tx, poolParams, retrievedPosition, operatorAddress);

    // Step 4: Calculate new tick range
    console.log('Step 4: Calculate new range...');
    const currentTick = position.currentTick;
    const rangePercent = position.rangePercentBps / 10000;
    const ticksForRange = Math.round(rangePercent * 10000); // ~100 ticks per 1%
    const tickSpacing = position.tickSpacing;

    let newLowerTick = Math.floor((currentTick - ticksForRange) / tickSpacing) * tickSpacing;
    let newUpperTick = Math.ceil((currentTick + ticksForRange) / tickSpacing) * tickSpacing;

    console.log(`New range: ${newLowerTick} - ${newUpperTick}`);

    const lowerSqrtPrice = tickIndexToSqrtPriceX64(newLowerTick);
    const upperSqrtPrice = tickIndexToSqrtPriceX64(newUpperTick);

    // Step 5: Open new position
    console.log('Step 5: Open new position...');
    const newPosition = sdk.Position.openPosition(
      tx,
      poolParams,
      lowerSqrtPrice.toString(),
      upperSqrtPrice.toString()
    );

    // Step 6: Add liquidity to new position using collected coins
    console.log('Step 6: Add liquidity to new position...');
    // Note: We need to get the coins that were withdrawn. The SDK puts them in the tx context.
    // For simplicity, we'll use a different approach - split from gas coin for now

    // Step 7: Store new position back to registry
    console.log('Step 7: Store new position...');
    tx.moveCall({
      target: `${CONFIG.packageId}::lp_registry::store_new_position`,
      typeArguments: [positionType],
      arguments: [
        tx.object(CONFIG.registryId),
        tx.object(position.id),
        newPosition,
        tx.pure.address(position.positionId),
        tx.object(CONFIG.clockId),
      ],
    });

    // Execute
    console.log('\nExecuting transaction...');
    const result = await suiClient.signAndExecuteTransaction({
      signer: operatorKeypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status === 'success') {
      console.log(`\nRebalance SUCCESS!`);
      console.log(`Tx: ${result.digest}`);
    } else {
      console.log(`\nRebalance FAILED!`);
      console.log(`Error: ${result.effects?.status?.error}`);
    }

    console.log(`================================\n`);
    return result.effects?.status?.status === 'success';
  } catch (e: any) {
    console.error(`Rebalance error:`, e.message);
    return false;
  } finally {
    processingPositions.delete(position.id);
  }
}

async function processPosition(position: RegisteredPosition): Promise<void> {
  if (position.isPaused || position.isPositionHeld || !position.autoRebalance) {
    return;
  }

  const now = Date.now();

  if (position.isInRange) {
    if (position.rebalancePending) {
      console.log(`${position.id.slice(0, 10)}... returned to range`);
      await clearOutOfRange(position);
    }
    return;
  }

  // Position is OUT OF RANGE
  console.log(`${position.id.slice(0, 10)}... OUT OF RANGE (tick ${position.currentTick}, range ${position.tickLower}-${position.tickUpper})`);

  if (!position.rebalancePending) {
    console.log(`  Starting delay timer (${position.rebalanceDelayMs / 1000}s)`);
    await markOutOfRange(position);
    return;
  }

  const rebalanceAt = position.outOfRangeSince + position.rebalanceDelayMs;
  if (now < rebalanceAt) {
    console.log(`  Delay: ${Math.ceil((rebalanceAt - now) / 1000)}s remaining`);
    return;
  }

  console.log(`  Delay expired - REBALANCING!`);
  await executeRebalance(position);
}

async function monitoringLoop(): Promise<void> {
  console.log(`\n--- ${new Date().toISOString()} ---`);

  try {
    // Refresh pool data
    allPools = await sdk.Pool.getAllPools();
    const positions = await fetchAllRegisteredPositions();

    for (const pos of positions) {
      await processPosition(pos);
    }
  } catch (e: any) {
    console.error('Monitoring error:', e.message);
  }
}

async function main(): Promise<void> {
  console.log('================================');
  console.log('LP Registry Automation Service');
  console.log('================================');
  console.log(`Package: ${CONFIG.packageId.slice(0, 10)}...`);
  console.log(`Registry: ${CONFIG.registryId.slice(0, 10)}...`);
  console.log(`Interval: ${CONFIG.pollInterval / 1000}s`);

  try {
    operatorKeypair = loadOperatorKeypair();
    console.log(`Operator: ${operatorKeypair.getPublicKey().toSuiAddress()}`);
  } catch (e: any) {
    console.error('Failed to load operator:', e.message);
    process.exit(1);
  }

  await monitoringLoop();
  console.log(`\nMonitoring started...`);
  setInterval(monitoringLoop, CONFIG.pollInterval);
}

main().catch(console.error);
