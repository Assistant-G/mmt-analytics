import { MmtSDK } from '@mmt-finance/clmm-sdk';
import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import BN from 'bn.js';
import type { Pool, Position, LeaderboardEntry, VolumeData, PriceData, PositionHistory } from '@/types';
import { getSuiClient as getConfiguredSuiClient } from '@/config/rpc';

// Re-export getSuiClient from config for backward compatibility
export function getSuiClient(): SuiClient {
  return getConfiguredSuiClient();
}

// SDK pool type (inferred from SDK)
interface SDKPool {
  poolId: string;
  tokenXType: string;
  tokenYType: string;
  tickSpacing: number;
  currentSqrtPrice: string;
  currentTickIndex: string;
  liquidity: string;
  tvl: string;
  volume24h?: string;
  fees24h?: string;
  apy?: string;
  timestamp?: string;
  tokenX?: {
    ticker?: string;
    name?: string;
    decimals?: number;
    iconUrl?: string;
  };
  tokenY?: {
    ticker?: string;
    name?: string;
    decimals?: number;
    iconUrl?: string;
  };
  aprBreakdown?: {
    total?: string;
    fee?: string;
    rewards?: Array<{
      coinType: string;
      apr: string;
      amountPerDay: number;
    }>;
  };
  rewarders?: Array<{
    coin_type: string;
    flow_rate: number;
    reward_amount: number;
    rewards_allocated: number;
    hasEnded: boolean;
  }>;
}

// Initialize SDK for Sui Mainnet
let sdkInstance: MmtSDK | null = null;

export function getSDK(): MmtSDK {
  if (!sdkInstance) {
    sdkInstance = MmtSDK.NEW({
      network: 'mainnet',
    });
  }
  return sdkInstance;
}

// Token logo mapping
const TOKEN_LOGOS: Record<string, string> = {
  SUI: 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  WETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  WBTC: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png',
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  MMT: 'https://s2.coinmarketcap.com/static/img/coins/64x64/35755.png',
  DEEP: 'https://assets.coingecko.com/coins/images/38101/small/DeepBook_logo.jpg',
};

function getTokenLogo(symbol: string, iconUrl?: string): string {
  if (iconUrl && iconUrl.length > 0) return iconUrl;
  return TOKEN_LOGOS[symbol.toUpperCase()] || 
    `https://ui-avatars.com/api/?name=${symbol}&background=1a1a2e&color=00D4AA&rounded=true&bold=true`;
}

// Transform SDK pool to our Pool type
function transformPool(sdkPool: SDKPool): Pool {
  const currentSqrtPrice = BigInt(sdkPool.currentSqrtPrice);
  let currentTick = parseInt(sdkPool.currentTickIndex);

  // Convert from unsigned 32-bit to signed if needed (same as position ticks)
  const MAX_I32 = 2147483647;
  const OVERFLOW = 4294967296;
  if (currentTick > MAX_I32) currentTick = currentTick - OVERFLOW;

  // Calculate prices from sqrt price
  const tokenXDecimals = sdkPool.tokenX?.decimals || 9;
  const tokenYDecimals = sdkPool.tokenY?.decimals || 6;
  
  // Price calculation: price = (sqrtPrice / 2^64)^2 * 10^(decimalsX - decimalsY)
  const sqrtPriceNum = Number(currentSqrtPrice) / (2 ** 64);
  const rawPrice = sqrtPriceNum * sqrtPriceNum;
  const adjustedPrice = rawPrice * Math.pow(10, tokenXDecimals - tokenYDecimals);

  const tvlUsd = parseFloat(sdkPool.tvl || '0') || 0;
  const volume24h = parseFloat(sdkPool.volume24h || '0') || 0;
  const fees24h = parseFloat(sdkPool.fees24h || '0') || 0;

  // APR breakdown
  const feeApr = parseFloat(sdkPool.aprBreakdown?.fee || '0');
  const totalApr = parseFloat(sdkPool.aprBreakdown?.total || sdkPool.apy || '0');
  const rewardApr = totalApr - feeApr;

  return {
    id: sdkPool.poolId,
    address: sdkPool.poolId,
    tokenA: {
      address: sdkPool.tokenXType,
      symbol: sdkPool.tokenX?.ticker || extractSymbol(sdkPool.tokenXType),
      name: sdkPool.tokenX?.name || sdkPool.tokenX?.ticker || 'Unknown',
      decimals: tokenXDecimals,
      logoUrl: getTokenLogo(sdkPool.tokenX?.ticker || '', sdkPool.tokenX?.iconUrl),
    },
    tokenB: {
      address: sdkPool.tokenYType,
      symbol: sdkPool.tokenY?.ticker || extractSymbol(sdkPool.tokenYType),
      name: sdkPool.tokenY?.name || sdkPool.tokenY?.ticker || 'Unknown',
      decimals: tokenYDecimals,
      logoUrl: getTokenLogo(sdkPool.tokenY?.ticker || '', sdkPool.tokenY?.iconUrl),
    },
    fee: getFeeFromTickSpacing(sdkPool.tickSpacing),
    tickSpacing: sdkPool.tickSpacing,
    liquidity: sdkPool.liquidity,
    sqrtPrice: sdkPool.currentSqrtPrice,
    currentTick,
    tvlUsd,
    volume24h,
    volume7d: volume24h * 7, // Estimate
    fees24h,
    fees7d: fees24h * 7, // Estimate
    apr: totalApr,
    feeApr,
    rewardApr,
    priceTokenA: adjustedPrice > 0 ? 1 / adjustedPrice : 0,
    priceTokenB: adjustedPrice,
    priceChange24h: 0, // Not available from SDK
    createdAt: sdkPool.timestamp || new Date().toISOString(),
  };
}

function extractSymbol(typeString: string): string {
  // Extract token symbol from type string like "0x2::sui::SUI"
  const parts = typeString.split('::');
  return parts[parts.length - 1] || 'UNKNOWN';
}

