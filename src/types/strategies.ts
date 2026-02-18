/**
 * Strategy types for automated LP position cycling
 */

export type StrategyType =
  | 'time-based'
  | 'out-of-range'
  | 'divergence-protection'
  | 'smart-rebalance'
  | 'profit-target'
  | 'volatility-adaptive'
  | 'asymmetric-trend'
  | 'fee-velocity';

export type TrendBias = 'bullish' | 'bearish' | 'neutral';
export type RiskLevel = 'low' | 'medium' | 'high' | 'custom';

/**
 * Base strategy configuration
 */
export interface BaseStrategy {
  id: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  enabled: boolean;
}

/**
 * Time-based cycling (current implementation)
 */
export interface TimeBasedStrategy extends BaseStrategy {
  type: 'time-based';
  timerDurationMs: number; // Fixed timer
  rangeBps: number; // e.g., 500 = ±5%
}

/**
 * Out-of-range detection
 * Triggers when position goes out of range
 */
export interface OutOfRangeStrategy extends BaseStrategy {
  type: 'out-of-range';
  rangeBps: number;
  checkIntervalMs: number; // How often to check (e.g., 30000 = 30s)
  maxTimerMs?: number; // Safety backup timer
}

/**
 * Divergence loss (impermanent loss) protection
 */
export interface DivergenceProtectionStrategy extends BaseStrategy {
  type: 'divergence-protection';
  maxDivergenceLossPercent: number; // e.g., 3 = 3%
  minFeeBufferMultiplier: number; // e.g., 1.5 = fees must be 1.5x IL
  checkIntervalMs: number;
}

/**
 * Smart rebalancing - combines multiple triggers
 */
export interface SmartRebalanceStrategy extends BaseStrategy {
  type: 'smart-rebalance';
  rangeBps: number;
  // Primary trigger: out of range
  checkOutOfRange: boolean;
  checkIntervalMs: number;
  // Backup: max timer
  maxTimerMs: number;
  // Safety: divergence protection
  maxDivergenceLossPercent: number;
  // Optional: minimum time between rebalances (to save gas)
  minTimeBetweenRebalancesMs?: number;
}

/**
 * Profit target + Stop loss
 */
export interface ProfitTargetStrategy extends BaseStrategy {
  type: 'profit-target';
  profitTargetPercent: number; // e.g., 5 = close at +5% PnL
  stopLossPercent: number; // e.g., 2 = close at -2% PnL
  autoReinvest: boolean; // Reopen after profit target hit?
  cooldownAfterStopLossMs?: number; // Wait before reopening after stop loss
  checkIntervalMs: number;
}

/**
 * Volatility-adaptive ranges
 * Adjusts range width based on recent volatility
 */
export interface VolatilityAdaptiveStrategy extends BaseStrategy {
  type: 'volatility-adaptive';
  // Volatility thresholds (%)
  lowVolatilityThreshold: number; // e.g., 5%
  highVolatilityThreshold: number; // e.g., 20%
  // Range adjustments
  lowVolatilityRangeBps: number; // e.g., 200 = ±2%
  mediumVolatilityRangeBps: number; // e.g., 500 = ±5%
  highVolatilityRangeBps: number; // e.g., 800 = ±8%
  // Timer adjustments
  lowVolatilityTimerMs: number;
  mediumVolatilityTimerMs: number;
  highVolatilityTimerMs: number;
  // Lookback period for volatility calculation
  volatilityLookbackHours: number; // e.g., 24
}

/**
 * Asymmetric range based on trend direction
 */
export interface AsymmetricTrendStrategy extends BaseStrategy {
  type: 'asymmetric-trend';
  trendBias: TrendBias;
  // When bullish: wider upper range
  bullishLowerRangeBps: number; // e.g., 100 = -1%
  bullishUpperRangeBps: number; // e.g., 500 = +5%
  // When bearish: wider lower range
  bearishLowerRangeBps: number; // e.g., 500 = -5%
  bearishUpperRangeBps: number; // e.g., 100 = +1%
  // When neutral: symmetric
  neutralRangeBps: number; // e.g., 300 = ±3%
  // Auto-detect trend?
  autoDetectTrend: boolean;
  trendLookbackHours?: number; // For EMA calculation
  rebalanceOnTrendChange: boolean;
}

