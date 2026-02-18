import type { Pool, Position, LeaderboardEntry, VolumeData, PriceData, PositionHistory } from '@/types';
import { generateMockId, getTokenLogo } from '@/utils';

const TOKENS = {
  SUI: { address: '0x2::sui::SUI', symbol: 'SUI', name: 'Sui', decimals: 9 },
  USDC: { address: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  USDT: { address: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  WETH: { address: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN', symbol: 'WETH', name: 'Wrapped Ether', decimals: 8 },
  WBTC: { address: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8 },
  MMT: { address: '0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860::mmt::MMT', symbol: 'MMT', name: 'Momentum', decimals: 9 },
  DEEP: { address: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP', symbol: 'DEEP', name: 'DeepBook', decimals: 6 },
};

const POOL_CONFIGS = [
  { tokenA: TOKENS.SUI, tokenB: TOKENS.USDC, fee: 3000, tvl: 45_000_000, volume: 12_000_000, apr: 42.5 },
  { tokenA: TOKENS.SUI, tokenB: TOKENS.USDT, fee: 3000, tvl: 28_000_000, volume: 8_500_000, apr: 38.2 },
  { tokenA: TOKENS.WETH, tokenB: TOKENS.SUI, fee: 3000, tvl: 32_000_000, volume: 9_200_000, apr: 35.8 },
  { tokenA: TOKENS.WBTC, tokenB: TOKENS.SUI, fee: 3000, tvl: 25_000_000, volume: 6_800_000, apr: 28.4 },
  { tokenA: TOKENS.USDC, tokenB: TOKENS.USDT, fee: 100, tvl: 85_000_000, volume: 45_000_000, apr: 8.5 },
  { tokenA: TOKENS.MMT, tokenB: TOKENS.SUI, fee: 3000, tvl: 18_000_000, volume: 5_200_000, apr: 65.2 },
  { tokenA: TOKENS.DEEP, tokenB: TOKENS.SUI, fee: 3000, tvl: 12_000_000, volume: 3_800_000, apr: 48.6 },
  { tokenA: TOKENS.WETH, tokenB: TOKENS.USDC, fee: 500, tvl: 22_000_000, volume: 7_100_000, apr: 24.3 },
  { tokenA: TOKENS.MMT, tokenB: TOKENS.USDC, fee: 3000, tvl: 8_500_000, volume: 2_400_000, apr: 72.1 },
  { tokenA: TOKENS.SUI, tokenB: TOKENS.DEEP, fee: 3000, tvl: 6_200_000, volume: 1_900_000, apr: 55.8 },
];

function randomVariation(base: number, percent: number = 10): number {
  const variation = (Math.random() - 0.5) * 2 * (percent / 100);
  return base * (1 + variation);
}

export function generateMockPools(): Pool[] {
  return POOL_CONFIGS.map((config) => {
    const tvl = randomVariation(config.tvl, 15);
    const volume24h = randomVariation(config.volume, 25);
    const fees24h = volume24h * (config.fee / 1_000_000);
    const priceA = config.tokenA.symbol === 'USDC' || config.tokenA.symbol === 'USDT' ? 1 : 
                   config.tokenA.symbol === 'SUI' ? 3.85 :
                   config.tokenA.symbol === 'WETH' ? 3450 :
                   config.tokenA.symbol === 'WBTC' ? 105000 :
                   config.tokenA.symbol === 'MMT' ? 0.223 :
                   config.tokenA.symbol === 'DEEP' ? 0.18 : 1;
    
    return {
      id: generateMockId(),
      address: generateMockId(),
      tokenA: { ...config.tokenA, logoUrl: getTokenLogo(config.tokenA.symbol) },
      tokenB: { ...config.tokenB, logoUrl: getTokenLogo(config.tokenB.symbol) },
      fee: config.fee,
      tickSpacing: config.fee === 100 ? 1 : config.fee === 500 ? 10 : 60,
      liquidity: (tvl * 1e9).toString(),
      sqrtPrice: '0',
      currentTick: Math.floor(Math.random() * 10000) - 5000,
      tvlUsd: tvl,
      volume24h,
      volume7d: volume24h * 7 * randomVariation(1, 20),
      fees24h,
      fees7d: fees24h * 7 * randomVariation(1, 15),
      apr: randomVariation(config.apr, 20),
      feeApr: randomVariation(config.apr * 0.7, 15),
      rewardApr: randomVariation(config.apr * 0.3, 25),
      priceTokenA: priceA,
      priceTokenB: 1,
      priceChange24h: (Math.random() - 0.5) * 10,
      createdAt: new Date(Date.now() - Math.random() * 180 * 24 * 60 * 60 * 1000).toISOString(),
    };
  });
}

export function generateMockPositions(walletAddress: string, pools: Pool[]): Position[] {
  const numPositions = Math.floor(Math.random() * 5) + 2;
  const selectedPools = pools.sort(() => Math.random() - 0.5).slice(0, numPositions);
  
  return selectedPools.map((pool) => {
    const totalValue = randomVariation(5000 + Math.random() * 50000, 30);
    const isInRange = Math.random() > 0.3;
    const pnl = (Math.random() - 0.4) * totalValue * 0.3;
    const uncollectedFees = totalValue * (Math.random() * 0.05);
    
    return {
      id: generateMockId(),
      owner: walletAddress,
      poolId: pool.id,
      pool,
      liquidity: (totalValue * 1e9).toString(),
      tickLower: pool.currentTick - Math.floor(Math.random() * 500 + 100),
      tickUpper: pool.currentTick + Math.floor(Math.random() * 500 + 100),
      priceLower: pool.priceTokenA * 0.85,
      priceUpper: pool.priceTokenA * 1.15,
      tokenAAmount: (totalValue / 2 / pool.priceTokenA).toFixed(6),
      tokenBAmount: (totalValue / 2).toFixed(6),
      tokenAAmountUsd: totalValue / 2,
      tokenBAmountUsd: totalValue / 2,
      totalValueUsd: totalValue,
      uncollectedFeesA: (uncollectedFees / 2 / pool.priceTokenA).toFixed(6),
      uncollectedFeesB: (uncollectedFees / 2).toFixed(6),
      uncollectedFeesUsd: uncollectedFees,
      claimableRewardsUsd: uncollectedFees * 0.15, // Mock xSUI rewards (~15% of fees)
      depositedTokenA: ((totalValue - pnl) / 2 / pool.priceTokenA).toFixed(6),
      depositedTokenB: ((totalValue - pnl) / 2).toFixed(6),
      depositedValueUsd: totalValue - pnl,
      withdrawnTokenA: '0',
      withdrawnTokenB: '0',
      withdrawnValueUsd: 0,
      pnl,
      pnlPercent: (pnl / (totalValue - pnl)) * 100,
      divergencePnl: pnl * 0.4,
      feePnl: pnl * 0.6 + uncollectedFees,
      roi: ((pnl + uncollectedFees) / (totalValue - pnl)) * 100,
      apr: randomVariation(pool.apr, 30),
      feeApr: randomVariation(pool.feeApr, 25),
      rangeUtilization: isInRange ? randomVariation(75, 30) : 0,
      isInRange,
      createdAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
      lastUpdated: new Date().toISOString(),
    };
  });
}

export function generateMockLeaderboard(pools: Pool[]): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  
  for (let i = 0; i < 50; i++) {
    const pool = pools[Math.floor(Math.random() * pools.length)];
    const totalValue = randomVariation(50000 + Math.random() * 500000, 40);
    const pnl = totalValue * (0.1 + Math.random() * 0.5) * (Math.random() > 0.2 ? 1 : -0.5);
    const feesEarned = totalValue * (0.02 + Math.random() * 0.1);
    
    entries.push({
      rank: i + 1,
      address: generateMockId(),
      positionId: generateMockId(),
      pool,
      totalPnl: pnl,
      pnlPercent: (pnl / (totalValue - pnl)) * 100,
      totalValue,
      apr: randomVariation(pool.apr, 50),
      feesEarned,
      daysActive: Math.floor(Math.random() * 180) + 7,
      strategy: ['Wide Range', 'Tight Range', 'Single-Sided', 'Balanced'][Math.floor(Math.random() * 4)],
    });
  }
  
  return entries.sort((a, b) => b.totalPnl - a.totalPnl).map((e, i) => ({ ...e, rank: i + 1 }));
}

export function generateVolumeHistory(days: number = 30): VolumeData[] {
  const data: VolumeData[] = [];
  const baseVolume = 10_000_000;
  
  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const volume = randomVariation(baseVolume, 40);
    
    data.push({
      timestamp: date.toISOString(),
      volume,
      fees: volume * 0.003,
    });
  }
  
  return data;
}

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

export function generatePositionHistory(position: Position, days: number = 30): PositionHistory[] {
  const data: PositionHistory[] = [];
  let value = position.depositedValueUsd;
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
      pnl: value - position.depositedValueUsd + totalFees,
      feesCollected: totalFees,
    });
  }
  
  return data;
}

export async function fetchPoolsData(): Promise<Pool[]> {
  await new Promise(resolve => setTimeout(resolve, 800));
  return generateMockPools();
}

export async function fetchPositions(walletAddress: string): Promise<Position[]> {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const pools = generateMockPools();
  return generateMockPositions(walletAddress, pools);
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  await new Promise(resolve => setTimeout(resolve, 600));
  const pools = generateMockPools();
  return generateMockLeaderboard(pools);
}
