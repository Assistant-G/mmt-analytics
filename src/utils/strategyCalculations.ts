/**
 * Strategy calculation utilities for LP position management
 */

/**
 * Calculate impermanent loss (divergence loss) percentage
 */
export function calculateDivergenceLoss(
  initialPriceRatio: number,
  currentPriceRatio: number
): number {
  if (initialPriceRatio <= 0 || currentPriceRatio <= 0) return 0;

  const priceRatio = currentPriceRatio / initialPriceRatio;
  const sqrtRatio = Math.sqrt(priceRatio);

  // IL formula: 2 * sqrt(k) / (1 + k) - 1
  const il = (2 * sqrtRatio) / (1 + priceRatio) - 1;

  return il * 100; // Convert to percentage
}

/**
 * Calculate HODL value vs LP value to determine divergence loss
 */
export function calculatePnLComponents(
  initialAmountA: number,
  initialAmountB: number,
  currentAmountA: number,
  currentAmountB: number,
  initialPrice: number,
  currentPrice: number,
  feesCollectedA: number,
  feesCollectedB: number
): {
  hodlValue: number;
  lpValue: number;
  divergenceLoss: number;
  feesValue: number;
  netPnl: number;
  netPnlPercent: number;
} {
  // HODL value: if we just held the tokens
  const hodlValue = initialAmountA * currentPrice + initialAmountB;

  // LP value: current position + fees
  const lpPositionValue = currentAmountA * currentPrice + currentAmountB;
  const feesValue = feesCollectedA * currentPrice + feesCollectedB;
  const lpValue = lpPositionValue + feesValue;

  // Initial value
  const initialValue = initialAmountA * initialPrice + initialAmountB;

  // Divergence loss
  const divergenceLoss = hodlValue - lpPositionValue;
  const divergenceLossPercent = (divergenceLoss / initialValue) * 100;

  // Net PnL
  const netPnl = lpValue - hodlValue;
  const netPnlPercent = (netPnl / hodlValue) * 100;

  return {
    hodlValue,
    lpValue,
    divergenceLoss: divergenceLossPercent,
    feesValue,
    netPnl,
    netPnlPercent,
  };
}

/**
 * Check if position is out of range
 */
export function isPositionOutOfRange(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): boolean {
  return currentTick < tickLower || currentTick > tickUpper;
}

/**
 * Calculate price from tick
 */
export function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  // Price = 1.0001^tick * 10^(decimalsB - decimalsA)
  const price = Math.pow(1.0001, tick);
  const decimalAdjustment = Math.pow(10, decimalsB - decimalsA);
  return price * decimalAdjustment;
}

/**
 * Calculate tick from price
 */
export function priceToTick(price: number, decimalsA: number, decimalsB: number): number {
  // Reverse of tickToPrice
  const decimalAdjustment = Math.pow(10, decimalsB - decimalsA);
  const adjustedPrice = price / decimalAdjustment;
  return Math.log(adjustedPrice) / Math.log(1.0001);
}

/**
 * Calculate tick range from percentage
 */
export function calculateTickRange(
  currentTick: number,
  rangeBps: number,
  tickSpacing: number
): { tickLower: number; tickUpper: number } {
  // Convert basis points to percentage (500 bps = 5%)
  const rangePercent = rangeBps / 10000;

  // Calculate tick difference
  // Since price = 1.0001^tick, a 5% price change ≈ 500 tick change
  const tickDiff = Math.floor((rangePercent * 10000) / 1);

  let tickLower = currentTick - tickDiff;
  let tickUpper = currentTick + tickDiff;

  // Round to tick spacing
  tickLower = Math.floor(tickLower / tickSpacing) * tickSpacing;
  tickUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing;

  return { tickLower, tickUpper };
}

/**
 * Calculate asymmetric tick range (for trend following)
 */
export function calculateAsymmetricTickRange(
  currentTick: number,
  lowerRangeBps: number,
  upperRangeBps: number,
  tickSpacing: number
): { tickLower: number; tickUpper: number } {
  const lowerTickDiff = Math.floor((lowerRangeBps / 10000) * 10000);
  const upperTickDiff = Math.floor((upperRangeBps / 10000) * 10000);

  let tickLower = currentTick - lowerTickDiff;
  let tickUpper = currentTick + upperTickDiff;

  // Round to tick spacing
  tickLower = Math.floor(tickLower / tickSpacing) * tickSpacing;
  tickUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing;

  return { tickLower, tickUpper };
}