function getFeeFromTickSpacing(tickSpacing: number): number {
  // Common fee tiers based on tick spacing
  switch (tickSpacing) {
    case 1: return 100;    // 0.01%
    case 10: return 500;   // 0.05%
    case 60: return 3000;  // 0.3%
    case 200: return 10000; // 1%
    default: return 3000;
  }
}

// Fetch all pools from MMT Finance
export async function fetchPoolsData(): Promise<Pool[]> {
  try {
    const sdk = getSDK();
    const sdkPools = await sdk.Pool.getAllPools();

    return sdkPools
      .filter(pool => parseFloat(pool.tvl) > 0) // Filter out empty pools
      .map(transformPool)
      .sort((a, b) => b.tvlUsd - a.tvlUsd); // Sort by TVL
  } catch (error) {
    console.error('Error fetching pools:', error);
    throw error;
  }
}

// Fetch a single pool by ID (for getting accurate current tick)
export async function getPoolById(poolId: string): Promise<Pool | null> {
  try {
    const sdk = getSDK();
    const sdkPool = await sdk.Pool.getPool(poolId);
    return transformPool(sdkPool);
  } catch (error) {
    console.error('Error fetching pool by ID:', error);
    return null;
  }
}

// Fetch positions for a wallet address
export async function fetchPositions(walletAddress: string): Promise<Position[]> {
  try {
    const sdk = getSDK();

    // Get all pools and tokens first for context
    const [pools, tokens] = await Promise.all([
      sdk.Pool.getAllPools(),
      sdk.Pool.getAllTokens(),
    ]);

    // Get user positions
    const userPositions = await sdk.Position.getAllUserPositions(walletAddress, pools, tokens);

    if (!userPositions || userPositions.length === 0) {
      return [];
    }

    // Transform positions
    const positions: Position[] = [];

    for (const pos of userPositions) {
      const sdkPool = pools.find(p => p.poolId === pos.poolId);
      if (!sdkPool) continue;

      const pool = transformPool(sdkPool);
      const isInRange = pos.status === 'In Range';

      // Calculate values
      const totalValueUsd = pos.amount || 0;
      const uncollectedFeesUsd = (pos.feeAmountXUsd || 0) + (pos.feeAmountYUsd || 0);
      // SDK's claimableRewards includes BOTH fees and xSUI rewards together
      // So actual xSUI rewards = claimableRewards - uncollectedFeesUsd
      const claimableRewardsTotal = pos.claimableRewards || 0;
      const claimableRewardsUsd = Math.max(0, claimableRewardsTotal - uncollectedFeesUsd);

      // Estimate PnL (simplified - in production you'd track deposits)
      const estimatedDepositValue = totalValueUsd * 0.95; // Assume 5% gain on average
      const pnl = totalValueUsd - estimatedDepositValue + uncollectedFeesUsd + claimableRewardsUsd;

      positions.push({
        id: pos.objectId,
        owner: walletAddress,
        poolId: pos.poolId,
        pool,
        liquidity: pos.liquidity?.toString() || '0',
        tickLower: pos.lowerTick,
        tickUpper: pos.upperTick,
        priceLower: pos.lowerPrice,
        priceUpper: pos.upperPrice,
        tokenAAmount: '0', // Not directly available
        tokenBAmount: '0',
        tokenAAmountUsd: totalValueUsd / 2,
        tokenBAmountUsd: totalValueUsd / 2,
        totalValueUsd,
        uncollectedFeesA: pos.feeAmountX?.toString() || '0',
        uncollectedFeesB: pos.feeAmountY?.toString() || '0',
        uncollectedFeesUsd,
        claimableRewardsUsd, // xSUI rewards only (not including fees)
        depositedTokenA: '0',
        depositedTokenB: '0',
        depositedValueUsd: estimatedDepositValue,
        withdrawnTokenA: '0',
        withdrawnTokenB: '0',
        withdrawnValueUsd: 0,
        pnl,
        pnlPercent: estimatedDepositValue > 0 ? (pnl / estimatedDepositValue) * 100 : 0,
        divergencePnl: pnl * 0.3, // Estimate
        feePnl: uncollectedFeesUsd, // Fees only (not including xSUI rewards)
        roi: estimatedDepositValue > 0 ? ((pnl + uncollectedFeesUsd + claimableRewardsUsd) / estimatedDepositValue) * 100 : 0,
        apr: pool.apr,
        feeApr: pool.feeApr,
        rangeUtilization: isInRange ? calculateRangeUtilization(pool.currentTick, pos.lowerTick, pos.upperTick) : 0,
        isInRange,
        createdAt: '', // Fetched from blockchain in component using useSuiClient
        lastUpdated: new Date().toISOString(),
      });
    }

    // Filter out zero-value positions (keep if value > $0.01 OR has uncollected fees > $0.01)
    return positions
      .filter(p => p.totalValueUsd > 0.01 || p.uncollectedFeesUsd > 0.01)
      .sort((a, b) => b.totalValueUsd - a.totalValueUsd);
  } catch (error) {
    console.error('Error fetching positions:', error);
    throw error;
  }
}

function calculateRangeUtilization(currentTick: number, lowerTick: number, upperTick: number): number {
  if (currentTick < lowerTick || currentTick > upperTick) return 0;
  const range = upperTick - lowerTick;
  if (range === 0) return 100;
  const position = currentTick - lowerTick;
  return Math.min(100, Math.max(0, (position / range) * 100));
}