/**
 * Fee velocity monitoring
 * Rebalances when fee collection rate drops
 */
export interface FeeVelocityStrategy extends BaseStrategy {
  type: 'fee-velocity';
  minFeeVelocityPercentOfExpected: number; // e.g., 30 = rebalance if earning <30% of expected
  checkIntervalMs: number;
  expectedAprPercent: number; // Expected APR to compare against
  maxTimerMs: number; // Backup timer
}

/**
 * Union type of all strategies
 */
export type Strategy =
  | TimeBasedStrategy
  | OutOfRangeStrategy
  | DivergenceProtectionStrategy
  | SmartRebalanceStrategy
  | ProfitTargetStrategy
  | VolatilityAdaptiveStrategy
  | AsymmetricTrendStrategy
  | FeeVelocityStrategy;

/**
 * Strategy preset for easy selection
 */
export interface StrategyPreset {
  id: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  strategy: Strategy;
  // Expected outcomes
  expectedAprMultiplier: string; // e.g., "2-4x" baseline
  gasCostLevel: 'low' | 'medium' | 'high';
  bestFor: string[];
}

/**
 * Performance metrics for strategy evaluation
 */
export interface StrategyMetrics {
  strategyId: string;
  vaultId: string;
  // Returns
  totalPnlPercent: number;
  totalFeesCollected: number;
  totalDivergenceLoss: number;
  netPnlPercent: number;
  // Efficiency
  avgTimeInRange: number; // Percentage
  numberOfRebalances: number;
  avgFeesPerRebalance: number;
  totalGasCost: number;
  // Risk
  maxDrawdownPercent: number;
  sharpeRatio?: number;
  // Time
  startTime: number;
  endTime: number;
  daysActive: number;
}

/**
 * Real-time strategy state
 */
export interface StrategyState {
  vaultId: string;
  strategy: Strategy;
  // Current position
  currentTick?: number;
  tickLower?: number;
  tickUpper?: number;
  isInRange: boolean;
  // Metrics
  currentPnlPercent: number;
  currentDivergenceLossPercent: number;
  feesCollectedUsd: number;
  // Next action
  nextCheckTime: number;
  nextExecutionTime?: number;
  recommendedAction?: 'hold' | 'rebalance' | 'close';
  actionReason?: string;
}

/**
 * Default strategy presets
 */
