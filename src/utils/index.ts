import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, options?: { compact?: boolean; decimals?: number }): string {
  const { compact = false } = options || {};

  // For small values, show more decimal places
  let decimals = options?.decimals ?? 2;
  if (options?.decimals === undefined) {
    const absValue = Math.abs(value);
    if (absValue > 0 && absValue < 0.01) {
      decimals = 4; // Show $0.0023 instead of $0.00
    }
    if (absValue > 0 && absValue < 0.0001) {
      decimals = 6; // Show very small values
    }
  }

  if (compact) {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(decimals)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(decimals)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(decimals)}K`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format currency without rounding to zero.
 * Automatically uses enough decimal places to show at least 2 significant digits.
 * E.g. 0.00000342 → "$0.0000034", 0.0015 → "$0.0015", 0.50 → "$0.50"
 * Zero or near-zero values (< 1e-10) → "$0"
 */
export function formatPreciseCurrency(value: number): string {
  const absValue = Math.abs(value);
  // Treat zero and near-zero (floating point noise) as exactly zero
  if (absValue < 1e-10) return '$0';

  // Find how many decimals needed to show at least 2 significant digits
  let decimals = 2;
  if (absValue < 1) {
    // Count leading zeros after decimal point, then add 2 for significant digits
    const leadingZeros = Math.max(0, Math.floor(-Math.log10(absValue)));
    decimals = leadingZeros + 2;
  }

  const sign = value < 0 ? '-' : '';
  return `${sign}$${absValue.toFixed(decimals)}`;
}

export function formatNumber(value: number, options?: { compact?: boolean; decimals?: number }): string {
  const { compact = false, decimals = 2 } = options || {};
  
  if (compact) {
    if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(decimals)}B`;
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(decimals)}M`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(decimals)}K`;
  }
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, decimals: number = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatAddress(address: string, chars: number = 6): string {
  if (!address) return '';
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * Math.pow(10, decimalsA - decimalsB);
}

export function priceToTick(price: number, decimalsA: number, decimalsB: number): number {
  const adjustedPrice = price / Math.pow(10, decimalsA - decimalsB);
  return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
}

export function calculateRangeUtilization(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): number {
  if (currentTick < tickLower || currentTick > tickUpper) return 0;
  const range = tickUpper - tickLower;
  const position = currentTick - tickLower;
  return Math.min(100, Math.max(0, (position / range) * 100));
}

export function isInRange(currentTick: number, tickLower: number, tickUpper: number): boolean {
  return currentTick >= tickLower && currentTick <= tickUpper;
}

export function getTimeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return 'Just now';
}

export function generateMockId(): string {
  return `0x${Array.from({ length: 64 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const TOKEN_LOGOS: Record<string, string> = {
  SUI: 'https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  WETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  WBTC: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png',
  MMT: 'https://s2.coinmarketcap.com/static/img/coins/64x64/35755.png',
  DEEP: 'https://assets.coingecko.com/coins/images/38101/small/DeepBook_logo.jpg',
};

export function getTokenLogo(symbol: string): string {
  return TOKEN_LOGOS[symbol.toUpperCase()] || `https://ui-avatars.com/api/?name=${symbol}&background=1a1a2e&color=00D4AA&rounded=true&bold=true`;
}

export const POOL_FEE_TIERS = [
  { fee: 100, label: '0.01%', description: 'Best for stablecoin pairs' },
  { fee: 500, label: '0.05%', description: 'Best for stable pairs' },
  { fee: 3000, label: '0.3%', description: 'Best for most pairs' },
  { fee: 10000, label: '1%', description: 'Best for exotic pairs' },
];

export function getFeeLabel(fee: number): string {
  const tier = POOL_FEE_TIERS.find(t => t.fee === fee);
  return tier?.label || `${(fee / 10000).toFixed(2)}%`;
}
