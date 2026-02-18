/**
 * LP Registry Automation Service
 *
 * Monitors registered positions and performs auto-rebalance when out of range.
 */

import 'dotenv/config';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { MmtSDK, Types } from '@mmt-finance/clmm-sdk';
type PoolInfo = Types.ExtendedPoolWithApr;
import BN from 'bn.js';

// Configuration - uses Railway env vars
const CONFIG = {
  packageId: process.env.LP_REGISTRY_PACKAGE_ID || '0x4554604e6a3fcc8a412884a45c47d1265588644a99a32029b8070e5ff8067e94',
  registryId: process.env.LP_REGISTRY_ID || '0xf03558d2d9ce9648aceb6e43321c0024d594fe4bc202bbd2a60d34ce303ea52d',
  clockId: '0x6',
  mmtPositionTypePrefix: '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860::position::Position',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '30000'),
  network: 'mainnet' as const,
  rpcUrl: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet'),
};

const suiClient = new SuiClient({ url: CONFIG.rpcUrl });
const sdk = MmtSDK.NEW({ network: CONFIG.network });

// Log SDK config for debugging
console.log(`MMT SDK initialized - MVR Name: ${sdk.contractConst.mvrName}`);
console.log(`MMT Version ID: ${sdk.contractConst.versionId}`);

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
  useZap: boolean; // Swap excess tokens to use ALL liquidity
  isPaused: boolean;
  isPositionHeld: boolean;
  outOfRangeSince: number;
  rebalancePending: boolean;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  currentTick: number;
  currentSqrtPrice: string; // For ZAP calculations
  isInRange: boolean;
  tickSpacing: number;
  positionType: string; // Actual type from blockchain
}

const processingPositions = new Set<string>();

function loadOperatorKeypair(): Ed25519Keypair {
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY environment variable required');
  }

  // Handle Sui bech32 format (suiprivkey...)
  if (privateKey.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }

  // Handle hex format (0x...)
  if (privateKey.startsWith('0x')) {
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey.slice(2), 'hex'));
  }

  // Handle base64 format
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
    fee_rate: pool.lpFeesPercent || '1750',
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

      // Convert currentTick from unsigned to signed
      let currentTick = parseInt(pool.currentTickIndex);
      const MAX_I32 = 2147483647;
      const OVERFLOW = 4294967296;
      if (currentTick > MAX_I32) currentTick = currentTick - OVERFLOW;

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
        useZap: fields.use_zap ?? true, // Default to true for better UX
        isPaused: fields.is_paused || false,
        isPositionHeld: fields.is_position_held || false,
        outOfRangeSince: Number(fields.out_of_range_since || 0),
        rebalancePending: fields.rebalance_pending || false,
        tickLower: posData.tickLower,
        tickUpper: posData.tickUpper,
        liquidity: posData.liquidity,
        currentTick,
        currentSqrtPrice: pool.currentSqrtPrice,
        isInRange,
        tickSpacing: pool.tickSpacing,
        positionType: posData.positionType,
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
  positionType: string;
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

    // Get the actual position type from blockchain - this is the exact type string needed
    const positionType = positionObject.data.type || '';

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
      positionType,
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

/**
 * Calculate the exact token ratio needed for a CLMM position.
 *
 * For a position at sqrt_price P within range [Pa, Pb]:
 * - amount_x per unit liquidity = (sqrt_pb - sqrt_p) / (sqrt_p * sqrt_pb)
 * - amount_y per unit liquidity = (sqrt_p - sqrt_pa)
 *
 * Returns the fraction of total value that should be in token X (0 to 1)
 */