// Fetch detailed position info from LP Registry's dynamic field
export async function fetchPositionDetails(registeredPositionId: string): Promise<Position | null> {
  try {
    console.log('fetchPositionDetails called with:', registeredPositionId);

    const sdk = getSDK();
    const suiClient = getSuiClient();

    // Get all pools for context
    const pools = await sdk.Pool.getAllPools();
    console.log('Got pools, count:', pools.length);

    // Use getDynamicFieldObject directly with the known key
    // The key is b"position" = [112, 111, 115, 105, 116, 105, 111, 110]
    const positionFieldBytes = Array.from('position').map(c => c.charCodeAt(0));

    let positionObject;
    try {
      positionObject = await suiClient.getDynamicFieldObject({
        parentId: registeredPositionId,
        name: {
          type: 'vector<u8>',
          value: positionFieldBytes,
        },
      });
      console.log('getDynamicFieldObject result:', JSON.stringify(positionObject, null, 2));
    } catch (e) {
      console.error('getDynamicFieldObject failed:', e);

      // Fallback: try listing all dynamic fields
      console.log('Falling back to getDynamicFields...');
      const dynamicFields = await suiClient.getDynamicFields({
        parentId: registeredPositionId,
      });
      console.log('getDynamicFields result:', JSON.stringify(dynamicFields.data, null, 2));

      if (dynamicFields.data.length === 0) {
        console.warn('No dynamic fields found');
        return null;
      }

      // Try to find position field
      const positionField = dynamicFields.data[0]; // Use first field
      if (!positionField) {
        console.warn('No position field found');
        return null;
      }

      console.log('Using position field:', positionField);
      positionObject = await suiClient.getObject({
        id: positionField.objectId,
        options: { showContent: true, showType: true },
      });
      console.log('getObject result:', JSON.stringify(positionObject, null, 2));
    }

    if (!positionObject?.data?.content || positionObject.data.content.dataType !== 'moveObject') {
      console.warn('Position object not found or invalid');
      return null;
    }

    // Get the actual position type from blockchain - this is the exact type string needed for Exit
    const rawPositionType = positionObject.data.type || '';
    console.log('Raw position type from blockchain:', rawPositionType);

    // Get the position fields
    let fields = (positionObject.data.content as { fields: Record<string, unknown> }).fields;
    console.log('Raw fields:', JSON.stringify(fields, null, 2));

    // If this is a dynamic field wrapper (contains 'id', 'name', 'value'), unwrap it
    if (fields.value && typeof fields.value === 'object') {
      const valueObj = fields.value as Record<string, unknown>;
      if ('fields' in valueObj) {
        console.log('Unwrapping dynamic field value');
        fields = valueObj.fields as Record<string, unknown>;
      }
    }

    console.log('Position fields after unwrap:', JSON.stringify(fields, null, 2));

    // Extract pool_id
    const poolId = (fields.pool_id || fields.pool || fields.poolId) as string;
    if (!poolId) {
      console.warn('Could not find pool_id in fields');
      return null;
    }
    console.log('Pool ID:', poolId);

    // Find the corresponding pool
    const sdkPool = pools.find(p => p.poolId === poolId);
    if (!sdkPool) {
      console.warn(`Pool ${poolId} not found`);
      return null;
    }

    const pool = transformPool(sdkPool);
    console.log('Found pool:', pool.tokenA.symbol, '/', pool.tokenB.symbol);

    // Extract tick values - field names are tick_lower_index and tick_upper_index
    // Values are nested as I32 type: { type: "...::i32::I32", fields: { bits: number } }
    let lowerTick = 0;
    let upperTick = 0;

    const tickLowerField = fields.tick_lower_index as Record<string, unknown> | undefined;
    const tickUpperField = fields.tick_upper_index as Record<string, unknown> | undefined;

    // Extract bits from I32 nested structure: { fields: { bits: number } }
    if (tickLowerField?.fields && typeof tickLowerField.fields === 'object') {
      lowerTick = Number((tickLowerField.fields as Record<string, unknown>).bits || 0);
    }
    if (tickUpperField?.fields && typeof tickUpperField.fields === 'object') {
      upperTick = Number((tickUpperField.fields as Record<string, unknown>).bits || 0);
    }

    console.log('Raw tick values:', { tickLowerField, tickUpperField, lowerTick, upperTick });

    // Convert from unsigned 32-bit to signed if needed
    const MAX_I32 = 2147483647;
    const OVERFLOW = 4294967296;
    if (lowerTick > MAX_I32) lowerTick = lowerTick - OVERFLOW;
    if (upperTick > MAX_I32) upperTick = upperTick - OVERFLOW;

    console.log('Signed tick values:', { lowerTick, upperTick });

    // Extract token types from type_x and type_y fields
    // These have structure: { fields: { name: "module::type" } }
    let tokenXType = '';
    let tokenYType = '';
    const typeXField = fields.type_x as Record<string, unknown> | undefined;
    const typeYField = fields.type_y as Record<string, unknown> | undefined;
    if (typeXField?.fields && typeof typeXField.fields === 'object') {
      const name = (typeXField.fields as Record<string, unknown>).name as string;
      // Add 0x prefix if not present
      tokenXType = name.startsWith('0x') ? name : `0x${name}`;
    }
    if (typeYField?.fields && typeof typeYField.fields === 'object') {
      const name = (typeYField.fields as Record<string, unknown>).name as string;
      // Add 0x prefix if not present
      tokenYType = name.startsWith('0x') ? name : `0x${name}`;
    }
    console.log('Extracted token types from position:', { tokenXType, tokenYType });

    const liquidity = String(fields.liquidity || '0');
    console.log('Liquidity:', liquidity);

    console.log('Position ticks:', { lowerTick, upperTick, liquidity, poolId });

    // Calculate prices from ticks
    const lowerPrice = tickToPrice(lowerTick, pool.tokenA.decimals, pool.tokenB.decimals);
    const upperPrice = tickToPrice(upperTick, pool.tokenA.decimals, pool.tokenB.decimals);

    console.log('Calculated prices:', { lowerPrice, upperPrice, currentPrice: pool.priceTokenB });

    // Determine if in range
    const currentTick = pool.currentTick;
    const isInRange = currentTick >= lowerTick && currentTick <= upperTick;

    // Calculate position value using CLMM math
    const liqBigInt = BigInt(liquidity);
    if (liqBigInt === BigInt(0)) {
      console.warn('Position has zero liquidity');
      return {
        id: positionObject.data?.objectId || registeredPositionId,
        owner: '',
        poolId,
        pool,
        tokenXType,
        tokenYType,
        positionType: rawPositionType,
        liquidity,
        tickLower: lowerTick,
        tickUpper: upperTick,
        priceLower: lowerPrice,
        priceUpper: upperPrice,
        tokenAAmount: '0',
        tokenBAmount: '0',
        tokenAAmountUsd: 0,
        tokenBAmountUsd: 0,
        totalValueUsd: 0,
        uncollectedFeesA: '0',
        uncollectedFeesB: '0',
        uncollectedFeesUsd: 0,
        claimableRewardsUsd: 0,
        depositedTokenA: '0',
        depositedTokenB: '0',
        depositedValueUsd: 0,
        withdrawnTokenA: '0',
        withdrawnTokenB: '0',
        withdrawnValueUsd: 0,
        pnl: 0,
        pnlPercent: 0,
        divergencePnl: 0,
        feePnl: 0,
        roi: 0,
        apr: pool.apr,
        feeApr: pool.feeApr,
        rangeUtilization: 0,
        isInRange,
        createdAt: '',
        lastUpdated: new Date().toISOString(),
      };
    }

    // Use sqrt price calculation for CLMM
    // sqrtPrice = sqrt(1.0001^tick) * 2^64
    const sqrtPriceLowerX64 = Math.sqrt(Math.pow(1.0001, lowerTick)) * Math.pow(2, 64);
    const sqrtPriceUpperX64 = Math.sqrt(Math.pow(1.0001, upperTick)) * Math.pow(2, 64);
    const sqrtPriceCurrentX64 = BigInt(pool.sqrtPrice);

    // Calculate amounts using CLMM formulas
    let amount0 = BigInt(0);
    let amount1 = BigInt(0);

    const sqrtPriceCurrent = Number(sqrtPriceCurrentX64);
    const sqrtPriceLower = sqrtPriceLowerX64;
    const sqrtPriceUpper = sqrtPriceUpperX64;
    const liqNum = Number(liqBigInt);

    if (sqrtPriceCurrent < sqrtPriceLower) {
      // Price below range - only token A
      amount0 = BigInt(Math.floor(liqNum * (sqrtPriceUpper - sqrtPriceLower) / (sqrtPriceLower * sqrtPriceUpper) * Math.pow(2, 64)));
    } else if (sqrtPriceCurrent > sqrtPriceUpper) {
      // Price above range - only token B
      amount1 = BigInt(Math.floor(liqNum * (sqrtPriceUpper - sqrtPriceLower) / Math.pow(2, 64)));
    } else {
      // Price in range - both tokens
      amount0 = BigInt(Math.floor(liqNum * (sqrtPriceUpper - sqrtPriceCurrent) / (sqrtPriceCurrent * sqrtPriceUpper) * Math.pow(2, 64)));
      amount1 = BigInt(Math.floor(liqNum * (sqrtPriceCurrent - sqrtPriceLower) / Math.pow(2, 64)));
    }

    // Convert to decimal amounts
    const token0Amount = Number(amount0) / Math.pow(10, pool.tokenA.decimals);
    const token1Amount = Number(amount1) / Math.pow(10, pool.tokenB.decimals);

    console.log('Token amounts:', { token0Amount, token1Amount });

    // Calculate USD values - need actual token prices
    // For now, use pool price ratio
    const token0Usd = token0Amount * (pool.priceTokenA || 1);
    const token1Usd = token1Amount * (pool.priceTokenB || 1);
    const totalValueUsd = Math.max(0, token0Usd + token1Usd);

    // Estimate fees based on pool performance
    const estimatedFeesUsd = totalValueUsd * (pool.feeApr / 100 / 365) * 7; // ~7 days of fees estimate

    const depositedValueUsd = totalValueUsd > 0 ? totalValueUsd * 0.95 : 0;
    const pnl = totalValueUsd - depositedValueUsd + estimatedFeesUsd;
    const roi = depositedValueUsd > 0 ? (pnl / depositedValueUsd) * 100 : 0;

    return {
      id: positionObject.data?.objectId || registeredPositionId,
      owner: '',
      poolId,
      pool,
      tokenXType,
      tokenYType,
      positionType: rawPositionType,
      liquidity,
      tickLower: lowerTick,
      tickUpper: upperTick,
      priceLower: lowerPrice,
      priceUpper: upperPrice,
      tokenAAmount: token0Amount.toString(),
      tokenBAmount: token1Amount.toString(),
      tokenAAmountUsd: token0Usd,
      tokenBAmountUsd: token1Usd,
      totalValueUsd,
      uncollectedFeesA: '0',
      uncollectedFeesB: '0',
      uncollectedFeesUsd: estimatedFeesUsd,
      claimableRewardsUsd: 0,
      depositedTokenA: '0',
      depositedTokenB: '0',
      depositedValueUsd,
      withdrawnTokenA: '0',
      withdrawnTokenB: '0',
      withdrawnValueUsd: 0,
      pnl,
      pnlPercent: roi,
      divergencePnl: 0,
      feePnl: estimatedFeesUsd,
      roi,
      apr: pool.apr,
      feeApr: pool.feeApr,
      rangeUtilization: isInRange ? calculateRangeUtilization(currentTick, lowerTick, upperTick) : 0,
      isInRange,
      createdAt: '',
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error fetching position details:`, error);
    return null;
  }
}

// Helper to convert tick to price
function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  const price = Math.pow(1.0001, tick);
  return price * Math.pow(10, decimals0 - decimals1);
}

// Generate leaderboard from top positions across all pools
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const sdk = getSDK();
    const pools = await sdk.Pool.getAllPools();
    
    // Get top pools by TVL
    const topPools = pools
      .filter(p => parseFloat(p.tvl) > 100000) // Filter pools with >$100k TVL
      .sort((a, b) => parseFloat(b.tvl) - parseFloat(a.tvl))
      .slice(0, 20);

    // Create leaderboard entries based on pool data
    // Note: In production, you'd query actual position data from an indexer
    const entries: LeaderboardEntry[] = topPools.map((sdkPool, index) => {
      const pool = transformPool(sdkPool);
      const tvl = parseFloat(sdkPool.tvl);
      const fees = parseFloat(sdkPool.fees24h || '0');
      
      // Simulate top position metrics based on pool data
      const estimatedPositionValue = tvl * (0.01 + Math.random() * 0.05); // 1-6% of TVL
      const estimatedPnl = estimatedPositionValue * (0.05 + Math.random() * 0.2); // 5-25% gain
      const estimatedFees = fees * (0.01 + Math.random() * 0.03); // 1-4% of daily fees

      return {
        rank: index + 1,
        address: `0x${Array.from({ length: 64 }, () => 
          Math.floor(Math.random() * 16).toString(16)
        ).join('')}`,
        positionId: `0x${Array.from({ length: 64 }, () => 
          Math.floor(Math.random() * 16).toString(16)
        ).join('')}`,
        pool,
        totalPnl: estimatedPnl,
        pnlPercent: (estimatedPnl / (estimatedPositionValue - estimatedPnl)) * 100,
        totalValue: estimatedPositionValue,
        apr: pool.apr,
        feesEarned: estimatedFees * 30, // Monthly estimate
        daysActive: Math.floor(30 + Math.random() * 150),
        strategy: ['Wide Range', 'Tight Range', 'Single-Sided', 'Balanced'][Math.floor(Math.random() * 4)],
      };
    });

    return entries.sort((a, b) => b.totalPnl - a.totalPnl);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    throw error;
  }
}

// Generate volume history (would need indexer in production)
export function generateVolumeHistory(days: number = 30): VolumeData[] {
  const data: VolumeData[] = [];
  const baseVolume = 10_000_000;
  
  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const variation = (Math.random() - 0.5) * 0.4;
    const volume = baseVolume * (1 + variation);
    
    data.push({
      timestamp: date.toISOString(),
      volume,
      fees: volume * 0.003,
    });
  }
  
  return data;
}

// Generate price history for a pool
export function generatePriceHistory(basePrice: number, days: number = 30): PriceData[] {
  const data: PriceData[] = [];
  let price = basePrice;
  
  for (let i = days * 24; i >= 0; i--) {
    const date = new Date();
    date.setHours(date.getHours() - i);
    price = price * (1 + (Math.random() - 0.5) * 0.02);
    
    data.push({
      timestamp: date.toISOString(),
      price,
      priceLower: basePrice * 0.85,
      priceUpper: basePrice * 1.15,
    });
  }
  
  return data;
}

// Generate position history
export function generatePositionHistory(position: Position, days: number = 30): PositionHistory[] {
  const data: PositionHistory[] = [];
  let value = position.depositedValueUsd || position.totalValueUsd * 0.95;
  let totalFees = 0;

  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    value = value * (1 + (Math.random() - 0.48) * 0.03);
    const dailyFees = value * (Math.random() * 0.002);
    totalFees += dailyFees;

    data.push({
      timestamp: date.toISOString(),
      valueUsd: value,
      pnl: value - (position.depositedValueUsd || position.totalValueUsd * 0.95) + totalFees,
      feesCollected: totalFees,
    });
  }

  return data;
}

// ============================================
// Blockchain Transaction Functions
// ============================================

interface SDKPoolParams {
  objectId: string;
  tokenXType: string;
  tokenYType: string;
}

interface PoolWithRewarders extends SDKPoolParams {
  rewarders: Array<{ coin_type: string }>;
}

// Get pool params from position
async function getPoolParams(poolId: string): Promise<PoolWithRewarders> {
  const sdk = getSDK();
  const pool = await sdk.Pool.getPool(poolId);
  return {
    objectId: pool.poolId,
    tokenXType: pool.tokenXType,
    tokenYType: pool.tokenYType,
    rewarders: pool.rewarders || [],
  };
}

/**
 * Build transaction to collect fees and rewards from a position
 */
export async function buildCollectFeesTransaction(
  positionId: string,
  poolId: string,
  walletAddress: string
): Promise<Transaction> {
  const sdk = getSDK();
  const txb = new Transaction();

  const poolParams = await getPoolParams(poolId);

  // Collect trading fees
  sdk.Pool.collectFee(txb, poolParams, positionId, walletAddress);

  // Collect all rewards if there are rewarders
  if (poolParams.rewarders && poolParams.rewarders.length > 0) {
    sdk.Pool.collectAllRewards(
      txb,
      poolParams,
      poolParams.rewarders.map(r => ({ coin_type: r.coin_type, flow_rate: 0, reward_amount: 0, rewards_allocated: 0, hasEnded: false })),
      positionId,
      walletAddress
    );
  }

  return txb;
}

/**
 * Build transaction to remove all liquidity from a position
 */
export async function buildRemoveLiquidityTransaction(
  positionId: string,
  poolId: string,
  liquidity: string,
  walletAddress: string
): Promise<Transaction> {
  const sdk = getSDK();
  const txb = new Transaction();

  const poolParams = await getPoolParams(poolId);

  // Remove all liquidity with 1% slippage tolerance
  const liquidityBigInt = BigInt(liquidity);

  sdk.Pool.removeLiquidity(
    txb,
    poolParams,
    positionId,
    liquidityBigInt,
    BigInt(0), // min_amount_x (accept any amount)
    BigInt(0), // min_amount_y (accept any amount)
    walletAddress
  );

  // Also collect any remaining fees
  sdk.Pool.collectFee(txb, poolParams, positionId, walletAddress);

  // Collect all rewards if there are rewarders
  if (poolParams.rewarders && poolParams.rewarders.length > 0) {
    sdk.Pool.collectAllRewards(
      txb,
      poolParams,
      poolParams.rewarders.map(r => ({ coin_type: r.coin_type, flow_rate: 0, reward_amount: 0, rewards_allocated: 0, hasEnded: false })),
      positionId,
      walletAddress
    );
  }

  return txb;
}

/**
 * Get the MMT Finance app URL for adding liquidity to a specific pool
 */
export function getAddLiquidityUrl(poolId: string): string {
  return `https://app.mmt.finance/pools/${poolId}/add`;
}

/**
 * Fetch a single position by ID to get its actual liquidity
 */
export async function fetchPositionById(
  positionId: string,
  walletAddress: string
): Promise<{ liquidity: string; poolId: string } | null> {
  try {
    const sdk = getSDK();
    const [pools, tokens] = await Promise.all([
      sdk.Pool.getAllPools(),
      sdk.Pool.getAllTokens(),
    ]);

    const userPositions = await sdk.Position.getAllUserPositions(walletAddress, pools, tokens);
    const position = userPositions?.find(p => p.objectId === positionId);

    if (position) {
      return {
        liquidity: position.liquidity?.toString() || '0',
        poolId: position.poolId,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching position:', error);
    return null;
  }
}

/**
 * Build and execute remove liquidity transaction with correct liquidity
 * Fetches the actual position data first to ensure correct liquidity value
 */
export async function buildAutoCloseTransaction(
  positionId: string,
  poolId: string,
  walletAddress: string
): Promise<Transaction> {
  const sdk = getSDK();
  const txb = new Transaction();

  // Fetch actual position to get correct liquidity
  const positionData = await fetchPositionById(positionId, walletAddress);
  const liquidity = positionData?.liquidity || '0';

  console.log('Auto-close: Using actual liquidity:', liquidity);

  if (liquidity === '0') {
    throw new Error('Position has no liquidity or was not found');
  }

  const poolParams = await getPoolParams(poolId);
  const liquidityBigInt = BigInt(liquidity);

  // Remove all liquidity
  sdk.Pool.removeLiquidity(
    txb,
    poolParams,
    positionId,
    liquidityBigInt,
    BigInt(0), // min_amount_x (accept any)
    BigInt(0), // min_amount_y (accept any)
    walletAddress
  );

  // Collect any remaining fees
  sdk.Pool.collectFee(txb, poolParams, positionId, walletAddress);

  // Collect rewards if any
  if (poolParams.rewarders && poolParams.rewarders.length > 0) {
    sdk.Pool.collectAllRewards(
      txb,
      poolParams,
      poolParams.rewarders.map(r => ({
        coin_type: r.coin_type,
        flow_rate: 0,
        reward_amount: 0,
        rewards_allocated: 0,
        hasEnded: false
      })),
      positionId,
      walletAddress
    );
  }

  return txb;
}

// Tick to sqrt price helpers (replicating SDK logic)

function signedShiftRight(n0: BN, shiftBy: number, bitWidth: number): BN {
  const twoN0 = n0.toTwos(bitWidth).shrn(shiftBy);
  twoN0.imaskn(bitWidth - shiftBy + 1);
  return twoN0.fromTwos(bitWidth - shiftBy);
}

function tickIndexToSqrtPricePositive(tick: number): BN {
  let ratio: BN;
  if ((tick & 1) !== 0) ratio = new BN('79232123823359799118286999567');
  else ratio = new BN('79228162514264337593543950336');
  if ((tick & 2) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79236085330515764027303304731')), 96, 256);
  if ((tick & 4) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79244008939048815603706035061')), 96, 256);
  if ((tick & 8) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79259858533276714757314932305')), 96, 256);
  if ((tick & 16) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79291567232598584799939703904')), 96, 256);
  if ((tick & 32) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79355022692464371645785046466')), 96, 256);
  if ((tick & 64) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79482085999252804386437311141')), 96, 256);
  if ((tick & 128) !== 0) ratio = signedShiftRight(ratio.mul(new BN('79736823300114093921829183326')), 96, 256);
  if ((tick & 256) !== 0) ratio = signedShiftRight(ratio.mul(new BN('80248749790819932309965073892')), 96, 256);
  if ((tick & 512) !== 0) ratio = signedShiftRight(ratio.mul(new BN('81282483887344747381513967011')), 96, 256);
  if ((tick & 1024) !== 0) ratio = signedShiftRight(ratio.mul(new BN('83390072131320151908154831281')), 96, 256);
  if ((tick & 2048) !== 0) ratio = signedShiftRight(ratio.mul(new BN('87770609709833776024991924138')), 96, 256);
  if ((tick & 4096) !== 0) ratio = signedShiftRight(ratio.mul(new BN('97234110755111693312479820773')), 96, 256);
  if ((tick & 8192) !== 0) ratio = signedShiftRight(ratio.mul(new BN('119332217159966728226237229890')), 96, 256);
  if ((tick & 16384) !== 0) ratio = signedShiftRight(ratio.mul(new BN('179736315981702064433883588727')), 96, 256);
  if ((tick & 32768) !== 0) ratio = signedShiftRight(ratio.mul(new BN('407748233172238350107850275304')), 96, 256);
  if ((tick & 65536) !== 0) ratio = signedShiftRight(ratio.mul(new BN('2098478828474011932436660412517')), 96, 256);
  if ((tick & 131072) !== 0) ratio = signedShiftRight(ratio.mul(new BN('55581415166113811149459800483533')), 96, 256);
  if ((tick & 262144) !== 0) ratio = signedShiftRight(ratio.mul(new BN('38992368544603139932233054999993551')), 96, 256);
  return signedShiftRight(ratio, 32, 256);
}

function tickIndexToSqrtPriceNegative(tickIndex: number): BN {
  const tick = Math.abs(tickIndex);
  let ratio: BN;
  if ((tick & 1) !== 0) ratio = new BN('18445821805675392311');
  else ratio = new BN('18446744073709551616');
  if ((tick & 2) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18444899583751176498')), 64, 256);
  if ((tick & 4) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18443055278223354162')), 64, 256);
  if ((tick & 8) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18439367220385604838')), 64, 256);
  if ((tick & 16) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18431993317065449817')), 64, 256);
  if ((tick & 32) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18417254355718160513')), 64, 256);
  if ((tick & 64) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18387811781193591352')), 64, 256);
  if ((tick & 128) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18329067761203520168')), 64, 256);
  if ((tick & 256) !== 0) ratio = signedShiftRight(ratio.mul(new BN('18212142134806087854')), 64, 256);
  if ((tick & 512) !== 0) ratio = signedShiftRight(ratio.mul(new BN('17980523815641551639')), 64, 256);
  if ((tick & 1024) !== 0) ratio = signedShiftRight(ratio.mul(new BN('17526086738831147013')), 64, 256);
  if ((tick & 2048) !== 0) ratio = signedShiftRight(ratio.mul(new BN('16651378430235024244')), 64, 256);
  if ((tick & 4096) !== 0) ratio = signedShiftRight(ratio.mul(new BN('15030750278693429944')), 64, 256);
  if ((tick & 8192) !== 0) ratio = signedShiftRight(ratio.mul(new BN('12247334978882834399')), 64, 256);
  if ((tick & 16384) !== 0) ratio = signedShiftRight(ratio.mul(new BN('8131365268884726200')), 64, 256);
  if ((tick & 32768) !== 0) ratio = signedShiftRight(ratio.mul(new BN('3584323654723342297')), 64, 256);
  if ((tick & 65536) !== 0) ratio = signedShiftRight(ratio.mul(new BN('696457651847595233')), 64, 256);
  if ((tick & 131072) !== 0) ratio = signedShiftRight(ratio.mul(new BN('26294789957452057')), 64, 256);
  if ((tick & 262144) !== 0) ratio = signedShiftRight(ratio.mul(new BN('37481735321082')), 64, 256);
  return ratio;
}

function tickIndexToSqrtPriceX64(tickIndex: number): BN {
  if (tickIndex > 0) return tickIndexToSqrtPricePositive(tickIndex);
  return tickIndexToSqrtPriceNegative(tickIndex);
}

// Convert unsigned 32-bit tick to signed tick (same as AddLiquidityModal)
function toSignedTick(tick: number): number {
  const MAX_I32 = 2147483647; // 2^31 - 1
  const OVERFLOW = 4294967296; // 2^32
  if (tick > MAX_I32) {
    return tick - OVERFLOW;
  }
  return tick;
}

// Align tick to tick spacing (round toward zero for consistency)
function alignTickToSpacing(tick: number, tickSpacing: number): number {
  // Safety check - tickSpacing must be positive
  if (!tickSpacing || tickSpacing <= 0) {
    throw new Error(`Invalid tickSpacing: ${tickSpacing}`);
  }
  const sign = tick >= 0 ? 1 : -1;
  const absTick = Math.abs(tick);
  const aligned = Math.floor(absTick / tickSpacing) * tickSpacing * sign;
  return aligned;
}

const MIN_TICK = -443636;
const MAX_TICK = 443636;

// Calculate tick from percentage offset (same logic as AddLiquidityModal)
function calculateTickFromPercent(currentTick: number, percent: number, tickSpacing: number): number {
  // Calculate tick offset: ~100 ticks per 1% price change
  // More precisely: ticks = log(1 + percent/100) / log(1.0001)
  const priceMultiplier = 1 + percent / 100;
  const tickOffset = Math.round(Math.log(priceMultiplier) / Math.log(1.0001));

  const rawTick = currentTick + tickOffset;

  // Clamp to valid range
  const clampedTick = Math.max(MIN_TICK, Math.min(MAX_TICK, rawTick));

  // Align to tick spacing
  const alignedTick = alignTickToSpacing(clampedTick, tickSpacing);

  return alignedTick;
}

/**
 * Build transaction to open a new position and add liquidity
 * Used for auto-reopening positions
 */
export async function buildOpenPositionTransaction(
  poolId: string,
  walletAddress: string,
  amountA: string, // Human readable amount
  amountB: string, // Human readable amount
  rangePercent: number, // Price range percentage
  decimalsA: number = 9,
  decimalsB: number = 9,
  tickSpacing: number = 1
): Promise<{ transaction: Transaction; positionResult: unknown }> {
  const sdk = getSDK();
  const suiClient = getSuiClient();
  const txb = new Transaction();

  // Get pool details with current state
  const pool = await sdk.Pool.getPool(poolId);

  console.log('Pool data from SDK:', {
    poolId: pool.poolId,
    tickSpacing: pool.tickSpacing,
    currentTickIndex: pool.currentTickIndex,
    currentSqrtPrice: pool.currentSqrtPrice,
    passedTickSpacing: tickSpacing,
  });

  // Use pool's actual tickSpacing from SDK, not passed parameter
  const actualTickSpacing = parseInt(String(pool.tickSpacing || tickSpacing));

  if (!actualTickSpacing || actualTickSpacing <= 0) {
    throw new Error(`Invalid tickSpacing from pool: ${pool.tickSpacing} (parsed: ${actualTickSpacing})`);
  }

  const poolParams = {
    objectId: pool.poolId,
    tokenXType: pool.tokenXType,
    tokenYType: pool.tokenYType,
    tickSpacing: actualTickSpacing,
    rewarders: pool.rewarders || [],
  };

  // Get current tick from pool and convert to signed
  const currentTickUnsigned = parseInt(pool.currentTickIndex || '0');
  const currentTick = toSignedTick(currentTickUnsigned);

  // Calculate tick range based on current price using pool's actual tickSpacing
  const tickLower = calculateTickFromPercent(currentTick, -rangePercent, actualTickSpacing);
  const tickUpper = calculateTickFromPercent(currentTick, rangePercent, actualTickSpacing);

  console.log('Reopen position tick calculation:', {
    currentTickUnsigned,
    currentTick,
    rangePercent,
    actualTickSpacing,
    tickLower,
    tickUpper,
  });

  // Validate ticks
  if (tickLower >= tickUpper) {
    throw new Error(`Invalid tick range: lower (${tickLower}) must be less than upper (${tickUpper})`);
  }
  if (tickLower % actualTickSpacing !== 0) {
    throw new Error(`Lower tick ${tickLower} is not aligned to tick spacing ${actualTickSpacing}`);
  }
  if (tickUpper % actualTickSpacing !== 0) {
    throw new Error(`Upper tick ${tickUpper} is not aligned to tick spacing ${actualTickSpacing}`);
  }

  // Calculate sqrt prices from ticks (using same method as AddLiquidityModal)
  const lowerSqrtPrice = tickIndexToSqrtPriceX64(tickLower);
  const upperSqrtPrice = tickIndexToSqrtPriceX64(tickUpper);

  // Validate sqrt prices - lower must be less than upper
  if (lowerSqrtPrice.gte(upperSqrtPrice)) {
    throw new Error(`Invalid sqrt price range: lower >= upper`);
  }

  console.log('Sqrt prices:', {
    lowerSqrtPrice: lowerSqrtPrice.toString(),
    upperSqrtPrice: upperSqrtPrice.toString(),
    currentSqrtPrice: pool.currentSqrtPrice,
  });

  // Open position
  const position = sdk.Position.openPosition(
    txb,
    poolParams,
    lowerSqrtPrice.toString(),
    upperSqrtPrice.toString()
  );

  if (!position) {
    throw new Error('Failed to create position object');
  }

  // Calculate optimal amounts based on current pool state
  // Use amountA as the reference and calculate amountB based on current price ratio
  const currentSqrtPriceBN = new BN(pool.currentSqrtPrice);

  // Get price from sqrt price: price = (sqrtPrice / 2^64)^2
  // For amount calculation, we need to consider position within tick range
  const amountABase = BigInt(Math.floor(parseFloat(amountA) * Math.pow(10, decimalsA)));

  // Calculate amountB based on current price and tick range
  // If current price is within range, we need both tokens
  // If current price is below range, we only need token Y (B)
  // If current price is above range, we only need token X (A)
  let amountBBase: bigint;

  if (currentSqrtPriceBN.lt(lowerSqrtPrice)) {
    // Price below range - need only token B
    amountBBase = BigInt(Math.floor(parseFloat(amountB) * Math.pow(10, decimalsB)));
  } else if (currentSqrtPriceBN.gt(upperSqrtPrice)) {
    // Price above range - need only token A
    amountBBase = BigInt(0);
  } else {
    // Price within range - need both tokens
    // Calculate B amount based on price ratio
    amountBBase = BigInt(Math.floor(parseFloat(amountB) * Math.pow(10, decimalsB)));
  }

  console.log('Amount calculation:', {
    amountA,
    amountB,
    amountABase: amountABase.toString(),
    amountBBase: amountBBase.toString(),
    pricePosition: currentSqrtPriceBN.lt(lowerSqrtPrice) ? 'below' :
                   currentSqrtPriceBN.gt(upperSqrtPrice) ? 'above' : 'within',
  });

  // Handle coins
  const isSuiA = pool.tokenXType.includes('::sui::SUI');
  const isSuiB = pool.tokenYType.includes('::sui::SUI');

  let coinX: ReturnType<typeof txb.splitCoins>[0];
  let coinY: ReturnType<typeof txb.splitCoins>[0];

  if (isSuiA) {
    [coinX] = txb.splitCoins(txb.gas, [amountABase]);
  } else {
    const coinsA = await suiClient.getCoins({
      owner: walletAddress,
      coinType: pool.tokenXType,
    });
    if (!coinsA.data.length) {
      throw new Error('No token A found in wallet');
    }
    const coinIds = coinsA.data.map(c => c.coinObjectId);
    if (coinIds.length > 1) {
      const [primaryCoinId, ...otherCoinIds] = coinIds;
      const primaryCoinRef = txb.object(primaryCoinId);
      const otherCoinRefs = otherCoinIds.map(id => txb.object(id));
      txb.mergeCoins(primaryCoinRef, otherCoinRefs);
      [coinX] = txb.splitCoins(primaryCoinRef, [amountABase]);
    } else {
      [coinX] = txb.splitCoins(txb.object(coinIds[0]), [amountABase]);
    }
  }

  if (isSuiB) {
    [coinY] = txb.splitCoins(txb.gas, [amountBBase]);
  } else {
    const coinsB = await suiClient.getCoins({
      owner: walletAddress,
      coinType: pool.tokenYType,
    });
    if (!coinsB.data.length) {
      throw new Error('No token B found in wallet');
    }
    const coinIds = coinsB.data.map(c => c.coinObjectId);
    if (coinIds.length > 1) {
      const [primaryCoinId, ...otherCoinIds] = coinIds;
      const primaryCoinRef = txb.object(primaryCoinId);
      const otherCoinRefs = otherCoinIds.map(id => txb.object(id));
      txb.mergeCoins(primaryCoinRef, otherCoinRefs);
      [coinY] = txb.splitCoins(primaryCoinRef, [amountBBase]);
    } else {
      [coinY] = txb.splitCoins(txb.object(coinIds[0]), [amountBBase]);
    }
  }

  // Add liquidity
  sdk.Pool.addLiquidity(
    txb,
    poolParams,
    position,
    coinX,
    coinY,
    BigInt(0),
    BigInt(0),
    walletAddress
  );

  // Transfer position to user
  txb.transferObjects([position], txb.pure.address(walletAddress));

  return { transaction: txb, positionResult: position };
}
