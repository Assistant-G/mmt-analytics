/**
 * Rebalance Service
 *
 * Calculates the swap needed to return to original token amounts after LP cycling.
 * When providing liquidity, token ratios change due to AMM rebalancing.
 * This service helps users restore their original position.
 */

import { getTokenPriceSync } from './priceService';

export interface RebalanceInfo {
  // Token changes from initial
  tokenAInitial: number;
  tokenBInitial: number;
  tokenACurrent: number;
  tokenBCurrent: number;
  tokenADiff: number;  // Positive = need more, Negative = have excess
  tokenBDiff: number;

  // What needs to be swapped to restore original amounts
  needsRebalance: boolean;
  swapDirection: 'A_TO_B' | 'B_TO_A' | 'NONE';
  swapFromAmount: number;
  swapFromSymbol: string;
  swapToAmount: number;
  swapToSymbol: string;

  // USD values
  swapValueUsd: number;
  priceImpactEstimate: number; // Estimated slippage/impact

  // Symbols for display
  tokenASymbol: string;
  tokenBSymbol: string;
}

/**
 * Calculate rebalancing requirements to restore original token amounts
 */
export function calculateRebalance(
  tokenAInitial: number,
  tokenBInitial: number,
  tokenACurrent: number,
  tokenBCurrent: number,
  tokenASymbol: string,
  tokenBSymbol: string
): RebalanceInfo {
  // Calculate differences
  const tokenADiff = tokenAInitial - tokenACurrent; // Positive = need more A
  const tokenBDiff = tokenBInitial - tokenBCurrent; // Positive = need more B

  // Get current prices
  const tokenAPrice = getTokenPriceSync(tokenASymbol);
  const tokenBPrice = getTokenPriceSync(tokenBSymbol);

  // Determine swap direction and amounts
  let swapDirection: 'A_TO_B' | 'B_TO_A' | 'NONE' = 'NONE';
  let swapFromAmount = 0;
  let swapToAmount = 0;
  let swapFromSymbol = '';
  let swapToSymbol = '';

  // If we have excess B and need more A → Swap B to A
  if (tokenBDiff < 0 && tokenADiff > 0) {
    swapDirection = 'B_TO_A';
    swapFromAmount = Math.abs(tokenBDiff); // Sell excess B
    // Calculate how much A we'll get (using price ratio)
    swapToAmount = (swapFromAmount * tokenBPrice) / tokenAPrice;
    // But we only need tokenADiff amount of A
    if (swapToAmount > tokenADiff) {
      // Adjust - only swap enough to get what we need
      swapToAmount = tokenADiff;
      swapFromAmount = (swapToAmount * tokenAPrice) / tokenBPrice;
    }
    swapFromSymbol = tokenBSymbol;
    swapToSymbol = tokenASymbol;
  }
  // If we have excess A and need more B → Swap A to B
  else if (tokenADiff < 0 && tokenBDiff > 0) {
    swapDirection = 'A_TO_B';
    swapFromAmount = Math.abs(tokenADiff); // Sell excess A
    // Calculate how much B we'll get (using price ratio)
    swapToAmount = (swapFromAmount * tokenAPrice) / tokenBPrice;
    // But we only need tokenBDiff amount of B
    if (swapToAmount > tokenBDiff) {
      // Adjust - only swap enough to get what we need
      swapToAmount = tokenBDiff;
      swapFromAmount = (swapToAmount * tokenBPrice) / tokenAPrice;
    }
    swapFromSymbol = tokenASymbol;
    swapToSymbol = tokenBSymbol;
  }

  // Calculate USD value of the swap
  const swapValueUsd = swapDirection === 'A_TO_B'
    ? swapFromAmount * tokenAPrice
    : swapDirection === 'B_TO_A'
      ? swapFromAmount * tokenBPrice
      : 0;

  // Estimate price impact (rough - would need DEX data for accurate)
  // Small swaps have minimal impact
  const priceImpactEstimate = swapValueUsd > 10000 ? 0.5 : swapValueUsd > 1000 ? 0.2 : 0.1;

  return {
    tokenAInitial,
    tokenBInitial,
    tokenACurrent,
    tokenBCurrent,
    tokenADiff,
    tokenBDiff,
    needsRebalance: swapDirection !== 'NONE' && swapFromAmount > 0.0001,
    swapDirection,
    swapFromAmount,
    swapFromSymbol,
    swapToAmount,
    swapToSymbol,
    swapValueUsd,
    priceImpactEstimate,
    tokenASymbol,
    tokenBSymbol,
  };
}

/**
 * Format rebalance info for display
 */
export function formatRebalanceMessage(info: RebalanceInfo): string {
  if (!info.needsRebalance) {
    return 'No rebalancing needed - position is close to original amounts.';
  }

  const fromAmount = info.swapFromAmount.toFixed(6);
  const toAmount = info.swapToAmount.toFixed(6);

  return `Swap ${fromAmount} ${info.swapFromSymbol} → ${toAmount} ${info.swapToSymbol} to restore original position`;
}

/**
 * Get summary of token changes
 */
export function getTokenChangesSummary(info: RebalanceInfo): {
  tokenA: { symbol: string; initial: number; current: number; diff: number; diffPercent: number };
  tokenB: { symbol: string; initial: number; current: number; diff: number; diffPercent: number };
} {
  return {
    tokenA: {
      symbol: info.tokenASymbol,
      initial: info.tokenAInitial,
      current: info.tokenACurrent,
      diff: info.tokenACurrent - info.tokenAInitial,
      diffPercent: info.tokenAInitial > 0
        ? ((info.tokenACurrent - info.tokenAInitial) / info.tokenAInitial) * 100
        : 0,
    },
    tokenB: {
      symbol: info.tokenBSymbol,
      initial: info.tokenBInitial,
      current: info.tokenBCurrent,
      diff: info.tokenBCurrent - info.tokenBInitial,
      diffPercent: info.tokenBInitial > 0
        ? ((info.tokenBCurrent - info.tokenBInitial) / info.tokenBInitial) * 100
        : 0,
    },
  };
}