function calculateTargetXRatio(
  currentSqrtPriceX64: string,
  lowerTick: number,
  upperTick: number
): number {
  const sqrtP = Number(BigInt(currentSqrtPriceX64)) / (2 ** 64);
  const sqrtPa = Math.sqrt(Math.pow(1.0001, lowerTick));
  const sqrtPb = Math.sqrt(Math.pow(1.0001, upperTick));

  // If price is at or below lower bound: 100% X
  if (sqrtP <= sqrtPa) return 1.0;
  // If price is at or above upper bound: 100% Y (0% X)
  if (sqrtP >= sqrtPb) return 0.0;

  // In range: calculate based on CLMM math
  // amount_x per L = (sqrt_pb - sqrt_p) / (sqrt_p * sqrt_pb)
  // amount_y per L = (sqrt_p - sqrt_pa)
  const amountXPerL = (sqrtPb - sqrtP) / (sqrtP * sqrtPb);
  const amountYPerL = sqrtP - sqrtPa;

  // Convert X amount to Y-equivalent value using current price
  // price = sqrtP^2, so X_value_in_Y = amount_x * price
  const price = sqrtP * sqrtP;
  const xValueInY = amountXPerL * price;
  const yValue = amountYPerL;

  const totalValue = xValueInY + yValue;
  if (totalValue === 0) return 0.5;

  return xValueInY / totalValue;
}

/**
 * Calculate exact swap amount needed to achieve target ratio.
 *
 * Given current amounts (valueX, valueY) and target ratio (targetXRatio),
 * calculate how much to swap to achieve the target.
 *
 * Accounts for swap fee (e.g., 0.3% = 0.003)
 */