/**
 * Calculate historical volatility (standard deviation of returns)
 */
export function calculateVolatility(
  prices: number[],
  lookbackPeriods: number = 24
): number {
  if (prices.length < 2) return 0;

  // Use last N prices
  const recentPrices = prices.slice(-lookbackPeriods);
  if (recentPrices.length < 2) return 0;

  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < recentPrices.length; i++) {
    const returnVal = (recentPrices[i] - recentPrices[i - 1]) / recentPrices[i - 1];
    returns.push(returnVal);
  }

  // Calculate mean return
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate variance
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;

  // Standard deviation (volatility)
  const volatility = Math.sqrt(variance);

  // Annualized volatility (assuming hourly prices)
  const annualizedVolatility = volatility * Math.sqrt(24 * 365);

  return annualizedVolatility * 100; // Return as percentage
}

/**
 * Detect trend using simple EMA crossover
 */
export function detectTrend(
  prices: number[],
  shortPeriod: number = 20,
  longPeriod: number = 50
): 'bullish' | 'bearish' | 'neutral' {
  if (prices.length < longPeriod) return 'neutral';

  const emaShort = calculateEMA(prices, shortPeriod);
  const emaLong = calculateEMA(prices, longPeriod);

  const diff = emaShort - emaLong;
  const diffPercent = (diff / emaLong) * 100;

  // Threshold for trend detection (e.g., 1% difference)
  if (diffPercent > 1) return 'bullish';
  if (diffPercent < -1) return 'bearish';
  return 'neutral';
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) period = prices.length;

  const multiplier = 2 / (period + 1);
  let ema = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) period = prices.length;

  const recentPrices = prices.slice(-period);
  const sum = recentPrices.reduce((acc, price) => acc + price, 0);
  return sum / period;
}

/**
 * Calculate fee collection rate (fees per hour)
 */
export function calculateFeeVelocity(
  feesCollected: number,
  timePeriodMs: number
): number {
  if (timePeriodMs === 0) return 0;
  const hours = timePeriodMs / (1000 * 60 * 60);
  return feesCollected / hours;
}

/**
 * Calculate expected fee rate based on TVL and APR
 */
export function calculateExpectedFeeRate(
  tvl: number,
  aprPercent: number
): number {
  // Expected fees per hour
  return (tvl * aprPercent) / 100 / 365 / 24;
}

/**
 * Determine optimal range based on volatility
 */
export function getVolatilityBasedRange(
  volatility: number,
  lowThreshold: number = 5,
  highThreshold: number = 20
): {
  rangeBps: number;
  timerMs: number;
  category: 'low' | 'medium' | 'high';
} {
  if (volatility < lowThreshold) {
    return {
      category: 'low',
      rangeBps: 200, // ±2%
      timerMs: 8 * 3600 * 1000, // 8 hours
    };
  } else if (volatility < highThreshold) {
    return {
      category: 'medium',
      rangeBps: 500, // ±5%
      timerMs: 4 * 3600 * 1000, // 4 hours
    };
  } else {
    return {
      category: 'high',
      rangeBps: 800, // ±8%
      timerMs: 2 * 3600 * 1000, // 2 hours
    };
  }
}

/**
 * Calculate break-even APR needed to overcome IL
 */
export function calculateBreakEvenAPR(
  volatilityPercent: number,
  rebalancesPerDay: number
): number {
  // Rough estimate: IL per rebalance ≈ volatility^2 / 8
  const ilPerRebalance = Math.pow(volatilityPercent / 100, 2) / 8;
  const dailyIL = ilPerRebalance * rebalancesPerDay;
  const annualIL = dailyIL * 365;

  // Need to earn at least this much in fees to break even
  return annualIL * 100; // Convert to percentage
}

/**
 * Calculate Sharpe ratio for strategy performance
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number = 0
): number {
  if (returns.length === 0) return 0;

  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const excessReturn = meanReturn - riskFreeRate;

  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  return excessReturn / stdDev;
}

/**
 * Calculate max drawdown
 */