export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'smart-rebalance',
    name: 'Smart Rebalancing',
    description: 'Best overall strategy - combines out-of-range detection with safety features',
    riskLevel: 'low',
    expectedAprMultiplier: '3-8x',
    gasCostLevel: 'medium',
    bestFor: ['All pairs', 'Most users', 'Balanced approach'],
    strategy: {
      id: 'smart-rebalance-default',
      name: 'Smart Rebalancing',
      description: 'Optimal balance of efficiency and safety',
      riskLevel: 'low',
      enabled: true,
      type: 'smart-rebalance',
      rangeBps: 300, // ±3%
      checkOutOfRange: true,
      checkIntervalMs: 60000, // Check every minute
      maxTimerMs: 24 * 3600 * 1000, // 24h max
      maxDivergenceLossPercent: 3,
      minTimeBetweenRebalancesMs: 1800000, // 30 min minimum
    },
  },
  {
    id: 'aggressive-yield',
    name: 'Aggressive Yield',
    description: 'Maximum APY with tight ranges and frequent rebalancing',
    riskLevel: 'high',
    expectedAprMultiplier: '5-15x',
    gasCostLevel: 'high',
    bestFor: ['Stablecoins', 'Low volatility', 'Max returns'],
    strategy: {
      id: 'aggressive-default',
      name: 'Aggressive Yield',
      description: 'Maximize APY with tight ranges',
      riskLevel: 'high',
      enabled: true,
      type: 'time-based',
      timerDurationMs: 2 * 3600 * 1000, // 2 hours
      rangeBps: 150, // ±1.5%
    },
  },
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Wider ranges, less frequent rebalancing, built-in profit taking',
    riskLevel: 'low',
    expectedAprMultiplier: '1.5-3x',
    gasCostLevel: 'low',
    bestFor: ['Risk-averse', 'Volatile pairs', 'Long-term'],
    strategy: {
      id: 'conservative-default',
      name: 'Conservative',
      description: 'Lower risk, stable returns',
      riskLevel: 'low',
      enabled: true,
      type: 'smart-rebalance',
      rangeBps: 500, // ±5%
      checkOutOfRange: true,
      checkIntervalMs: 300000, // Check every 5 min
      maxTimerMs: 12 * 3600 * 1000, // 12h max
      maxDivergenceLossPercent: 2,
      minTimeBetweenRebalancesMs: 4 * 3600 * 1000, // 4h minimum
    },
  },
  {
    id: 'stablecoin-farmer',
    name: 'Stablecoin Farmer',
    description: 'Ultra-tight ranges optimized for stablecoin pairs',
    riskLevel: 'low',
    expectedAprMultiplier: '10-30x',
    gasCostLevel: 'medium',
    bestFor: ['USDC/USDT', 'Stablecoins', 'Minimal IL'],
    strategy: {
      id: 'stablecoin-default',
      name: 'Stablecoin Farmer',
      description: 'Optimized for stablecoin pairs',
      riskLevel: 'low',
      enabled: true,
      type: 'smart-rebalance',
      rangeBps: 50, // ±0.5%
      checkOutOfRange: true,
      checkIntervalMs: 60000,
      maxTimerMs: 8 * 3600 * 1000, // 8h max
      maxDivergenceLossPercent: 0.5,
      minTimeBetweenRebalancesMs: 3600000, // 1h minimum
    },
  },
  {
    id: 'trend-follower',
    name: 'Trend Follower',
    description: 'Asymmetric ranges that follow market trends',
    riskLevel: 'medium',
    expectedAprMultiplier: '2-6x',
    gasCostLevel: 'medium',
    bestFor: ['Trending markets', 'Directional bias', 'Advanced users'],
    strategy: {
      id: 'trend-default',
      name: 'Trend Follower',
      description: 'Follow market trends with asymmetric ranges',
      riskLevel: 'medium',
      enabled: true,
      type: 'asymmetric-trend',
      trendBias: 'neutral',
      bullishLowerRangeBps: 100,
      bullishUpperRangeBps: 500,
      bearishLowerRangeBps: 500,
      bearishUpperRangeBps: 100,
      neutralRangeBps: 300,
      autoDetectTrend: true,
      trendLookbackHours: 24,
      rebalanceOnTrendChange: true,
    },
  },
];

/**
 * Helper to get strategy by ID
 */
export function getStrategyPreset(id: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((preset) => preset.id === id);
}

/**
 * Helper to get risk level color
 */
export function getRiskLevelColor(risk: RiskLevel): string {
  switch (risk) {
    case 'low':
      return 'green';
    case 'medium':
      return 'yellow';
    case 'high':
      return 'red';
    case 'custom':
      return 'blue';
  }
}

/**
 * Calculate expected APY multiplier for a strategy
 */
export function calculateExpectedApy(
  baseApy: number,
  strategy: Strategy
): { min: number; max: number } {
  // Multipliers based on strategy type and range
  const rangeBps =
    'rangeBps' in strategy
      ? strategy.rangeBps
      : 'neutralRangeBps' in strategy
        ? strategy.neutralRangeBps
        : 300;

  // Tighter range = higher multiplier
  const rangeMultiplier = 1000 / Math.max(rangeBps, 50);

  // Adjust based on strategy type
  let typeMultiplier = 1;
  switch (strategy.type) {
    case 'time-based':
      typeMultiplier = 0.8; // May waste some rebalances
      break;
    case 'out-of-range':
    case 'smart-rebalance':
      typeMultiplier = 1.2; // More efficient
      break;
    case 'volatility-adaptive':
    case 'asymmetric-trend':
      typeMultiplier = 1.1; // Adaptive efficiency
      break;
    case 'profit-target':
      typeMultiplier = 1.0; // Balanced
      break;
    default:
      typeMultiplier = 1.0;
  }

  const multiplier = rangeMultiplier * typeMultiplier;

  return {
    min: baseApy * multiplier * 0.7,
    max: baseApy * multiplier * 1.3,
  };
}