function calculateSwapAmount(
  valueX: number, // Current X value in Y terms
  valueY: number, // Current Y value
  targetXRatio: number, // Target ratio of X (0 to 1)
  swapFeeRate: number = 0.003 // 0.3% default
): { swapXtoY: boolean; amountToSwap: number; swapPercent: number } {
  const totalValue = valueX + valueY;
  const currentXRatio = valueX / totalValue;

  const targetXValue = totalValue * targetXRatio;
  const targetYValue = totalValue * (1 - targetXRatio);

  const xExcess = valueX - targetXValue;
  const yExcess = valueY - targetYValue;

  if (Math.abs(xExcess) < 0.0001 * totalValue) {
    // Already balanced within 0.01%
    return { swapXtoY: true, amountToSwap: 0, swapPercent: 0 };
  }

  if (xExcess > 0) {
    // Too much X, swap X → Y
    // After swap: X_new = X - swap_amount
    // Y_new = Y + swap_amount * (1 - fee) * (in Y terms, so just swap_amount * (1-fee) since we're in value terms)
    // We want X_new / (X_new + Y_new) = targetXRatio
    // Solving: swap_amount = xExcess / (1 + (1-fee) * (1-targetXRatio) / targetXRatio)
    // Simplified: swap_amount ≈ xExcess / (1 + (1-fee) * targetYRatio / targetXRatio)
    const adjustmentFactor = 1 + (1 - swapFeeRate) * (1 - targetXRatio) / Math.max(targetXRatio, 0.001);
    const swapAmountInY = xExcess / adjustmentFactor;
    // Convert back to X amount: swapAmountInY is in Y terms, X value = valueX, X amount proportional
    const swapPercent = swapAmountInY / valueX;

    return {
      swapXtoY: true,
      amountToSwap: swapAmountInY,
      swapPercent: Math.min(swapPercent, 0.95) // Cap at 95% to avoid edge cases
    };
  } else {
    // Too much Y, swap Y → X
    const adjustmentFactor = 1 + (1 - swapFeeRate) * targetXRatio / Math.max(1 - targetXRatio, 0.001);
    const swapAmount = Math.abs(yExcess) / adjustmentFactor;
    const swapPercent = swapAmount / valueY;

    return {
      swapXtoY: false,
      amountToSwap: swapAmount,
      swapPercent: Math.min(swapPercent, 0.95)
    };
  }
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
    // Add MVR plugin for automatic package version resolution
    tx.addSerializationPlugin(sdk.mvrNamedPackagesPlugin);
    const targetPackage = sdk.contractConst.mvrName; // '@mmt/clmm-core'

    const operatorAddress = operatorKeypair.getPublicKey().toSuiAddress();
    // Use the actual position type fetched from blockchain - this avoids TypeArityMismatch errors
    const positionType = position.positionType;
    console.log(`Position type: ${positionType}`);
    console.log(`Using MVR package: ${targetPackage}`);

    // Step 1: Retrieve position from registry
    console.log('\nStep 1: Retrieve position...');
    const [retrievedPosition] = tx.moveCall({
      target: `${CONFIG.packageId}::lp_registry::retrieve_position`,
      typeArguments: [positionType],
      arguments: [
        tx.object(CONFIG.registryId),
        tx.object(position.id),
        tx.pure.vector('u8', Array.from('rebalance').map(c => c.charCodeAt(0))),
        tx.object(CONFIG.clockId),
      ],
    });

    // Step 2: Collect fees FIRST (must be done before remove_liquidity per SDK)
    console.log('Step 2: Collect fees...');
    const [feeX, feeY] = tx.moveCall({
      target: `${targetPackage}::collect::fee`,
      typeArguments: [position.tokenXType, position.tokenYType],
      arguments: [
        tx.object(position.poolId),
        retrievedPosition,
        tx.object(CONFIG.clockId),
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Step 2b: Collect all rewards (farming incentives) - required before close_position
    const pool = allPools.find(p => p.poolId === position.poolId);
    const rewardCoins: any[] = [];
    if (pool?.rewarders && pool.rewarders.length > 0) {
      console.log(`Step 2b: Collecting ${pool.rewarders.length} rewards...`);
      for (const rewarder of pool.rewarders) {
        const [rewardCoin] = tx.moveCall({
          target: `${targetPackage}::collect::reward`,
          typeArguments: [position.tokenXType, position.tokenYType, rewarder.coin_type],
          arguments: [
            tx.object(position.poolId),
            retrievedPosition,
            tx.object(CONFIG.clockId),
            tx.object(sdk.contractConst.versionId),
          ],
        });
        rewardCoins.push(rewardCoin);
      }
    }

    // Step 3: Remove all liquidity
    console.log('Step 3: Remove liquidity...');
    const [coinX, coinY] = tx.moveCall({
      target: `${targetPackage}::liquidity::remove_liquidity`,
      typeArguments: [position.tokenXType, position.tokenYType],
      arguments: [
        tx.object(position.poolId),
        retrievedPosition,
        tx.pure.u128(position.liquidity),
        tx.pure.u64(0), // min_amount_x
        tx.pure.u64(0), // min_amount_y
        tx.object(CONFIG.clockId),
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Step 4: Close the old position (destroy it properly)
    console.log('Step 4: Close old position...');
    tx.moveCall({
      target: `${targetPackage}::liquidity::close_position`,
      arguments: [
        retrievedPosition,
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Merge fee coins with liquidity coins
    tx.mergeCoins(coinX, [feeX]);
    tx.mergeCoins(coinY, [feeY]);

    // Transfer reward coins to owner (they're separate token types)
    if (rewardCoins.length > 0) {
      tx.transferObjects(rewardCoins, position.owner);
    }

    // Step 5: Calculate new tick range
    console.log('Step 5: Calculate new range...');
    const currentTick = position.currentTick;
    const rangePercent = position.rangePercentBps / 10000;
    const ticksForRange = Math.round(rangePercent * 10000);
    const tickSpacing = position.tickSpacing;

    let newLowerTick = Math.floor((currentTick - ticksForRange) / tickSpacing) * tickSpacing;
    let newUpperTick = Math.ceil((currentTick + ticksForRange) / tickSpacing) * tickSpacing;

    console.log(`New range: ${newLowerTick} - ${newUpperTick}`);

    // Step 6: Open new position - need to create i32 tick values using Move calls
    console.log('Step 6: Open new position...');

    // Convert tick indices to sqrt prices for the Move tick_math module
    const lowerSqrtPrice = tickIndexToSqrtPriceX64(newLowerTick);
    const upperSqrtPrice = tickIndexToSqrtPriceX64(newUpperTick);

    // Get tick from sqrt price (returns i32)
    const [lowerTick1] = tx.moveCall({
      target: `${targetPackage}::tick_math::get_tick_at_sqrt_price`,
      arguments: [tx.pure.u128(lowerSqrtPrice.toString())],
    });
    const [upperTick1] = tx.moveCall({
      target: `${targetPackage}::tick_math::get_tick_at_sqrt_price`,
      arguments: [tx.pure.u128(upperSqrtPrice.toString())],
    });

    // Create tick_spacing as i32
    const [tickSpacingI32] = tx.moveCall({
      target: `${targetPackage}::i32::from_u32`,
      arguments: [tx.pure.u32(tickSpacing)],
    });

    // Round ticks to tick spacing: tick - (tick % tick_spacing)
    const [lowerTickMod] = tx.moveCall({
      target: `${targetPackage}::i32::mod`,
      arguments: [lowerTick1, tickSpacingI32],
    });
    const [upperTickMod] = tx.moveCall({
      target: `${targetPackage}::i32::mod`,
      arguments: [upperTick1, tickSpacingI32],
    });
    const [lowerTick] = tx.moveCall({
      target: `${targetPackage}::i32::sub`,
      arguments: [lowerTick1, lowerTickMod],
    });
    const [upperTick] = tx.moveCall({
      target: `${targetPackage}::i32::sub`,
      arguments: [upperTick1, upperTickMod],
    });

    // Use liquidity module for opening position with i32 tick values
    const [newPosition] = tx.moveCall({
      target: `${targetPackage}::liquidity::open_position`,
      typeArguments: [position.tokenXType, position.tokenYType],
      arguments: [
        tx.object(position.poolId),
        lowerTick,
        upperTick,
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // ZAP Mode: Swap tokens BEFORE add_liquidity to balance the ratio
    // This ensures we use maximum liquidity instead of returning leftovers
    if (position.useZap) {
      console.log('Step 6b: ZAP - pre-balancing tokens with PRECISE math...');

      // Calculate the EXACT target ratio using CLMM math
      const targetXRatio = calculateTargetXRatio(
        position.currentSqrtPrice,
        newLowerTick,
        newUpperTick
      );
      console.log(`  Target X ratio: ${(targetXRatio * 100).toFixed(2)}% X, ${((1 - targetXRatio) * 100).toFixed(2)}% Y`);

      // We need to estimate current token values
      // Since we're in a transaction, we'll use the swap calculation with current sqrt price
      const sqrtP = Number(BigInt(position.currentSqrtPrice)) / (2 ** 64);
      const price = sqrtP * sqrtP; // Current price (Y per X)

      // Calculate swap parameters
      // Note: We don't know exact coin values at this point, so we use ratio-based calculation
      // swapResult tells us direction and what percentage to swap
      // For now, we assume roughly equal value in both coins (conservative estimate)
      // The actual swap uses on-chain coin values

      // CRITICAL: When a position goes OUT OF RANGE, it becomes 100% of one token:
      // - Price UP (currentTick > upperTick): 100% token Y (USDC)
      // - Price DOWN (currentTick < lowerTick): 100% token X (SUI)
      //
      // So after remove_liquidity, we don't have 50/50 - we have ~100% of one token!
      // We need to swap to achieve the target ratio for the NEW range.

      const oldRangeCenter = (position.tickLower + position.tickUpper) / 2;
      const wasAboveRange = position.currentTick > position.tickUpper;
      const wasBelowRange = position.currentTick < position.tickLower;

      let swapXtoY: boolean;
      let swapPercent: number;

      if (wasAboveRange) {
        // Price went UP - position is ~100% Y (USDC)
        // Need to swap some Y → X to achieve target ratio
        swapXtoY = false; // Swap Y to X
        // We have 100% Y, want targetXRatio% X
        // So swap targetXRatio of our Y to get X
        swapPercent = targetXRatio;
        console.log(`  Position was ABOVE range - have ~100% Y, need ${(targetXRatio * 100).toFixed(1)}% X`);
      } else if (wasBelowRange) {
        // Price went DOWN - position is ~100% X (SUI)
        // Need to swap some X → Y to achieve target ratio
        swapXtoY = true; // Swap X to Y
        // We have 100% X, want (1-targetXRatio)% Y
        // So swap (1-targetXRatio) of our X to get Y
        swapPercent = 1 - targetXRatio;
        console.log(`  Position was BELOW range - have ~100% X, need ${((1 - targetXRatio) * 100).toFixed(1)}% Y`);
      } else {
        // Position was somehow still in range (maybe fees/rewards added?)
        // Use the standard 50/50 assumption
        swapXtoY = targetXRatio < 0.5;
        const imbalance = Math.abs(0.5 - targetXRatio);
        swapPercent = imbalance * 2;
        console.log(`  Position was IN range - using 50/50 assumption`);
      }

      // Adjust for swap fees (need to swap slightly more to account for fee loss)
      swapPercent = swapPercent * 1.003; // 0.3% fee adjustment
      // Cap at 95% to avoid edge cases (leave some for gas)
      swapPercent = Math.min(swapPercent, 0.95);
      // Minimum threshold to avoid tiny swaps
      const imbalance = wasAboveRange || wasBelowRange ? swapPercent : Math.abs(0.5 - targetXRatio);

      console.log(`  Swap direction: ${swapXtoY ? 'X→Y (target needs more Y)' : 'Y→X (target needs more X)'}`);
      console.log(`  Calculated swap: ${(swapPercent * 100).toFixed(1)}% of ${swapXtoY ? 'X' : 'Y'}`);

      // Skip swap if imbalance is tiny (< 2%)
      if (imbalance < 0.02) {
        console.log('  Skipping swap - already balanced within 2%');
      } else {
        // Sqrt price limits (from SDK constants)
        const MIN_SQRT_PRICE = BigInt('4295048017');
        const MAX_SQRT_PRICE = BigInt('79226673515401279992447579050');
        const sqrtPriceLimit = swapXtoY ? MIN_SQRT_PRICE : MAX_SQRT_PRICE;

        // Get the full coin value
        const [fullCoinValue] = tx.moveCall({
          target: '0x2::coin::value',
          typeArguments: [swapXtoY ? position.tokenXType : position.tokenYType],
          arguments: [swapXtoY ? coinX : coinY],
        });

        // Calculate swap amount in basis points (more precision)
        const swapAmountBps = Math.floor(swapPercent * 10000);

        // Calculate the amount to swap: (value * swapAmountBps) / 10000
        const [scaledValue] = tx.moveCall({
          target: `${targetPackage}::full_math_u64::mul_div_floor`,
          arguments: [
            fullCoinValue,
            tx.pure.u64(swapAmountBps),
            tx.pure.u64(10000),
          ],
        });

        // Split the coin to get the portion to swap
        const [coinToSwap] = tx.moveCall({
          target: '0x2::coin::split',
          typeArguments: [swapXtoY ? position.tokenXType : position.tokenYType],
          arguments: [swapXtoY ? coinX : coinY, scaledValue],
        });

        // Get the value of the coin to swap
        const [swapAmount] = tx.moveCall({
          target: '0x2::coin::value',
          typeArguments: [swapXtoY ? position.tokenXType : position.tokenYType],
          arguments: [coinToSwap],
        });

        // flash_swap: (pool, is_x_to_y, is_exact_in, amount, sqrt_price_limit, clock, version)
        const [receiveBalanceA, receiveBalanceB, flashReceipt] = tx.moveCall({
          target: `${targetPackage}::trade::flash_swap`,
          typeArguments: [position.tokenXType, position.tokenYType],
          arguments: [
            tx.object(position.poolId),
            tx.pure.bool(swapXtoY),
            tx.pure.bool(true), // is_exact_in
            swapAmount,
            tx.pure.u128(sqrtPriceLimit.toString()),
            tx.object(CONFIG.clockId),
            tx.object(sdk.contractConst.versionId),
          ],
        });

        // Destroy the zero balance (the input side returns zero balance)
        tx.moveCall({
          target: '0x2::balance::destroy_zero',
          typeArguments: [swapXtoY ? position.tokenXType : position.tokenYType],
          arguments: [swapXtoY ? receiveBalanceA : receiveBalanceB],
        });

        // Get debts from receipt
        const [debtA, debtB] = tx.moveCall({
          target: `${targetPackage}::trade::swap_receipt_debts`,
          arguments: [flashReceipt],
        });

        // Split the swap coin to pay the exact debt
        const [paymentCoin] = tx.moveCall({
          target: '0x2::coin::split',
          typeArguments: [swapXtoY ? position.tokenXType : position.tokenYType],
          arguments: [coinToSwap, swapXtoY ? debtA : debtB],
        });

        // Merge any remainder back (in case debt < swapAmount due to rounding)
        tx.mergeCoins(swapXtoY ? coinX : coinY, [coinToSwap]);

        // Create zero coin for the non-payment side
        const [zeroCoin] = tx.moveCall({
          target: '0x2::coin::zero',
          typeArguments: [swapXtoY ? position.tokenYType : position.tokenXType],
        });

        // Convert to balances for repayment
        const [paymentBalanceA] = tx.moveCall({
          target: '0x2::coin::into_balance',
          typeArguments: [position.tokenXType],
          arguments: [swapXtoY ? paymentCoin : zeroCoin],
        });
        const [paymentBalanceB] = tx.moveCall({
          target: '0x2::coin::into_balance',
          typeArguments: [position.tokenYType],
          arguments: [swapXtoY ? zeroCoin : paymentCoin],
        });

        // Repay flash swap
        tx.moveCall({
          target: `${targetPackage}::trade::repay_flash_swap`,
          typeArguments: [position.tokenXType, position.tokenYType],
          arguments: [
            tx.object(position.poolId),
            flashReceipt,
            paymentBalanceA,
            paymentBalanceB,
            tx.object(sdk.contractConst.versionId),
          ],
        });

        // Convert received balance to coin and merge with our holdings
        const [swappedCoin] = tx.moveCall({
          target: '0x2::coin::from_balance',
          typeArguments: [swapXtoY ? position.tokenYType : position.tokenXType],
          arguments: [swapXtoY ? receiveBalanceB : receiveBalanceA],
        });

        // Merge swapped coin with our existing coin of that type
        if (swapXtoY) {
          tx.mergeCoins(coinY, [swappedCoin]); // Swapped X→Y, merge into coinY
        } else {
          tx.mergeCoins(coinX, [swappedCoin]); // Swapped Y→X, merge into coinX
        }

        console.log('  ZAP pre-swap complete, tokens are now balanced');
      } // end else (do swap)
    } // end if (position.useZap)

    // Step 7: Add liquidity to new position (now with balanced tokens if ZAP was used)
    console.log('Step 7: Add liquidity...');
    const [remainingX, remainingY] = tx.moveCall({
      target: `${targetPackage}::liquidity::add_liquidity`,
      typeArguments: [position.tokenXType, position.tokenYType],
      arguments: [
        tx.object(position.poolId),
        newPosition,
        coinX,
        coinY,
        tx.pure.u64(0), // min_amount_x
        tx.pure.u64(0), // min_amount_y
        tx.object(CONFIG.clockId),
        tx.object(sdk.contractConst.versionId),
      ],
    });

    // Transfer any remaining dust to owner
    tx.transferObjects([remainingX, remainingY], position.owner);

    // Step 8: Store new position back to registry
    console.log('Step 8: Store new position...');
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

  // Check if there's a pending rebalance (either from out-of-range or forced "Rebalance NOW")
  if (position.rebalancePending) {
    const rebalanceAt = position.outOfRangeSince + position.rebalanceDelayMs;

    if (now >= rebalanceAt) {
      // Delay has passed - execute rebalance regardless of in-range status
      // This handles both natural out-of-range and forced "Rebalance NOW"
      console.log(`${position.id.slice(0, 10)}... REBALANCE PENDING - delay expired`);
      console.log(`  Current tick: ${position.currentTick}, range: ${position.tickLower}-${position.tickUpper}`);
      console.log(`  In range: ${position.isInRange}, Forced rebalance: ${position.isInRange ? 'YES' : 'NO'}`);
      await executeRebalance(position);
      return;
    } else {
      // Delay not yet passed
      console.log(`${position.id.slice(0, 10)}... rebalance pending, delay: ${Math.ceil((rebalanceAt - now) / 1000)}s remaining`);
      return;
    }
  }

  // No pending rebalance - check if position went out of range
  if (!position.isInRange) {
    console.log(`${position.id.slice(0, 10)}... OUT OF RANGE (tick ${position.currentTick}, range ${position.tickLower}-${position.tickUpper})`);
    console.log(`  Starting delay timer (${position.rebalanceDelayMs / 1000}s)`);
    await markOutOfRange(position);
  }
  // If in range and no pending rebalance, do nothing
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