export function calculateMaxDrawdown(values: number[]): number {
  if (values.length === 0) return 0;

  let maxDrawdown = 0;
  let peak = values[0];

  for (const value of values) {
    if (value > peak) {
      peak = value;
    }
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown * 100; // Return as percentage
}

/**
 * Estimate gas cost for rebalancing
 */
export function estimateRebalanceGasCost(
  _gasPrice: number,
  suiPrice: number
): number {
  // Rough estimate: close position + open position ≈ 0.01 SUI
  const estimatedSuiCost = 0.01;
  return estimatedSuiCost * suiPrice;
}

/**
 * Calculate optimal rebalancing frequency
 */
export function calculateOptimalRebalanceFrequency(
  volatility: number,
  gasCostUsd: number,
  positionSize: number,
  _targetApr: number
): {
  recommendedTimerMs: number;
  expectedRebalancesPerDay: number;
  expectedGasCostPerDay: number;
} {
  // Higher volatility = more frequent rebalancing needed
  // But must balance against gas costs

  // Base frequency on volatility
  let rebalancesPerDay: number;
  if (volatility < 5) {
    rebalancesPerDay = 2; // Every 12 hours
  } else if (volatility < 15) {
    rebalancesPerDay = 4; // Every 6 hours
  } else if (volatility < 30) {
    rebalancesPerDay = 8; // Every 3 hours
  } else {
    rebalancesPerDay = 12; // Every 2 hours
  }

  // Adjust based on gas cost ratio
  const dailyGasCost = gasCostUsd * rebalancesPerDay;
  const gasCostRatio = dailyGasCost / positionSize;

  // If gas costs are > 0.1% of position per day, reduce frequency
  if (gasCostRatio > 0.001) {
    rebalancesPerDay = Math.max(1, rebalancesPerDay / 2);
  }

  const recommendedTimerMs = (24 * 3600 * 1000) / rebalancesPerDay;

  return {
    recommendedTimerMs,
    expectedRebalancesPerDay: rebalancesPerDay,
    expectedGasCostPerDay: dailyGasCost,
  };
}

/**
 * Validate strategy parameters
 */
export function validateStrategyParams(
  rangeBps: number,
  timerMs: number,
  poolTickSpacing: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Range validation
  if (rangeBps < 10) {
    errors.push('Range too tight (< 0.1%) - may be constantly out of range');
  }
  if (rangeBps > 5000) {
    errors.push('Range too wide (> 50%) - inefficient capital usage');
  }

  // Timer validation
  const minTimerMs = 60 * 1000; // 1 minute
  const maxTimerMs = 30 * 24 * 3600 * 1000; // 30 days
  if (timerMs < minTimerMs) {
    errors.push(`Timer too short (< 1 minute)`);
  }
  if (timerMs > maxTimerMs) {
    errors.push(`Timer too long (> 30 days)`);
  }

  // Tick spacing validation (specific to pool)
  const tickDiff = Math.floor((rangeBps / 10000) * 10000);
  if (tickDiff < poolTickSpacing) {
    errors.push(
      `Range too narrow for pool's tick spacing (${poolTickSpacing})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get recommended strategy based on pool characteristics
 */
export function recommendStrategy(pool: {
  tokenASymbol: string;
  tokenBSymbol: string;
  volume24h: number;
  tvl: number;
  volatility?: number;
}): string {
  const { tokenASymbol, tokenBSymbol, volume24h, tvl, volatility = 10 } = pool;

  // Check if stablecoin pair
  const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD'];
  const isStablePair =
    stablecoins.includes(tokenASymbol) && stablecoins.includes(tokenBSymbol);

  if (isStablePair) {
    return 'stablecoin-farmer';
  }

  // Check volatility
  if (volatility < 5) {
    return 'aggressive-yield';
  } else if (volatility > 30) {
    return 'conservative';
  }

  // Check volume/TVL ratio (indicator of activity)
  const volumeToTvl = volume24h / tvl;
  if (volumeToTvl > 1) {
    // High activity - tight ranges can be very profitable
    return 'smart-rebalance';
  }

  // Default to smart rebalancing
  return 'smart-rebalance';
}
