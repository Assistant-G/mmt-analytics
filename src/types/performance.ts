/**
 * Performance Tracking Types
 *
 * Comprehensive tracking for LP vault strategies including:
 * - Token balances over time
 * - PnL calculations
 * - Impermanent loss tracking
 * - Range history
 * - Strategy effectiveness metrics
 */

export interface PerformanceSnapshot {
  timestamp: number;
  cycleNumber: number;

  // Token amounts
  tokenAAmount: string;
  tokenBAmount: string;
  tokenASymbol: string;
  tokenBSymbol: string;

  // USD values
  tokenAPrice: number;
  tokenBPrice: number;
  totalValueUsd: number;

  // Position details
  hasPosition: boolean;
  tickLower?: number;
  tickUpper?: number;
  currentTick?: number;
  isInRange?: boolean;

  // Fees collected
  feesCollectedA: string;
  feesCollectedB: string;
  feesCollectedUsd: number;

  // Rewards collected (e.g., xSUI)
  rewardsCollected?: Array<{
    coinType: string;
    amount: string;
    symbol: string;
    usdValue: number;
  }>;

  // PnL metrics
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number; // From closed positions
  totalPnl: number;
  totalPnlPercent: number;

  // IL metrics
  divergenceLoss: number;
  divergenceLossPercent: number;

  // Strategy metadata
  strategyType: string;
  executionReason?: string; // Why was this cycle executed
}

export interface VaultPerformance {
  vaultId: string;
  owner: string;
  poolId: string;
  strategyType: string;

  // Initial state (when vault created)
  initialSnapshot: PerformanceSnapshot;

  // Current state
  currentSnapshot: PerformanceSnapshot;

  // Historical snapshots
  history: PerformanceSnapshot[];

  // Aggregated metrics
  metrics: {
    // Returns
    totalPnl: number;
    totalPnlPercent: number;
    totalFeesUsd: number;
    totalRewardsUsd: number; // Total rewards earned (e.g., xSUI)
    totalDivergenceLoss: number;
    divergenceLossPercent: number; // IL as percentage of HODL value
    netPnl: number; // Fees - IL
    netPnlPercent: number;

    // Performance vs HODL
    hodlValue: number;
    lpValue: number;
    vsHodlPercent: number;

    // Efficiency
    numberOfCycles: number;
    avgTimeInRange: number; // Percentage
    totalTimeActive: number; // Milliseconds
    avgFeesPerCycle: number;

    // Range stats
    rangeChanges: number;
    avgRangeWidth: number; // In bps

    // Risk metrics
    maxDrawdown: number;
    maxDrawdownPercent: number;
    sharpeRatio?: number;

    // Costs
    estimatedGasCostUsd: number;
    netAfterGas: number;

    // ZAP costs
    totalZapCostUsd: number;
    zapRebalanceCount: number;
    nonZapRebalanceCount: number;
    avgZapCostPerRebalance: number;
    netAfterZap: number; // netAfterGas - totalZapCostUsd

    // APY calculation
    annualizedReturn: number;
    currentApy: number;
  };

  // ZAP history - per-rebalance breakdown
  zapHistory?: ZapRebalanceEvent[];
}

export interface PortfolioSummary {
  totalVaults: number;
  activeVaults: number;
  totalValueUsd: number;

  // Aggregated PnL
  totalPnl: number;
  totalPnlPercent: number;
  totalFeesUsd: number;
  totalDivergenceLoss: number;

  // Performance
  bestPerformer: {
    vaultId: string;
    pnlPercent: number;
  };
  worstPerformer: {
    vaultId: string;
    pnlPercent: number;
  };

  // By strategy
  byStrategy: Record<string, {
    vaultCount: number;
    totalValueUsd: number;
    avgPnlPercent: number;
    totalFeesUsd: number;
  }>;
}

export interface PerformanceComparison {
  vaultId: string;
  strategyType: string;

  // Before strategy
  before: {
    timestamp: number;
    tokenAAmount: string;
    tokenBAmount: string;
    totalValueUsd: number;
  };

  // Current state
  current: {
    timestamp: number;
    tokenAAmount: string;
    tokenBAmount: string;
    totalValueUsd: number;
  };

  // Changes
  changes: {
    tokenADelta: string;
    tokenBDelta: string;
    tokenADeltaPercent: number;
    tokenBDeltaPercent: number;
    valueDelta: number;
    valueDeltaPercent: number;
    timeElapsed: number; // Milliseconds
  };

  // What if scenarios
  whatIf: {
    hodl: {
      currentValue: number;
      pnlVsStrategy: number;
    };
    wideRange: {
      estimatedValue: number;
      pnlVsStrategy: number;
    };
  };
}

export interface ZapRebalanceEvent {
  rebalanceNumber: number;
  timestamp: number;
  usedZap: boolean;
  transactionDigest: string;

  // Actual swap data from on-chain event (0 if no swap occurred)
  amountIn: bigint;    // Actual amount swapped in (raw, with decimals)
  amountOut: bigint;   // Actual amount received from swap (raw, with decimals)
  swapXtoY: boolean;   // Swap direction: true = X to Y, false = Y to X

  // Position value at time of rebalance
  positionValueUsd: number;

  // Calculated costs based on actual swap data
  swapValueUsd: number;    // USD value of the swap (from actual amountIn)
  poolFeeUsd: number;      // Pool fee (calculated from actual swap)
  slippageUsd: number;     // Slippage (calculated from actual swap)
  totalCostUsd: number;    // Total cost

  // Pool info
  poolFeeRate: number; // e.g., 0.0025 for 0.25%
}

export interface CycleEvent {
  vaultId: string;
  cycleNumber: number;
  timestamp: number;
  eventType: 'open' | 'close' | 'rebalance';
  reason: string; // '🎯 Out of range', '⏰ Timer expired', etc.

  // Before cycle
  before: {
    tokenAAmount: string;
    tokenBAmount: string;
    valueUsd: number;
    tickLower?: number;
    tickUpper?: number;
  };

  // After cycle
  after: {
    tokenAAmount: string;
    tokenBAmount: string;
    valueUsd: number;
    tickLower?: number;
    tickUpper?: number;
  };

  // Collected during cycle
  feesCollected: {
    tokenA: string;
    tokenB: string;
    usd: number;
  };

  // Metrics
  timeInRange: number; // Milliseconds
  pnlDuringCycle: number;
  gasCostUsd: number;

  transactionDigest: string;
}
